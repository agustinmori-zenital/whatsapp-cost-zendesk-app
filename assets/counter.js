(function (root) {
  'use strict';

  // Incremental exports allow 10 requests per minute.
  var DEFAULT_PAUSE_MS = 6500;
  var UNKNOWN_NUMBER = '';
  var MAX_RETRIES = 3;
  var USER_REQUESTS_AT_ONCE = 3;

  // Wait asked by a 429 response (Retry-After seconds), else one minute.
  function retryAfterMs(err) {
    var h = typeof err.getResponseHeader === 'function' ? err.getResponseHeader('Retry-After') : null;
    var s = parseInt(h, 10);
    return (s > 0 ? s : 60) * 1000;
  }

  function toPath(url) {
    var u = new URL(url);
    return u.pathname + u.search;
  }

  function defaultSleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  // True when "whatsapp" appears anywhere in a via object (channel, source.rel, from/to details,
  // integration names), since Zendesk native messaging and third-party integrations label it differently.
  function isWhatsAppVia(via) {
    if (!via) return false;
    try { return /whatsapp/i.test(JSON.stringify(via)); } catch (e) { return false; }
  }

  // Normalized list of channel labels an admin marked as WhatsApp ("native_messaging, any_channel / infobip").
  function parseChannels(text) {
    return String(text || '').split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
  }

  // A via label matches a listed channel when it is equal to it or when the listed value is its channel part.
  function channelListed(key, list) {
    if (!list || !list.length) return false;
    var k = key.toLowerCase();
    var channel = k.split(' / ')[0];
    return list.indexOf(k) >= 0 || list.indexOf(channel) >= 0;
  }

  // Phone, address or name of one side of a message (via.source.from / via.source.to).
  function endpoint(x) {
    if (!x) return null;
    var v = x.phone || x.phone_number || x.address || x.name;
    return v == null ? null : String(v);
  }

  // Role, name and phone of each user id, 100 ids per request, a few requests at a time.
  // `known` (Map) is reused and only missing ids are requested.
  async function fetchUsers(request, ids, known) {
    var users = new Map(known || []);
    var missing = ids.filter(function (id) { return !users.has(id); });
    var batches = [];
    for (var i = 0; i < missing.length; i += 100) batches.push(missing.slice(i, i + 100));
    for (var b = 0; b < batches.length; b += USER_REQUESTS_AT_ONCE) {
      var results = await Promise.all(batches.slice(b, b + USER_REQUESTS_AT_ONCE).map(function (batch) {
        return request({ url: '/api/v2/users/show_many.json?ids=' + batch.join(','), type: 'GET' });
      }));
      results.forEach(function (res) {
        (res.users || []).forEach(function (u) { users.set(u.id, { role: u.role, name: u.name || null, phone: u.phone || null }); });
      });
    }
    return users;
  }

  // One public comment: ticket, author, unix time and both ends of the conversation.
  function toMessage(ticketId, c, at, via) {
    var src = (via && via.source) || {};
    return { t: ticketId, a: c.author_id, at: at, fr: endpoint(src.from), to: endpoint(src.to) };
  }

  // Conversation Log API: its own limit of 100 requests per minute per account. 640 ms apart is about 94 a
  // minute; after a 429 the pace slows down by half for the rest of the run (other apps share the limit).
  var LOG_SPACING_MS = 640;
  var LOG_BACKOFF = 1.5;
  var LOG_SPACING_MAX_MS = 3000;
  // Search Export API: 100 requests per minute per account, ordered by created_at, cursor valid one hour.
  var SEARCH_SPACING_MS = 700;
  // The search index can take a few minutes to see a change: a result found by search counts as complete only
  // up to this long before its end, so the next update run (by export) reads those last minutes again.
  var SEARCH_LAG = 15 * 60;
  var LIST_SPACING_MS = 650; // List Tickets: its own limit, 100 requests per minute on some plans
  var PARTIAL_MIN_MS = 3000;
  var NAME_LOOKUPS_MAX = 20; // single lookups per kind of name, for ids the lists did not return // at most one partial result every 3 s (each one re-renders the dashboard)
  var LOG_REQUESTS_AT_ONCE = 3;
  var LOG_MISSING_LIMIT = 6; // consecutive 404s at the start that mean the log API is not there
  var PARTIAL_EVERY = 30; // tickets between partial results

  // GET with retry on 429 (waits Retry-After, up to MAX_RETRIES times). Errors carry the path they failed on.
  // onLimit() is called on each 429, so a caller can slow down.
  async function getWithRetry(request, url, sleep, onLimit) {
    for (var retries = 0; ; retries++) {
      try {
        return await request({ url: url, type: 'GET' });
      } catch (err) {
        if (err && typeof err === 'object' && !err.path) err.path = url.split('?')[0];
        if (!err || err.status !== 429 || retries >= MAX_RETRIES) throw err;
        if (onLimit) onLimit();
        await sleep(retryAfterMs(err));
      }
    }
  }

  // WhatsApp tickets: the ticket's via mentions WhatsApp (native WhatsApp messaging or an integration
  // that names it), or its "channel / rel" label is in the admin's list.
  function isWhatsAppTicket(ticket, list) {
    return isWhatsAppVia(ticket.via) || channelListed(viaKey(ticket.via), list);
  }

  // Customer and business ends of a WhatsApp ticket, from the via of the message that created it:
  // a ticket started by the customer has from = customer, to = business number.
  function ticketEnds(ticket) {
    var src = (ticket.via && ticket.via.source) || {};
    return { customer: endpoint(src.from), business: endpoint(src.to) };
  }

  // Fields of a ticket used to filter and break down the costs: form, brand, group, assignee, organization,
  // status, tags and the custom fields with a short value (dropdowns, checkboxes, short texts).
  var FIELD_MAX = 80;
  var TAGS_MAX = 30;
  function ticketInfo(t) {
    var fields = {};
    (t.custom_fields || []).forEach(function (f) {
      var v = f && f.value;
      if (Array.isArray(v)) v = v.join(', ');
      if (v == null || v === '' || v === false) return;
      v = String(v);
      if (v.length <= FIELD_MAX) fields[f.id] = v;
    });
    return {
      form: t.ticket_form_id || null, brand: t.brand_id || null, group: t.group_id || null,
      assignee: t.assignee_id || null, org: t.organization_id || null, status: t.status || null,
      tags: (t.tags || []).slice(0, TAGS_MAX).map(String), fields: fields
    };
  }

  // Business number of a messaging ticket when its via has no phone: the WhatsApp integration that received
  // the customer's messages (one integration per business number), keyed "wa:<integration id>".
  function integrationKey(events) {
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      var a = e.author || {};
      var id = e.source && e.source.integration_id;
      if (id && e.type === 'Messaging::ConversationMessage' && (a.type === 'end-user' || a.type === 'user')) return 'wa:' + id;
    }
    return null;
  }

  // Messages of one ticket's conversation log in [from, to). Messaging conversations (native WhatsApp)
  // are Messaging::ConversationMessage events: author.type "user" is the customer, "agent" and "bot" are
  // the business. Users are keyed by Support user id, or "bot:<name>" for bots without one.
  function logMessages(ticket, events, from, to, users) {
    var ends = ticketEnds(ticket);
    if (!ends.business) ends.business = integrationKey(events);
    var out = [];
    events.forEach(function (e) {
      if (e.type !== 'Messaging::ConversationMessage') return;
      var at = Date.parse(e.created_at) / 1000;
      if (!isFinite(at) || at < from || at >= to) return;
      var author = e.author || {};
      var source = (e.source && e.source.type) || '';
      // In production the customer comes as "end-user" (docs say "user") with source "whatsapp", and
      // AI agents as "system" with user id -1 and source "ultimate"; human agents are "agent".
      var inbound = author.type === 'end-user' || author.type === 'user';
      var bot = !inbound && (author.type === 'bot' || author.type === 'system' || source === 'ultimate');
      var id = author['zen:support:user_id'];
      var key = typeof id === 'number' && id > 0 ? id : (inbound ? 'user:' : 'bot:') + (author.display_name || '?');
      if (!users.has(key)) {
        users.set(key, { role: inbound ? 'end-user' : bot ? 'bot' : 'agent', name: author.display_name || null, phone: null });
      }
      out.push({ t: ticket.id, a: key, at: at,
        fr: inbound ? ends.customer : ends.business, to: inbound ? ends.business : ends.customer });
    });
    return out;
  }

  // All events of a ticket's conversation log (cursor pagination, 100 per page), or null when Zendesk
  // answers 404 (e.g. archived or deleted tickets, or the log not available on the account).
  async function fetchLog(request, ticketId, sleep, onLimit) {
    var events = [];
    // Path as documented, without ".json", and no page[size]: in production the request with
    // ?page[size]=100 answered 404 while the plain path answered 200. Later pages follow links.next.
    var url = '/api/v2/tickets/' + ticketId + '/conversation_log';
    while (url) {
      var res;
      try { res = await getWithRetry(request, url, sleep, onLimit); } catch (err) { if (err && err.status === 404) return null; throw err; }
      push(events, res.events);
      url = res.meta && res.meta.has_more && res.links && res.links.next ? toPath(res.links.next) : null;
    }
    return events;
  }

  // Appends in place: concat would copy the whole array once per ticket (quadratic on large accounts).
  function push(target, items) {
    if (!items) return target;
    for (var i = 0; i < items.length; i++) target.push(items[i]);
    return target;
  }

  function isoUtc(unix) { return new Date(unix * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'); }

  // Native WhatsApp tickets updated since startTime, by the Search Export API: only those tickets, instead
  // of every ticket of the account. Returns null when it can't be used (error, or results that are not full
  // ticket objects), and the caller falls back to the incremental export.
  async function searchTickets(opts, request, sleep, onPage) {
    var query = 'via:whatsapp updated>=' + isoUtc(opts.startTime);
    var url = '/api/v2/search/export.json?filter[type]=ticket&page[size]=1000&query=' + encodeURIComponent(query);
    var out = [];
    try {
      while (url) {
        if (opts.shouldStop()) return { tickets: out, stopped: true };
        var started = Date.now();
        var res = await getWithRetry(request, url, sleep);
        var results = res.results || [];
        if (results.some(function (t) { return !t || !t.via || !t.updated_at; })) return null;
        push(out, results);
        onPage(results);
        url = res.meta && res.meta.has_more && res.links && res.links.next ? toPath(res.links.next) : null;
        var wait = (opts.searchSpacingMs == null ? SEARCH_SPACING_MS : opts.searchSpacingMs) - (Date.now() - started);
        if (url && wait > 0) await sleep(wait);
      }
    } catch (err) {
      if (err && err.status === 429) throw err;
      return null;
    }
    return { tickets: out, stopped: false };
  }

  // WhatsApp messages sent or received in [startTime, endTime) (unix seconds).
  // 1. Incremental ticket export from startTime: every ticket updated since then, kept when it is a
  //    WhatsApp ticket (10 requests per minute, so pages are spaced pauseMs apart).
  // 2. Conversation log of each WhatsApp ticket. Zendesk stores messaging messages there, not as ticket
  //    comments. Tickets whose log has no messaging messages (e.g. a third-party integration that writes
  //    comments) fall back to their public comments.
  // opts.channels: extra channel labels to treat as WhatsApp; opts.users: Map of users already fetched.
  // opts.fromTime (default startTime): first moment whose messages are kept. An update run exports only
  // the tickets changed since the last run (startTime) but still needs each one's messages from the start
  // of the period, because the old messages of those tickets are replaced (see mergeResults).
  // opts.search: find the tickets with the Search Export API (full runs; falls back to the export).
  // opts.skipLog(ticket): true when the ticket's messages are already known (see runRange); its log is not read.
  // opts.sampleSize: read the logs of only this many tickets, picked at random once every ticket is listed (a
  //   simple random sample). The result then carries `sample` (every ticket listed, in random order, and how
  //   many of the first ones were read), so the totals can be scaled up (see sampleDomain) and the sample
  //   extended later (extendSample). With as many tickets as the sample or fewer, every log is read.
  // opts.rows: tickets already listed (a sample's next ones): no listing, read the log of each.
  async function countMessages(opts) {
    var request = opts.request;
    var sleep = opts.sleep || defaultSleep;
    var pauseMs = opts.pauseMs == null ? DEFAULT_PAUSE_MS : opts.pauseMs;
    var logSpacing = opts.logSpacingMs == null ? LOG_SPACING_MS : opts.logSpacingMs;
    var slowDown = function () { logSpacing = Math.min(LOG_SPACING_MAX_MS, Math.max(logSpacing, 100) * LOG_BACKOFF); };
    var partialMs = opts.partialMs == null ? PARTIAL_MIN_MS : opts.partialMs;
    var lastPartial = Date.now();
    var shouldStop = opts.shouldStop || function () { return false; };
    var onProgress = opts.onProgress || function () {};
    var list = parseChannels(opts.channels);
    var fromTime = opts.fromTime == null ? opts.startTime : opts.fromTime;
    var sampleSize = opts.sampleSize > 0 ? opts.sampleSize : 0;

    var tickets = []; // WhatsApp tickets found (with skipped ones)
    var deleted = []; // gone since the last run: their old messages must go too (see mergeResults)
    var seen = new Set(); // the export can list a ticket twice when it changes while pages are read
    var scanned = 0;
    var channels = {}; // "channel / rel" of the tickets read, to diagnose channel detection on real data
    var pages = 0;
    var status = 'done';
    var span = Math.max(1, opts.endTime - opts.startTime);
    var skipped = 0; // tickets whose log was not read: their messages were already known
    var exportError = null; // why the export could not be used (then source is 'list')
    var source = 'export';

    function take(t) {
      // Deleted tickets stay in the export but their conversations can't be read.
      if (t.status === 'deleted') { deleted.push(t.id); return; }
      if (Date.parse(t.created_at) / 1000 >= opts.endTime || seen.has(t.id)) return;
      if (source === 'search' && Date.parse(t.updated_at) / 1000 < opts.startTime) return;
      seen.add(t.id);
      scanned += 1;
      var key = viaKey(t.via);
      channels[key] = (channels[key] || 0) + 1;
      if (!isWhatsAppTicket(t, list)) return;
      var row = { id: t.id, via: t.via, requester_id: t.requester_id, assignee_id: t.assignee_id, info: ticketInfo(t),
        created: Date.parse(t.created_at) / 1000, updated: Date.parse(t.updated_at) / 1000 };
      row.skip = !!(opts.skipLog && opts.skipLog(row));
      if (row.skip) skipped += 1;
      tickets.push(row);
    }

    // Both steps run at once: conversation logs are read while the export is still listing tickets (it pauses
    // 6.5 s between pages). Tickets updated inside the current period (opts.priorityFrom) are read first, so
    // the current period is complete (opts.onCurrentReady) before the previous one, which only feeds the
    // comparison, is read.
    var users = new Map(opts.users || []);
    var messages = [];
    var logMissing = 0; // WhatsApp tickets whose conversation log answered 404 (their comments are used)
    var logRead = 0;
    var done = 0;
    var readIds = [];
    var priorityFrom = opts.priorityFrom == null ? -Infinity : opts.priorityFrom;
    var queues = { cur: [], prev: [] };
    var listing = true; // step 1 still running
    var listPct = 0;
    var failed = null;
    var wake = null; // resolves when step 1 adds tickets or ends
    function signal() { if (wake) { var w = wake; wake = null; w(); } }

    var baseTake = take;
    take = function (t) {
      var before = tickets.length;
      baseTake(t);
      var row = tickets.length > before ? tickets[tickets.length - 1] : null;
      if (!row || row.skip) return;
      // A sample is picked once the list is complete (see pickSample).
      if (sampleSize) row.u = Math.random();
      else (row.updated >= priorityFrom ? queues.cur : queues.prev).push(row);
    };

    // The sample: tickets in random order, the first sampleSize queued to be read.
    function pickSample() {
      tickets.sort(function (a, b) { return a.u - b.u; });
      queues.cur = tickets.slice(0, sampleSize);
    }

    // Every ticket listed, in the sample's order, and how many of the first ones were read; null when all were.
    function sampleOf() {
      if (!sampleSize || listing || !readIds.length || readIds.length >= tickets.length) return null;
      return { rows: tickets.map(sampleRow), read: readIds.length, start: fromTime, end: opts.endTime };
    }

    // Step 1: candidate tickets (first bar). The Search Export API lists only native WhatsApp tickets;
    // without extra channels to match, it replaces reading every ticket of the account.
    async function listTickets() {
      if (opts.rows) {
        source = 'sample';
        opts.rows.forEach(function (r) { tickets.push(r); queues.cur.push(r); });
        listPct = 1;
        return;
      }
      if (opts.search && !list.length) {
        source = 'search';
        var found = await searchTickets({ startTime: opts.startTime, shouldStop: shouldStop, searchSpacingMs: opts.searchSpacingMs }, request, sleep, function (page) {
          pages += 1;
          var lastCreated = page.length ? Date.parse(page[page.length - 1].created_at) / 1000 : opts.startTime;
          listPct = Math.max(0, Math.min(1, (lastCreated - opts.startTime) / span));
          report();
        });
        // No WhatsApp ticket by search: the export lists every channel, for the diagnostic and other WhatsApp labels.
        var any = found && found.tickets.some(function (t) { return isWhatsAppTicket(t, list) && t.status !== 'deleted'; });
        if (found && (any || found.stopped)) {
          found.tickets.forEach(take);
          if (found.stopped) status = 'stopped';
          signal();
        } else {
          source = 'export';
        }
      }
      var url = source === 'export' ? '/api/v2/incremental/tickets/cursor.json?start_time=' + opts.startTime : null;
      while (url && !failed) {
        if (shouldStop()) { status = 'stopped'; break; }
        var started = Date.now();
        var res;
        try {
          res = await getWithRetry(request, url, sleep);
        } catch (err) {
          // Zendesk is closing the Incremental APIs to third-party apps (from December 2026): when the export
          // is refused before any page was read, the tickets are listed with the List Tickets API instead.
          if (pages === 0 && err && [403, 404, 410].indexOf(err.status) >= 0 && !opts.noListFallback) {
            exportError = err;
            source = 'list';
            break;
          }
          throw err;
        }
        pages += 1;
        var lastUpdate = opts.startTime;
        (res.tickets || []).forEach(function (t) {
          lastUpdate = Math.max(lastUpdate, Date.parse(t.updated_at) / 1000 || lastUpdate);
          take(t);
        });
        listPct = Math.min(1, (lastUpdate - opts.startTime) / span);
        signal();
        report();
        url = res.end_of_stream || !res.after_cursor ? null
          : '/api/v2/incremental/tickets/cursor.json?cursor=' + encodeURIComponent(res.after_cursor);
        var wait = pauseMs - (Date.now() - started);
        if (url && wait > 0) await sleep(wait);
      }
      if (source === 'list') await listByUpdate();
    }

    // Tickets updated since startTime from GET /api/v2/tickets, newest update first (cursor, 100 per page),
    // until a page reaches older updates. Slower than the export, misses archived tickets and does not report
    // deleted ones; only used when the export is refused.
    async function listByUpdate() {
      var url = '/api/v2/tickets.json?page[size]=100&sort=-updated_at';
      var oldest = opts.endTime;
      while (url && !failed) {
        if (shouldStop()) { status = 'stopped'; break; }
        var started = Date.now();
        var res = await getWithRetry(request, url, sleep);
        pages += 1;
        var done = false;
        (res.tickets || []).forEach(function (t) {
          var u = Date.parse(t.updated_at) / 1000;
          if (u < opts.startTime) { done = true; return; }
          oldest = Math.min(oldest, u);
          take(t);
        });
        listPct = Math.min(1, (opts.endTime - oldest) / span);
        signal();
        report();
        url = !done && res.meta && res.meta.has_more && res.links && res.links.next ? toPath(res.links.next) : null;
        var wait = LIST_SPACING_MS - (Date.now() - started);
        if (url && wait > 0) await sleep(wait);
      }
    }

    // Overall progress: 40% for listing tickets, 59% for reading the logs found so far (scaled by how much of
    // the list is known, so the bar never runs back).
    function report() {
      var toRead = sampleSize ? Math.min(sampleSize, tickets.length) : tickets.length - skipped;
      var readShare = toRead ? done / toRead : listing ? 0 : 1;
      onProgress({ step: listing ? 'tickets' : 'messages', pct: 40 * (listing ? listPct : 1) + 59 * readShare * (listing ? listPct : 1),
        scanned: scanned, tickets: tickets.length, toRead: toRead, done: done, messages: messages.length, skipped: skipped });
    }

    // Public comments of a ticket, as written by comment-based integrations (or when its log is missing).
    async function readComments(t) {
      var comments;
      try { comments = await fetchComments(request, t.id); } catch (err) { if (err && err.status === 404) return; throw err; }
      comments.forEach(function (cm) {
        if (!cm.public) return;
        var at = Date.parse(cm.created_at) / 1000;
        if (!isFinite(at) || at < fromTime || at >= opts.endTime) return;
        messages.push(toMessage(t.id, cm, at, cm.via && cm.via.source ? cm.via : t.via));
      });
    }

    async function readTicket(t) {
      var events = await fetchLog(request, t.id, sleep, slowDown);
      if (events) logRead += 1; else logMissing += 1;
      // Every log so far missing: the Conversation Log API is not available on this account, and reading
      // comments ticket by ticket would be slow and miss messaging messages anyway.
      if (!logRead && logMissing >= LOG_MISSING_LIMIT) {
        var e = new Error('Conversation log not available');
        e.code = 'log_unavailable';
        e.status = 404;
        e.path = '/api/v2/tickets/' + t.id + '/conversation_log';
        throw e;
      }
      var hasMessaging = !!events && events.some(function (ev) { return ev.type === 'Messaging::ConversationMessage'; });
      if (hasMessaging) push(messages, logMessages(t, events, fromTime, opts.endTime, users));
      else await readComments(t);
    }

    function snapshot(extra) {
      return Object.assign({ status: 'partial', pages: pages, scanned: scanned, channels: channels, messages: messages.slice(), users: new Map(users),
        logMissing: logMissing, tickets: readIds.slice(), requesters: requestersOf(tickets), info: infoOf(tickets), names: opts.names || null,
        sample: sampleOf() }, extra || {});
    }

    // Step 2: messages of each WhatsApp ticket, a few at a time, spaced for the log rate limit.
    var currentAnnounced = false;
    async function readLogs() {
      for (;;) {
        if (shouldStop()) { status = 'stopped'; return; }
        var from = queues.cur.length ? queues.cur : queues.prev;
        if (!from.length) {
          if (!listing) return;
          await new Promise(function (resolve) { wake = resolve; });
          continue;
        }
        // The current period is complete once the list is done and no current ticket is left to read.
        var batch = from.splice(0, LOG_REQUESTS_AT_ONCE);
        var batchStart = Date.now();
        await Promise.all(batch.map(readTicket));
        batch.forEach(function (t) { readIds.push(t.id); });
        done += batch.length;
        report();
        if (!currentAnnounced && !listing && !queues.cur.length && queues.prev.length && opts.onCurrentReady && status === 'done') {
          currentAnnounced = true;
          await addUsers(tickets.filter(function (t) { return t.updated >= priorityFrom; }));
          opts.onCurrentReady(snapshot({ currentComplete: true }));
        } else if (opts.onPartial && done % PARTIAL_EVERY < LOG_REQUESTS_AT_ONCE && (listing || queues.cur.length || queues.prev.length) &&
            Date.now() - lastPartial >= partialMs) {
          // Partial results so the dashboard can show something while the rest loads, not too often: each
          // one makes the dashboard analyze everything read so far.
          lastPartial = Date.now();
          opts.onPartial(snapshot(currentAnnounced ? { currentComplete: true } : null));
        }
        var gap = logSpacing * batch.length - (Date.now() - batchStart);
        if (gap > 0 && (listing || queues.cur.length || queues.prev.length)) await sleep(gap);
      }
    }

    // Names, roles and profile phones that the analysis needs: authors of comments (role unknown), assigned
    // agents (names), and customers' profile phones only for tickets whose via has no customer phone.
    // Users already looked up are not asked again (a profile without a phone is kept as '').
    async function addUsers(rows) {
      var ids = new Set();
      var phoneless = new Set();
      rows.forEach(function (t) {
        if (t.assignee_id) ids.add(t.assignee_id);
        // A name ("WhatsApp Business") is not a phone: those tickets need the profile phone too.
        if (String(ticketEnds(t).customer || '').replace(/\D/g, '').length < 6) {
          phoneless.add(t.id);
          if (t.requester_id) ids.add(t.requester_id);
        }
      });
      messages.forEach(function (m) {
        if (typeof m.a !== 'number' || m.a <= 0) return;
        var u = users.get(m.a);
        if (!u || (u.role === 'end-user' && phoneless.has(m.t))) ids.add(m.a);
      });
      var fetched = await fetchUsers(request, Array.from(ids).filter(function (id) {
        var u = users.get(id);
        return !u || u.phone == null && u.role !== 'agent' && u.role !== 'bot';
      }));
      fetched.forEach(function (u, id) {
        var known = users.get(id);
        // The log's author type decides inbound/outbound; the Users API adds name and phone.
        users.set(id, { role: known ? known.role : u.role, name: u.name || (known && known.name), phone: u.phone || '' });
      });
    }

    var lister = listTickets().catch(function (err) { failed = err; }).then(function () {
      if (sampleSize && !failed && status === 'done') pickSample();
      listing = false;
      signal();
    });
    try {
      await readLogs();
    } catch (err) {
      failed = failed || err;
    }
    listing = false;
    await lister;
    if (failed) throw failed;
    var all = tickets;
    var sample = sampleOf();
    // A sample needs the users of the tickets read only.
    if (sample || opts.rows) {
      var readSet = new Set(readIds);
      await addUsers(all.filter(function (t) { return readSet.has(t.id); }));
    } else {
      await addUsers(all);
    }
    var info = infoOf(all);
    return {
      sample: sample,
      // Every WhatsApp ticket came through native WhatsApp: the search can find them all next time.
      nativeOnly: source === 'export' ? all.every(function (t) { return t.via && t.via.channel === 'whatsapp'; }) && !list.length : null,
      status: status, pages: pages, scanned: scanned, channels: channels, messages: messages, users: users,
      logMissing: logMissing, deleted: deleted, info: info, source: source, skipped: skipped,
      exportStatus: exportError ? exportError.status : null,
      names: status === 'done' ? await fetchNames(request, info, opts.names) : opts.names || null,
      // Only the tickets whose log was read: a stopped run must not make mergeResults drop the rest.
      tickets: readIds,
      requesters: requestersOf(all)
    };
  }

  // What reading a sampled ticket's log later needs (its fields stay in the result's `info`).
  function sampleRow(t) {
    return { id: t.id, via: t.via, requester_id: t.requester_id, assignee_id: t.assignee_id, created: t.created, updated: t.updated };
  }

  function requestersOf(rows) {
    return rows.reduce(function (o, t) { if (t.requester_id) o[t.id] = t.requester_id; return o; }, {});
  }

  function infoOf(tickets) {
    var out = {};
    tickets.forEach(function (t) { if (t.info) out[t.id] = t.info; });
    return out;
  }

  // Every item of a list endpoint, following cursor (links.next) or offset (next_page) pagination.
  async function fetchAll(request, url, key, maxPages) {
    var items = [];
    for (var n = 0; url && n < (maxPages || 20); n++) {
      var res = await request({ url: url, type: 'GET' });
      push(items, res[key]);
      url = res.meta && res.meta.has_more && res.links && res.links.next ? toPath(res.links.next)
        : res.next_page ? toPath(res.next_page) : null;
    }
    return items;
  }

  // Display names of the forms, brands, groups, organizations and custom fields the tickets use. Each list
  // is optional: a failed call (plan without ticket forms, missing permission) leaves ids without a name.
  // `known` (names of an earlier run) is kept for what this run could not read.
  async function fetchNames(request, info, known) {
    var used = { forms: new Set(), brands: new Set(), groups: new Set(), orgs: new Set(), fields: new Set() };
    Object.keys(info).forEach(function (id) {
      var i = info[id];
      if (i.form) used.forms.add(i.form);
      if (i.brand) used.brands.add(i.brand);
      if (i.group) used.groups.add(i.group);
      if (i.org) used.orgs.add(i.org);
      Object.keys(i.fields || {}).forEach(function (f) { used.fields.add(Number(f)); });
    });
    var names = { forms: {}, brands: {}, groups: {}, orgs: {}, fields: {} };
    if (known) Object.keys(names).forEach(function (k) { Object.assign(names[k], known[k] || {}); });
    async function list(url, key, onItem) {
      try { (await fetchAll(request, url, key)).forEach(onItem); } catch (e) { /* optional: ids stay as they are */ }
    }
    var jobs = [];
    // Forms by their agent-facing name (display_name is what end users see on the request form).
    if (used.forms.size) jobs.push(list('/api/v2/ticket_forms.json', 'ticket_forms', function (f) { if (used.forms.has(f.id)) names.forms[f.id] = f.name || f.display_name; }));
    if (used.brands.size) jobs.push(list('/api/v2/brands.json', 'brands', function (b) { if (used.brands.has(b.id)) names.brands[b.id] = b.name; }));
    if (used.groups.size) jobs.push(list('/api/v2/groups.json?page[size]=100', 'groups', function (g) { if (used.groups.has(g.id)) names.groups[g.id] = g.name; }));
    if (used.fields.size) {
      jobs.push(list('/api/v2/ticket_fields.json?page[size]=100', 'ticket_fields', function (f) {
        if (!used.fields.has(f.id)) return;
        var options = {};
        (f.custom_field_options || []).forEach(function (o) { options[o.value] = o.name; });
        names.fields[f.id] = { title: f.title, type: f.type, options: options };
      }));
    }
    var orgIds = Array.from(used.orgs).filter(function (id) { return !names.orgs[id]; });
    for (var i = 0; i < orgIds.length; i += 100) {
      jobs.push(list('/api/v2/organizations/show_many.json?ids=' + orgIds.slice(i, i + 100).join(','), 'organizations', function (o) { names.orgs[o.id] = o.name; }));
    }
    await Promise.all(jobs);
    // Ids the lists did not return (inactive or deleted forms, brands or groups, or lists that failed): one by one.
    var single = [['forms', '/api/v2/ticket_forms/', 'ticket_form'], ['brands', '/api/v2/brands/', 'brand'], ['groups', '/api/v2/groups/', 'group']];
    var lookups = [];
    single.forEach(function (s) {
      Array.from(used[s[0]]).filter(function (id) { return !names[s[0]][id]; }).slice(0, NAME_LOOKUPS_MAX).forEach(function (id) {
        lookups.push(request({ url: s[1] + id + '.json', type: 'GET' }).then(function (res) {
          var item = res && res[s[2]];
          if (item && (item.name || item.display_name)) names[s[0]][id] = item.name || item.display_name;
        }, function () { /* deleted or not allowed: the id stays */ }));
      });
    });
    await Promise.all(lookups);
    return names;
  }

  // Ids of forms, brands, groups and organizations used by the tickets that have no name yet.
  function missingNames(info, names) {
    var keys = { form: 'forms', brand: 'brands', group: 'groups', org: 'orgs' };
    var n = names || {};
    return Object.keys(info || {}).some(function (id) {
      var i = info[id];
      return Object.keys(keys).some(function (k) { return i[k] && !(n[keys[k]] || {})[i[k]]; });
    });
  }

  // "channel / rel" label of a comment's via, e.g. "native_messaging / whatsapp" or "email".
  function viaKey(via) {
    if (!via) return '(sin via)';
    var channel = via.channel == null ? '?' : String(via.channel);
    var rel = via.source && via.source.rel;
    return rel ? channel + ' / ' + rel : channel;
  }

  function isInbound(users, authorId) {
    var u = users.get(authorId);
    return !!(u && u.role === 'end-user');
  }

  // Customer phone of each ticket: the far end of the conversation, else an end user's profile phone.
  function ticketMarkets(messages, users, marketForPhone) {
    var markets = new Map();
    messages.forEach(function (m) {
      if (markets.get(m.t)) return;
      var inbound = isInbound(users, m.a);
      var phone = inbound ? m.fr : m.to;
      var market = phone ? marketForPhone(phone) : null;
      if (!market && inbound) {
        var u = users.get(m.a);
        market = u && u.phone ? marketForPhone(u.phone) : null;
      }
      markets.set(m.t, market || markets.get(m.t) || null);
    });
    return markets;
  }

  // Business number of each ticket: the near end of the first message that carries one, so replies
  // without phones (e.g. sent from the agent interface) are still attributed to the ticket's number.
  function ticketNumbers(messages, users) {
    var numbers = new Map();
    messages.forEach(function (m) {
      if (numbers.has(m.t)) return;
      var n = isInbound(users, m.a) ? m.to : m.fr;
      if (n) numbers.set(m.t, n);
    });
    return numbers;
  }

  // Country of the business number, used as the customer's country when the customer phone is unknown
  // and opts.useNumberCountry is set (no default country chosen by an admin): most customers write to a
  // local number. "Other" says nothing about the country, so it is ignored.
  function numberMarket(number, opts) {
    if (!opts.useNumberCountry || !number) return null;
    var m = opts.marketForPhone(number);
    return m && m !== 'Other' ? m : null;
  }

  // Previous result plus a fresh read of the time after it. Tickets in the fresh read were re-read in
  // full (their conversation log), so their old messages are replaced; the rest are kept from `from` on.
  function mergeResults(old, fresh, from) {
    var reread = new Set((fresh.tickets || []).concat(fresh.deleted || []));
    var channels = Object.assign({}, old.channels || {});
    Object.keys(fresh.channels || {}).forEach(function (k) { channels[k] = (channels[k] || 0) + fresh.channels[k]; });
    var users = new Map(old.users || []);
    fresh.users.forEach(function (u, id) { users.set(id, u); });
    return {
      status: fresh.status, pages: fresh.pages, scanned: (old.scanned || 0) + fresh.scanned, channels: channels,
      messages: old.messages.filter(function (m) { return m.at >= from && !reread.has(m.t); }).concat(fresh.messages),
      users: users, tickets: fresh.tickets, logMissing: (old.logMissing || 0) + (fresh.logMissing || 0),
      requesters: Object.assign({}, old.requesters || {}, fresh.requesters || {}),
      // Fresh fields win: a ticket moved to another group or form since the last run counts there now.
      info: Object.assign({}, old.info || {}, fresh.info || {}),
      names: fresh.names || old.names || null,
      nativeOnly: old.nativeOnly === true && fresh.nativeOnly !== false
    };
  }

  var DAY = 86400;

  // 'YYYY-MM-DD' (an <input type="date"> value) as unix seconds at local midnight, `addDays` later; null if not a date.
  function localDay(text, addDays) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || ''));
    if (!m) return null;
    // Years under 2000 are a half-typed date (0026-11-01 would be 1926).
    if (Number(m[1]) < 2000) return null;
    var t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + (addDays || 0)).getTime();
    return isFinite(t) ? Math.floor(t / 1000) : null;
  }

  // Local date ('YYYY-MM-DD') of unix seconds.
  function isoLocal(unix) {
    var d = new Date(unix * 1000);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // Period picked in the dashboard, in unix seconds, as [start, end) plus the previous period of the same
  // length. period: '7' | '30' | '90' (rolling days that end at nowSec) or 'custom' (fromDate and toDate
  // are 'YYYY-MM-DD' in local time, `toDate` included; an end in the future is cut at nowSec).
  // Returns { start, end, prevStart, days, from, to } or { error: 'invalid' | 'missing' | 'future' | 'order' }.
  function buildRange(period, fromDate, toDate, nowSec) {
    var start, end, days, from = null, to = null;
    if (period !== 'custom') {
      days = Number(period);
      if (!(days > 0)) return { error: 'invalid' };
      start = nowSec - days * DAY;
      end = nowSec;
    } else {
      start = localDay(fromDate, 0);
      var dayAfter = localDay(toDate, 1);
      if (start == null || dayAfter == null) return { error: 'missing' };
      if (start >= nowSec) return { error: 'future' };
      end = Math.min(dayAfter, nowSec);
      if (!(start < end)) return { error: 'order' };
      // Exact length: rounding a range that ends now (e.g. today only) would inflate the monthly estimate.
      days = Math.max(1, (end - start) / DAY);
      from = fromDate;
      to = isoLocal(end - 1);
    }
    return { start: start, end: end, prevStart: start - (end - start), days: days, from: from, to: to };
  }

  // The last complete run when it can be extended instead of read again: same channels, it starts
  // no later than the new range needs (both periods) and it ends inside the new range, so only the time
  // after it is missing. `last` is { result, range, channels, savedAt }.
  function reusableRun(last, range, channels) {
    if (!last || !last.savedAt || !last.result || last.result.status !== 'done') return null;
    if (parseChannels(last.channels).sort().join(',') !== parseChannels(channels).sort().join(',')) return null;
    var r = last.range;
    return r.prevStart <= range.prevStart && r.end > range.prevStart && r.end <= range.end ? last : null;
  }

  // History kept when a run moves forward: a 90-day view needs 180 days (both periods).
  var KEEP_DAYS = 180;

  // Time a result holds messages for, [start, end): its own window, or both periods of its range.
  function windowOf(run) {
    return (run.result && run.result.window) || { start: run.range.prevStart, end: run.range.end };
  }

  // How to get `range` (both periods) from the last complete run `base` ({ result, range, channels, savedAt }):
  //   cached  the base already holds both periods: no API calls at all
  //   update  the base starts early enough: read only the tickets changed since it ended
  //   extend  the range starts before the base: read the tickets of the earlier time, skipping the logs of
  //           tickets the base already holds in full (created inside it and not changed since)
  //   full    no usable base (none, other channels, no overlap): read both periods
  // toleranceSec: a range that ends up to this long after the base still counts as held (used when switching
  // periods: the last minutes are not worth a new read; "Ver costo" passes none and reads them).
  function planRun(base, range, channels, toleranceSec) {
    if (!base || !base.savedAt || !base.result || base.result.status !== 'done' || base.result.sample) return { mode: 'full' };
    if (parseChannels(base.channels).sort().join(',') !== parseChannels(channels).sort().join(',')) return { mode: 'full' };
    var w = windowOf(base);
    if (w.end <= range.prevStart || range.end <= w.start) return { mode: 'full' };
    if (w.start <= range.prevStart && range.end <= w.end + (toleranceSec || 0)) return { mode: 'cached', base: base, window: w };
    if (w.start <= range.prevStart) return { mode: 'update', base: base, window: w };
    return { mode: 'extend', base: base, window: w };
  }

  // Result for `range` (both periods), following opts.plan (see planRun; default full). The result carries
  // `window`, the time it holds messages for, which can be wider than the range: later runs reuse it.
  // opts: countMessages options (request, channels, shouldStop, onProgress, pauseMs...) plus range, plan
  // (or reuse, an update base as returned by reusableRun) and onPartial(result), which gets the merged partial result.
  async function runRange(opts) {
    var range = opts.range;
    var plan = opts.plan || (opts.reuse ? { mode: 'update', base: opts.reuse, window: windowOf(opts.reuse) } : { mode: 'full' });
    // A sample is drawn from every ticket of the range: it never builds on an earlier result.
    if (opts.sampleSize) plan = { mode: 'full' };
    var base = plan.base ? plan.base.result : null;
    var w = plan.window;
    if (plan.mode === 'cached') return base;
    var run = Object.assign({}, opts, { users: base ? base.users : null, names: base ? base.names : null });
    var keep; // messages of the base kept from here on
    var window;
    if (plan.mode === 'update') {
      // Keep the base's earlier history (so going back to a longer period needs no reading), up to KEEP_DAYS.
      keep = Math.min(range.prevStart, Math.max(w.start, range.end - KEEP_DAYS * DAY));
      run.startTime = w.end;
      run.fromTime = keep;
      run.endTime = range.end;
      window = { start: keep, end: range.end };
    } else if (plan.mode === 'extend') {
      keep = w.start;
      run.startTime = range.prevStart;
      run.fromTime = range.prevStart;
      run.endTime = Math.max(range.end, w.end);
      run.skipLog = function (t) { return !!(base.info && base.info[t.id]) && t.created >= w.start && t.updated < w.end; };
      window = { start: range.prevStart, end: run.endTime };
    } else {
      run.startTime = range.prevStart;
      run.fromTime = range.prevStart;
      run.endTime = range.end;
      window = { start: range.prevStart, end: range.end };
    }
    var merge = function (fresh) {
      var out = base ? mergeResults(base, fresh, keep) : fresh;
      out.source = fresh.source;
      if (fresh.currentComplete) out.currentComplete = true;
      out.skipped = fresh.skipped;
      out.window = fresh.source === 'search' ? { start: window.start, end: Math.max(window.start, window.end - SEARCH_LAG) } : window;
      return out;
    };
    if (opts.onPartial) run.onPartial = function (partial) { opts.onPartial(merge(partial)); };
    // The current period first: tickets updated inside it are read before the ones only the comparison needs.
    run.priorityFrom = range.start;
    if (opts.onCurrentReady) {
      run.onCurrentReady = function (partial) {
        var out = merge(partial);
        out.status = 'partial';
        out.currentComplete = true;
        opts.onCurrentReady(out);
      };
    }
    var result = merge(await countMessages(run));
    // A stopped run holds less than its window: it must not be reused as complete (status is not 'done').
    return result;
  }

  // A sampled result with `add` more tickets read (the next ones of its random order). Reading every ticket
  // left makes it a complete result (no `sample`). A stopped extension keeps what it read: the sample is
  // still random, only smaller than asked.
  // opts: countMessages options (request, shouldStop, onProgress, logSpacingMs...) plus result, add and
  // onPartial(result), which gets the merged partial result.
  async function extendSample(opts) {
    var old = opts.result;
    var s = old.sample;
    var rows = s.rows.slice(s.read, s.read + opts.add);
    var merge = function (fresh) {
      var users = new Map(old.users || []);
      fresh.users.forEach(function (u, id) { users.set(id, u); });
      var read = s.read + fresh.tickets.length;
      return Object.assign({}, old, {
        status: fresh.status === 'partial' ? 'partial' : 'done',
        messages: old.messages.concat(fresh.messages), users: users, tickets: (old.tickets || []).concat(fresh.tickets),
        logMissing: (old.logMissing || 0) + (fresh.logMissing || 0), names: fresh.names || old.names || null,
        sample: read >= s.rows.length ? null : { rows: s.rows, read: read, start: s.start, end: s.end }
      });
    };
    var run = Object.assign({}, opts, { rows: rows, startTime: s.start, fromTime: s.start, endTime: s.end, sampleSize: 0,
      users: old.users, names: old.names });
    if (opts.onPartial) run.onPartial = function (partial) { opts.onPartial(merge(partial)); };
    var fresh = await countMessages(run);
    var out = merge(fresh);
    // Names of fields the new tickets brought (their fields were listed with the sample).
    // Also when the sample itself stopped before its names were read.
    if (!out.sample || !old.names) out.names = await fetchNames(opts.request, out.info, out.names);
    return out;
  }

  // Native WhatsApp tickets updated since startTime (unix seconds), by the Search API's count (one request),
  // or null when it can't tell. Tickets of integrations listed in the settings are not counted.
  async function countTickets(request, startTime) {
    try {
      var res = await request({ url: '/api/v2/search/count.json?query=' + encodeURIComponent('type:ticket via:whatsapp updated>=' + isoUtc(startTime)), type: 'GET' });
      return res && typeof res.count === 'number' ? res.count : null;
    } catch (err) {
      return null;
    }
  }

  // Minutes needed to read n tickets' conversation logs at the log rate limit.
  function readMinutes(n) { return n * LOG_SPACING_MS / 60000; }

  // Monday 00:00 local time of the week that contains unix time `at`, as unix seconds.
  // Built from calendar parts: zones whose clocks skip midnight (Santiago, Cairo...) have days that start at 01:00.
  function weekStart(at) {
    var d = new Date(at * 1000);
    return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime() / 1000);
  }

  // Weeks [start, end) that touch the range [from, to), each keyed like summarize's byWeek.
  function weeks(from, to) {
    var out = [];
    for (var start = weekStart(from); start < to; ) {
      var end = weekStart(start + 7.5 * DAY); // lands inside next week even across a daylight saving change
      out.push({ start: start, end: end });
      start = end;
    }
    return out;
  }

  function bump(map, key, make) {
    if (!map.has(key)) map.set(key, make());
    return map.get(key);
  }

  // A WhatsApp customer-service window lasts 24 h: a gap longer than that starts a new conversation.
  var SESSION_GAP = DAY;

  function isBotUser(users, key) {
    var u = users.get(key);
    return !u || u.role === 'bot' || u.role === 'system';
  }

  // Who answered a ticket: 'bot' (only bots or AI agents), 'mixed' (bot, then an agent) or 'agent'.
  function attention(t) {
    return t.botOut && !t.agentOut ? 'bot' : t.botOut ? 'mixed' : t.agentOut ? 'agent' : 'none';
  }

  // Totals of the messages in [from, to): per ticket, market, business number, author, week and hour of
  // the week. Cost = outbound messages x rate of the ticket's market (defaultMarket when unknown).
  // opts.ticketFilter(id), when set, keeps only the tickets it accepts.
  // opts.sample (a sampled result's `sample`): totals (messages, costs, groups, weeks, hours) are scaled up to
  // every ticket that may have messages in [from, to), and `s.sample` says by how much and with what margin.
  // Per-ticket figures (s.tickets) stay those of the tickets read.
  function summarize(messages, users, markets, numbers, opts, from, to) {
    var s = {
      outbound: 0, inbound: 0, cost: 0,
      tickets: new Map(), byMarket: new Map(), byNumber: new Map(), byAuthor: new Map(), byWeek: new Map(), byHour: new Map()
    };
    var filter = opts.ticketFilter || null;
    var dom = opts.sample ? sampleDomain(opts.sample, from, to) : null;
    var w = dom ? dom.w : 1;
    messages.forEach(function (m) {
      if (m.at < from || m.at >= to) return;
      if (filter && !filter(m.t)) return;
      var detected = markets.get(m.t) || null;
      var market = detected || numberMarket(numbers.get(m.t), opts) || opts.defaultMarket;
      var rate = opts.rates[market] != null ? opts.rates[market] : opts.rates.Other;
      var t = bump(s.tickets, m.t, function () {
        return { id: m.t, market: market, detected: !!detected, rate: rate, inbound: 0, outbound: 0, cost: 0,
          number: numbers.get(m.t) || UNKNOWN_NUMBER, botOut: 0, agentOut: 0, times: [] };
      });
      t.times.push(m.at);
      var inbound = isInbound(users, m.a);
      var number = t.number;
      if (inbound) { t.inbound += 1; s.inbound += w; return; }

      t.outbound += 1;
      t.cost += rate;
      if (isBotUser(users, m.a)) t.botOut += 1; else t.agentOut += 1;
      s.outbound += w;
      s.cost += rate * w;
      [[s.byMarket, market], [s.byNumber, number], [s.byAuthor, m.a]].forEach(function (p) {
        var g = bump(p[0], p[1], function () { return { key: p[1], outbound: 0, cost: 0, tickets: new Set() }; });
        g.outbound += w;
        g.cost += rate * w;
        g.tickets.add(m.t);
      });
      var wk = bump(s.byWeek, weekStart(m.at), function () { return { outbound: 0, cost: 0 }; });
      wk.outbound += w;
      wk.cost += rate * w;
      // Local hour of the week, 0 = Monday 00:00.
      var d = new Date(m.at * 1000);
      var h = bump(s.byHour, ((d.getDay() + 6) % 7) * 24 + d.getHours(), function () { return { outbound: 0, cost: 0 }; });
      h.outbound += w;
      h.cost += rate * w;
    });
    s.tickets.forEach(function (t) {
      // Tickets per market whose country came from a phone (the rest used defaultMarket).
      var g = s.byMarket.get(t.market);
      if (g) g.detected = (g.detected || 0) + (t.detected ? 1 : 0);
      // Conversations (24 h windows) and how long the ticket kept writing, from its message times.
      var times = t.times.sort(function (a, b) { return a - b; });
      t.sessions = 1;
      for (var i = 1; i < times.length; i++) if (times[i] - times[i - 1] > SESSION_GAP) t.sessions += 1;
      t.first = times[0];
      t.last = times[times.length - 1];
      t.attention = attention(t);
      delete t.times;
    });
    if (dom) {
      var sum = 0;
      var sumSq = 0;
      s.tickets.forEach(function (t) { sum += t.cost; sumSq += t.cost * t.cost; });
      // Fewer than 2 tickets read in the period: no spread to measure, so no margin (null), not a margin of 0.
      s.sample = { n: dom.n, N: dom.N, w: w, s2: variance(sum, sumSq, dom.n),
        margin: dom.n < 2 && dom.n < dom.N ? null : sampleMargin(sum, sumSq, dom.n, dom.N) };
    }
    return s;
  }

  // Sampled results: of the tickets that may have messages in [from, to) (updated since `from`, created before
  // `to`), N were listed and n of them read. Each ticket read stands for w = N / n tickets.
  function sampleDomain(sample, from, to) {
    var N = 0;
    var n = 0;
    sample.rows.forEach(function (r, i) {
      if (r.updated < from || r.created >= to) return;
      N += 1;
      if (i < sample.read) n += 1;
    });
    return { N: N, n: n, w: n ? N / n : 1 };
  }

  // Sample variance of a value over n tickets read (the ones not in `sum` are 0).
  function variance(sum, sumSq, n) {
    return n > 1 ? Math.max(0, (sumSq - sum * sum / n) / (n - 1)) : 0;
  }

  // Margin of error (95%) of a total estimated from a simple random sample: n of N tickets read, whose values
  // add up to sum (squares: sumSq). In the same unit as the values (US$ for costs).
  var Z95 = 1.96;
  function sampleMargin(sum, sumSq, n, N) {
    if (!n || n >= N) return 0;
    return Z95 * N * Math.sqrt((1 - n / N) * variance(sum, sumSq, n) / n);
  }

  // Margin expected once the sample of a period (summary.sample) grows to n tickets, with the same spread.
  function projectMargin(est, n) {
    if (!est || n >= est.N) return 0;
    return Z95 * est.N * Math.sqrt((1 - n / est.N) * est.s2 / Math.max(1, n));
  }

  // Calendar months (local time) that touch [from, to): { key: 'YYYY-MM', start, end, complete }.
  function months(from, to) {
    var out = [];
    var d = new Date(from * 1000);
    for (var y = d.getFullYear(), m = d.getMonth(); ; m++) {
      var start = Math.floor(new Date(y, m, 1).getTime() / 1000);
      var end = Math.floor(new Date(y, m + 1, 1).getTime() / 1000);
      if (start >= to) break;
      var real = new Date(start * 1000);
      out.push({ key: real.getFullYear() + '-' + String(real.getMonth() + 1).padStart(2, '0'), start: start, end: end,
        complete: start >= from && end <= to });
    }
    return out;
  }

  // Groups of tickets by a dimension. keyOf(ticket) returns a key, an array of keys (tags: a ticket
  // counts in each) or null (left out). Rows: { key, tickets, outbound, cost, prev: { tickets, cost } }.
  // Sampled summaries: figures scaled up like the totals, and `margin` (US$, 95%) on the current cost.
  function breakdown(cur, prev, keyOf) {
    var rows = new Map();
    function add(summary, side) {
      if (!summary) return;
      var w = summary.sample ? summary.sample.w : 1;
      summary.tickets.forEach(function (t) {
        var keys = keyOf(t);
        if (keys == null) return;
        (Array.isArray(keys) ? keys : [keys]).forEach(function (k) {
          var r = bump(rows, k, function () { return { key: k, tickets: 0, outbound: 0, cost: 0, sumSq: 0, prev: { tickets: 0, outbound: 0, cost: 0 } }; });
          var target = side === 'prev' ? r.prev : r;
          target.tickets += w;
          target.outbound += t.outbound * w;
          target.cost += t.cost * w;
          if (side === 'cur') r.sumSq += t.cost * t.cost;
        });
      });
    }
    add(cur, 'cur');
    add(prev, 'prev');
    var est = cur && cur.sample;
    return Array.from(rows.values()).filter(function (r) { return r.tickets > 0; }).map(function (r) {
      if (est) r.margin = est.margin == null ? null : sampleMargin(r.cost / est.w, r.sumSq, est.n, est.N);
      delete r.sumSq;
      return r;
    }).sort(function (a, b) { return b.cost - a.cost; });
  }

  // Average cost per ticket overall and per form, group and brand, for the ticket panel's comparison.
  function benchmarks(summary, info) {
    var out = { mean: 0, n: summary.tickets.size, form: {}, group: {}, brand: {} };
    var sums = { form: {}, group: {}, brand: {} };
    var total = 0;
    summary.tickets.forEach(function (t) {
      total += t.cost;
      var i = info && info[t.id];
      if (!i) return;
      ['form', 'group', 'brand'].forEach(function (k) {
        if (!i[k]) return;
        var e = sums[k][i[k]] || (sums[k][i[k]] = [0, 0]);
        e[0] += t.cost;
        e[1] += 1;
      });
    });
    out.mean = out.n ? total / out.n : 0;
    ['form', 'group', 'brand'].forEach(function (k) {
      Object.keys(sums[k]).forEach(function (id) {
        var e = sums[k][id];
        // Rounded to a tenth of a cent: enough for "2× the average" and keeps the shared copy small.
        out[k][id] = [Math.round(e[0] / e[1] * 10000) / 10000, e[1]];
      });
    });
    out.mean = Math.round(out.mean * 10000) / 10000;
    return out;
  }

  // Customer country and business number of each ticket. They depend only on the result, so they are
  // worked out once per result object and reused by every analysis of it (filters, settings, months).
  var prepared = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  function prepare(result, marketForPhone) {
    var hit = prepared && prepared.get(result);
    if (hit && hit.marketForPhone === marketForPhone) return hit;
    var markets = ticketMarkets(result.messages, result.users, marketForPhone);
    // Tickets whose messages gave no customer country: the requester's profile phone.
    Object.keys(result.requesters || {}).forEach(function (t) {
      var id = Number(t);
      if (markets.get(id)) return;
      var u = result.users.get(result.requesters[t]);
      var m = u && u.phone ? marketForPhone(u.phone) : null;
      if (m) markets.set(id, m);
    });
    var p = { marketForPhone: marketForPhone, markets: markets, numbers: ticketNumbers(result.messages, result.users) };
    if (prepared) prepared.set(result, p);
    return p;
  }

  // Most common detected customer country among the tickets with messages in [from, to), without a full analysis.
  function commonMarket(result, marketForPhone, from, to) {
    var markets = prepare(result, marketForPhone).markets;
    var seen = new Set();
    var counts = new Map();
    result.messages.forEach(function (m) {
      if (m.at < from || m.at >= to || seen.has(m.t)) return;
      seen.add(m.t);
      var market = markets.get(m.t);
      if (market) counts.set(market, (counts.get(market) || 0) + 1);
    });
    var best = null;
    counts.forEach(function (n, k) { if (!best || n > counts.get(best)) best = k; });
    return best;
  }

  // Current and previous period of a countMessages result.
  // opts: { rates, defaultMarket, marketForPhone, from, to, prevFrom }
  function analyze(result, opts) {
    if (result.sample) opts = Object.assign({}, opts, { sample: result.sample });
    var prep = prepare(result, opts.marketForPhone);
    var markets = prep.markets;
    var numbers = prep.numbers;
    var out = {
      current: summarize(result.messages, result.users, markets, numbers, opts, opts.from, opts.to),
      previous: opts.prevFrom == null ? null : summarize(result.messages, result.users, markets, numbers, opts, opts.prevFrom, opts.from)
    };
    // Calendar months of both periods, for the comparison with Meta's invoices.
    if (opts.months) {
      out.months = months(opts.prevFrom == null ? opts.from : opts.prevFrom, opts.to).map(function (mo) {
        mo.summary = summarize(result.messages, result.users, markets, numbers, opts, mo.start, Math.min(mo.end, opts.to));
        return mo;
      });
    }
    return out;
  }

  // Monthly cost of a period after Meta's free service messages (per business number per month).
  // groups: [{ outbound, cost, numbers }], one per business number; `numbers` (default 1) lets one group
  // stand for several numbers when the messages do not say which number they used, and 0 gives a group
  // no free messages of its own.
  function monthlyCost(groups, days, freePerNumber) {
    return groups.reduce(function (sum, g) {
      var perMonth = g.outbound / days * 30;
      var avgRate = g.outbound ? g.cost / g.outbound : 0;
      var free = freePerNumber * (g.numbers == null ? 1 : g.numbers);
      return sum + Math.max(0, perMonth - free) * avgRate;
    }, 0);
  }

  // Mean, standard deviation, median, p90 and outliers (z-score above zLimit, default 2).
  function distribution(values, zLimit) {
    var z = zLimit == null ? 2 : zLimit;
    var n = values.length;
    if (!n) return { n: 0, mean: 0, sd: 0, median: 0, p90: 0, max: 0, threshold: Infinity };
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var mean = sorted.reduce(function (s, v) { return s + v; }, 0) / n;
    var variance = n > 1 ? sorted.reduce(function (s, v) { return s + (v - mean) * (v - mean); }, 0) / (n - 1) : 0;
    var sd = Math.sqrt(variance);
    function pct(p) {
      var i = (n - 1) * p;
      var lo = Math.floor(i);
      return sorted[lo] + (sorted[Math.min(lo + 1, n - 1)] - sorted[lo]) * (i - lo);
    }
    // Equal costs summed in another order differ by ~1e-18: that is no spread (it would draw a fake curve).
    if (sd < 1e-9) sd = 0;
    return { n: n, mean: mean, sd: sd, median: pct(0.5), p90: pct(0.9), max: sorted[n - 1], threshold: sd > 0 ? mean + z * sd : Infinity };
  }

  // All comments of one ticket (cursor pagination, 100 per page).
  async function fetchComments(request, ticketId) {
    var comments = [];
    var url = '/api/v2/tickets/' + ticketId + '/comments.json?page[size]=100';
    while (url) {
      var res = await request({ url: url, type: 'GET' });
      push(comments, res.comments);
      url = res.meta && res.meta.has_more && res.links && res.links.next ? toPath(res.links.next) : null;
    }
    return comments;
  }

  // Cost of one ticket from its comments.
  // Cost of one ticket from its conversation as the agent interface shows it (ZAF ticket.conversation).
  // A message counts when its channel is whatsapp or a listed channel; end users' messages are free and
  // everything else (agents, bots/"system", triggers) is charged.
  // opts: { ticket, conversation, users (Map id -> {role, phone}), requesterId, marketForPhone, rates,
  //         defaultMarket, useNumberCountry, channels }
  function singleTicketCost(opts) {
    var list = parseChannels(opts.channels);
    var ticket = opts.ticket || { id: 0 };
    var ends = ticketEnds(ticket);
    var users = new Map(opts.users || []);
    var messages = [];
    (opts.conversation || []).forEach(function (item) {
      var ch = item.channel && item.channel.name ? String(item.channel.name) : '';
      if (!/whatsapp/i.test(ch) && !channelListed(ch, list)) return;
      var author = item.author || {};
      var inbound = author.role === 'end-user';
      var key = author.id != null ? author.id : 'sys:' + (author.name || '?');
      if (!users.has(key)) users.set(key, { role: inbound ? 'end-user' : author.role || 'system', name: author.name || null, phone: null });
      messages.push({ t: ticket.id, a: key, at: Date.parse(item.timestamp) / 1000 || 0,
        fr: inbound ? ends.customer : ends.business, to: inbound ? ends.business : ends.customer });
    });
    var whatsapp = messages.length > 0 || isWhatsAppTicket(ticket, list);
    var market = ticketMarkets(messages, users, opts.marketForPhone).get(ticket.id) || null;
    var requester = users.get(opts.requesterId);
    if (!market && requester && requester.phone) market = opts.marketForPhone(requester.phone);
    if (!market && ends.customer) market = opts.marketForPhone(ends.customer);
    var used = market || numberMarket(ends.business || ticketNumbers(messages, users).get(ticket.id), opts) || opts.defaultMarket;
    var rate = opts.rates[used] != null ? opts.rates[used] : opts.rates.Other;
    var outbound = messages.filter(function (m) { return !isInbound(users, m.a); }).length;
    return {
      whatsapp: whatsapp, outbound: outbound, inbound: messages.length - outbound,
      market: used, detected: !!market, rate: rate, cost: outbound * rate
    };
  }

  // CSV text (semicolon-separated, for Spanish Excel) from rows of plain values.
  function toCsv(header, rows, separator) {
    var sep = separator || ';';
    function cell(v) {
      var s = v == null ? '' : String(v);
      // Neutralize spreadsheet formulas and quote when needed.
      if (/^[=+\-@]/.test(s)) s = "'" + s;
      return /[";,\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    return [header].concat(rows).map(function (r) { return r.map(cell).join(sep); }).join('\r\n');
  }

  // Compact JSON-safe copy of a countMessages result for browser storage: phones are stored once in a table.
  // opts.marketForPhone: when given, customer phones are stored as their market ("m:Chile") and customers'
  // names are left out: browser storage and the shared copy then hold no customer phone or name. Business
  // numbers (the company's own) are kept, since the free tier is counted per number.
  function packResult(result, opts) {
    var mask = opts && opts.marketForPhone ? function (p) {
      if (p == null || /^m:/.test(p)) return p;
      return 'm:' + (opts.marketForPhone(p) || '');
    } : function (p) { return p; };
    var phones = [];
    var index = new Map();
    function ref(p) {
      if (p == null) return -1;
      if (!index.has(p)) { index.set(p, phones.length); phones.push(p); }
      return index.get(p);
    }
    // Ticket fields: tags and custom field values repeat a lot, so they are stored once in a string table.
    var strs = [];
    var sIndex = new Map();
    function s(v) {
      if (!sIndex.has(v)) { sIndex.set(v, strs.length); strs.push(v); }
      return sIndex.get(v);
    }
    var info = result.info || {};
    return {
      status: result.status, phones: phones, scanned: result.scanned || 0, channels: result.channels || {},
      requesters: result.requesters || {}, logMissing: result.logMissing || 0,
      messages: result.messages.map(function (m) {
        var inbound = isInbound(result.users, m.a);
        // Inbound: from the customer to the business number; outbound: the other way round.
        return [m.t, m.a, m.at, ref(inbound ? mask(m.fr) : m.fr), ref(inbound ? m.to : mask(m.to))];
      }),
      users: Array.from(result.users, function (e) {
        var customer = e[1].role === 'end-user';
        return [e[0], e[1].role, customer && opts && opts.marketForPhone ? null : e[1].name, customer && e[1].phone ? mask(e[1].phone) : e[1].phone];
      }),
      strs: strs, names: result.names || null, window: result.window || null, nativeOnly: result.nativeOnly === true,
      // A sample's tickets: [id, created, updated, requester, assignee, channel, rel, customer end, business end].
      sample: result.sample ? { read: result.sample.read, start: result.sample.start, end: result.sample.end,
        rows: result.sample.rows.map(function (r) {
          var src = (r.via && r.via.source) || {};
          return [r.id, r.created, r.updated, r.requester_id || 0, r.assignee_id || 0, r.via ? r.via.channel : null, src.rel || null,
            mask(endpoint(src.from)), endpoint(src.to)];
        }) } : undefined,
      info: Object.keys(info).map(function (id) {
        var i = info[id];
        var fields = [];
        Object.keys(i.fields || {}).forEach(function (f) { fields.push(Number(f), s(i.fields[f])); });
        return [Number(id), i.form, i.brand, i.group, i.assignee, i.org, i.status == null ? -1 : s(i.status), (i.tags || []).map(s), fields];
      })
    };
  }

  function unpackResult(p) {
    var phone = function (i) { return i < 0 ? null : p.phones[i]; };
    var strs = p.strs || [];
    var info = {};
    (p.info || []).forEach(function (e) {
      var fields = {};
      for (var k = 0; k < (e[8] || []).length; k += 2) fields[e[8][k]] = strs[e[8][k + 1]];
      info[e[0]] = { form: e[1], brand: e[2], group: e[3], assignee: e[4], org: e[5], status: e[6] < 0 ? null : strs[e[6]],
        tags: (e[7] || []).map(function (x) { return strs[x]; }), fields: fields };
    });
    var out = {
      status: p.status, scanned: p.scanned || 0, channels: p.channels || {}, requesters: p.requesters || {}, logMissing: p.logMissing || 0,
      messages: p.messages.map(function (m) { return { t: m[0], a: m[1], at: m[2], fr: phone(m[3]), to: phone(m[4]) }; }),
      users: new Map(p.users.map(function (u) { return [u[0], { role: u[1], name: u[2], phone: u[3] }]; })),
      info: info, names: p.names || null, window: p.window || null, nativeOnly: p.nativeOnly === true
    };
    if (p.sample) {
      out.sample = { read: p.sample.read, start: p.sample.start, end: p.sample.end, rows: p.sample.rows.map(function (r) {
        return { id: r[0], created: r[1], updated: r[2], requester_id: r[3] || null, assignee_id: r[4] || null,
          via: { channel: r[5], source: { rel: r[6], from: r[7] == null ? null : { phone: r[7] }, to: r[8] == null ? null : { phone: r[8] } } } };
      }) };
    }
    return out;
  }

  // Amounts Meta billed per month, as an admin typed them in the "meta_billing" setting:
  // "2026-10=123.45, 2026-09=98,10" -> { '2026-10': 123.45, '2026-09': 98.1 } (entries split by ";", a new line
  // or a comma and a space; a comma inside a number has no space after it).
  function parseBilling(text) {
    var out = {};
    String(text || '').split(/[;\n]|,\s+/).forEach(function (part) {
      var m = /^\s*(\d{4}-\d{2})\s*[=:]\s*([\d.,]+)\s*$/.exec(part);
      if (!m) return;
      var v = m[2];
      // "1.234,56" and "1,234.56" both read as 1234.56; a single separator is the decimal one.
      var last = Math.max(v.lastIndexOf(','), v.lastIndexOf('.'));
      var n = last < 0 ? Number(v) : Number(v.slice(0, last).replace(/[.,]/g, '') + '.' + v.slice(last + 1));
      if (isFinite(n) && n >= 0) out[m[1]] = n;
    });
    return out;
  }

  function formatBilling(map) {
    return Object.keys(map || {}).sort().reverse().map(function (k) { return k + '=' + map[k]; }).join(', ');
  }

  var api = {
    packResult: packResult, unpackResult: unpackResult,
    countMessages: countMessages, fetchUsers: fetchUsers, analyze: analyze, monthlyCost: monthlyCost,
    distribution: distribution, weekStart: weekStart, toPath: toPath, toCsv: toCsv,
    buildRange: buildRange, reusableRun: reusableRun, planRun: planRun, runRange: runRange, weeks: weeks,
    fetchComments: fetchComments, singleTicketCost: singleTicketCost, isWhatsAppVia: isWhatsAppVia,
    parseChannels: parseChannels, mergeResults: mergeResults, ticketInfo: ticketInfo, fetchNames: fetchNames,
    breakdown: breakdown, benchmarks: benchmarks, commonMarket: commonMarket, missingNames: missingNames, months: months, parseBilling: parseBilling, formatBilling: formatBilling,
    attention: attention, extendSample: extendSample, countTickets: countTickets, readMinutes: readMinutes,
    sampleDomain: sampleDomain, sampleMargin: sampleMargin, projectMargin: projectMargin
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MessageCounter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
