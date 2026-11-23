(function (root) {
  'use strict';

  // Demo mode ("Modo de prueba", app setting demo_mode): a fake Zendesk account for webinars. It answers the
  // same API paths the app calls, so the dashboard and the ticket panel run their normal code on simulated
  // data: nothing is read from or written to the real account.
  //
  // The data is deterministic: every ticket is generated from its day and slot number, so the same ticket
  // always has the same conversation, and only the clock decides how much of it exists yet.

  var DAY = 86400;
  var HISTORY_DAYS = 200; // a 90-day run reads 180 days; the rest is margin
  var EPOCH_DAY = 20000; // ticket ids count the days from here (2024-10-04)
  var ID_BASE = 700000;
  var SLOTS = 100; // ticket ids per day
  var PAGE_SIZE = 300; // tickets per export page (several pages, like a real account)
  var REQUESTER_BASE = 50000;
  var REQUESTERS = 900;
  var BOT_ID = -1;
  var BUSINESS = ['+54 11 5550 1000', '+52 55 5550 2000'];
  var AGENTS = [
    { id: 8101, name: 'Ana Pérez' }, { id: 8102, name: 'Federico Gómez' }, { id: 8103, name: 'Lucía Fernández' },
    { id: 8104, name: 'Martín Rojas' }, { id: 8105, name: 'Sofía Díaz' }
  ];
  var BOT_NAME = 'Asistente IA';
  // Names of the demo account in the interface language, so a presentation in English or Portuguese shows no Spanish data.
  var NAMES = {
    en: { 'Asistente IA': 'AI Assistant', 'Soporte N1': 'Support L1', 'Soporte N2': 'Support L2', 'Ventas': 'Sales',
      'Consultas generales': 'General questions', 'Reclamos': 'Complaints', 'Envío': 'Shipping', 'Pago': 'Payment',
      'Devolución': 'Returns', 'Producto': 'Product', 'Motivo de contacto': 'Contact reason', 'Cliente': 'Customer',
      'Mayorista Norte': 'North Wholesale', 'Cadena Sur': 'South Retail' },
    'pt-BR': { 'Asistente IA': 'Assistente IA', 'Soporte N1': 'Suporte N1', 'Soporte N2': 'Suporte N2', 'Ventas': 'Vendas',
      'Consultas generales': 'Dúvidas gerais', 'Reclamos': 'Reclamações', 'Envío': 'Envio', 'Pago': 'Pagamento',
      'Devolución': 'Devolução', 'Producto': 'Produto', 'Motivo de contacto': 'Motivo do contato', 'Cliente': 'Cliente',
      'Mayorista Norte': 'Atacado Norte', 'Cadena Sur': 'Rede Sul' }
  };
  function L(text) {
    var lang = root.WaI18n && root.WaI18n.locale();
    return (NAMES[lang] && NAMES[lang][text]) || text;
  }
  var STORAGE_SETTINGS = 'wa-cost:demo:settings';
  var STORAGE_OBJECTS = 'wa-cost:demo:objects';
  // Settings the demo may save; demo_mode itself is only ever read from the real installation.
  var SAVED_SETTINGS = ['default_market', 'whatsapp_channels', 'business_numbers', 'monthly_budget', 'meta_billing', 'auto_refresh_hours'];
  // Forms, brands (one per business number), groups, organizations and a "contact reason" dropdown.
  var FORMS = { 360001: 'Consultas generales', 360002: 'Reclamos', 360003: 'Ventas' };
  var BRANDS = { 9100: 'Zeni Argentina', 9200: 'Zeni México' };
  var GROUPS = { 4100: 'Soporte N1', 4200: 'Soporte N2', 4300: 'Ventas' };
  var AGENT_GROUP = { 8101: 4100, 8102: 4100, 8103: 4200, 8104: 4200, 8105: 4300 };
  var ORGS = { 600: 'Mayorista Norte', 601: 'Cadena Sur' };
  var REASON_FIELD = 9001;
  var REASONS = { motivo_envio: 'Envío', motivo_pago: 'Pago', motivo_devolucion: 'Devolución', motivo_producto: 'Producto' };
  // Pace of a demo run: a few seconds for 30 days, visible progress, no 6.5 s pauses between export pages.
  var TIMING = { pauseMs: 250, logSpacingMs: 0 };
  var LATENCY = { export: 200, log: 6, users: 60, other: 30 };

  // Customer countries: calling-code format and share of customers.
  var COUNTRIES = [
    ['AR', 35], ['MX', 22], ['CL', 12], ['CO', 10], ['BR', 8], ['PE', 5], ['ES', 4], ['US', 2], ['GB', 2]
  ];

  function isOn(settings) {
    var v = settings && settings.demo_mode;
    return v === true || v === 'true' || v === 1 || v === '1';
  }

  // --- deterministic randomness -------------------------------------------------------------------

  function seedOf() {
    var h = 2166136261;
    for (var i = 0; i < arguments.length; i++) h = Math.imul(h ^ (arguments[i] | 0), 16777619);
    return h >>> 0;
  }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pick(r, table) {
    var total = table.reduce(function (s, e) { return s + e[1]; }, 0);
    var x = r() * total;
    for (var i = 0; i < table.length; i++) { x -= table[i][1]; if (x < 0) return table[i][0]; }
    return table[table.length - 1][0];
  }

  function digits(r, n) {
    var s = '';
    for (var i = 0; i < n; i++) s += Math.floor(r() * 10);
    return s;
  }

  var PHONE = {
    AR: function (r) { return '+54 9 11 5550 ' + digits(r, 4); },
    MX: function (r) { return '+52 55 5550 ' + digits(r, 4); },
    CL: function (r) { return '+56 9 5550 ' + digits(r, 4); },
    CO: function (r) { return '+57 300 555 ' + digits(r, 4); },
    BR: function (r) { return '+55 11 95550 ' + digits(r, 4); },
    PE: function (r) { return '+51 900 555 ' + digits(r, 3); },
    ES: function (r) { return '+34 600 555 ' + digits(r, 3); },
    US: function (r) { return '+1 415 555 01' + digits(r, 2); },
    GB: function (r) { return '+44 7700 900' + digits(r, 3); }
  };

  // A customer: the country and phone never change between their tickets.
  function customer(id) {
    var r = mulberry32(seedOf(7, id));
    return { id: id, name: L('Cliente') + ' ' + id, phone: PHONE[pick(r, COUNTRIES)](r), profilePhone: r() < 0.7 };
  }

  // --- tickets ------------------------------------------------------------------------------------

  function ticketId(day, slot) { return ID_BASE + (day - EPOCH_DAY) * SLOTS + slot; }

  function iso(unix) { return new Date(unix * 1000).toISOString(); }

  function message(at, author, source) {
    return { type: 'Messaging::ConversationMessage', created_at: iso(at), author: author, source: { type: source }, at: at };
  }

  // An internal note: part of the conversation log, but not a WhatsApp message.
  function note(at, author) {
    return { type: 'Comment', created_at: iso(at), author: author, at: at };
  }

  // One ticket as it will be once all its time has passed. Messages come as the production conversation
  // log returns them: customers as "end-user" (source "whatsapp"), the AI agent as "system" with user id
  // -1 (source "ultimate") and human agents as "agent". opts.whatsapp forces a WhatsApp ticket and
  // opts.id replaces the ticket id (the ticket panel shows any open ticket as a demo conversation).
  function buildTicket(day, slot, opts) {
    opts = opts || {};
    var r = mulberry32(seedOf(1, day, slot));
    var id = opts.id != null ? opts.id : ticketId(day, slot);
    var created = day * DAY + 11 * 3600 + Math.floor(r() * 12 * 3600);
    var draw = r() < 0.78; // always drawn, so a forced ticket keeps the same random stream
    var whatsapp = opts.whatsapp || draw;
    var requesterId = REQUESTER_BASE + Math.floor(r() * REQUESTERS);
    var t = { id: id, requesterId: requesterId, created: created, status: r() < 0.8 ? 'solved' : 'open', whatsapp: whatsapp, events: [] };

    if (!whatsapp) {
      t.via = { channel: r() < 0.7 ? 'email' : 'web', source: { from: {}, to: {}, rel: null } };
      t.events.push(note(created + Math.floor(r() * 6 * 3600), { type: 'agent' }));
      t.info = { ticket_form_id: 360001, brand_id: 9100, group_id: 4100, assignee_id: 8101, organization_id: null, tags: [], custom_fields: [] };
      return t;
    }

    var cust = customer(requesterId);
    var business = BUSINESS[r() < 0.62 ? 0 : 1];
    // Most tickets carry the customer phone; the rest rely on the profile phone, or on the default country.
    t.via = { channel: 'whatsapp', source: { from: r() < 0.75 ? { phone: cust.phone } : {}, to: { phone: business }, rel: null } };

    var sent = r() < 0.04 ? 25 + Math.floor(r() * 45) : 3 + Math.floor(-Math.log(1 - r()) * 5);
    var sessions = 1 + (r() < 0.2 ? 1 : 0) + (r() < 0.05 ? 1 : 0); // some customers come back days later
    var botReplies = r() < 0.85 ? 1 + Math.floor(r() * 3) : 0;
    var agent = AGENTS[Math.floor(r() * AGENTS.length)];
    var customerAuthor = { type: 'end-user', 'zen:support:user_id': requesterId, display_name: cust.name };
    var botAuthor = { type: 'system', 'zen:support:user_id': BOT_ID, display_name: L(BOT_NAME) };
    var agentAuthor = { type: 'agent', 'zen:support:user_id': agent.id, display_name: agent.name };

    var at = created;
    var left = sent;
    for (var s = 0; s < sessions && left > 0; s++) {
      var n = s === sessions - 1 ? left : Math.max(1, Math.min(left, Math.round(left / (sessions - s) * (0.6 + 0.8 * r()))));
      if (s > 0) at += DAY * (1 + Math.floor(r() * 2)) + Math.floor(r() * 4 * 3600);
      t.events.push(message(at, customerAuthor, 'whatsapp'));
      for (var i = 0; i < n; i++) {
        at += 20 + Math.floor(r() * 600);
        t.events.push(s === 0 && i < botReplies ? message(at, botAuthor, 'ultimate') : message(at, agentAuthor, 'zd:agentWorkspace'));
        if (i < n - 1 && r() < 0.75) { at += 15 + Math.floor(r() * 400); t.events.push(message(at, customerAuthor, 'whatsapp')); }
      }
      left -= n;
    }
    if (r() < 0.15) t.events.push(note(at + 30, { type: 'agent', 'zen:support:user_id': agent.id }));
    describe(t, day, slot, { sent: sent, business: business, agent: agent, botOnly: !t.events.some(function (e) { return e.author.type === 'agent' && e.type === 'Messaging::ConversationMessage'; }) });
    return t;
  }

  // Ticket fields, from a stream of their own so the conversations above never change. Complaints are
  // the long conversations, sales the short ones; bot-only tickets have no assignee.
  function describe(t, day, slot, w) {
    var r = mulberry32(seedOf(4, day, slot));
    var form = w.sent > 8 ? (r() < 0.7 ? 360002 : 360001) : r() < 0.35 ? 360003 : r() < 0.8 ? 360001 : 360002;
    var reasons = Object.keys(REASONS);
    var reason = form === 360003 ? 'motivo_producto' : form === 360002 ? (r() < 0.6 ? 'motivo_devolucion' : 'motivo_envio') : reasons[Math.floor(r() * reasons.length)];
    var tags = [];
    if (form === 360002) tags.push('reclamo');
    if (r() < 0.1) tags.push('vip');
    if (r() < 0.15) tags.push('promo_navidad');
    t.info = {
      ticket_form_id: form, brand_id: w.business === BUSINESS[0] ? 9100 : 9200,
      group_id: w.botOnly ? null : AGENT_GROUP[w.agent.id], assignee_id: w.botOnly ? null : w.agent.id,
      organization_id: r() < 0.15 ? (r() < 0.5 ? 600 : 601) : null, tags: tags,
      custom_fields: [{ id: REASON_FIELD, value: r() < 0.9 ? reason : null }, { id: 9002, value: null }]
    };
  }

  // Events that exist at unix time `now` (everything is in the past for finished days).
  function visibleEvents(t, now) {
    return t.events.filter(function (e) { return e.at <= now; });
  }

  function updatedAt(t, now) {
    var ev = visibleEvents(t, now);
    return ev.length ? ev[ev.length - 1].at : t.created;
  }

  function dayOf(unix) { return Math.floor(unix / DAY); }

  // Tickets per day: busy weekdays, quiet weekends.
  function ticketsOn(day) {
    var r = mulberry32(seedOf(2, day));
    var weekday = (day + 4) % 7; // 0 = Sunday; unix day 0 was a Thursday
    var base = weekday === 0 ? 6 : weekday === 6 ? 9 : 22;
    return Math.max(2, base + Math.floor(r() * 9) - 4);
  }

  // --- API ----------------------------------------------------------------------------------------

  function createApi(opts) {
    opts = opts || {};
    var clock = opts.now || function () { return Date.now() / 1000; };
    var latency = Object.assign({}, LATENCY, opts.latency || {});
    var settings = Object.assign({}, opts.settings || {});
    var all = null;
    var byId = null;
    var builtFor = null;

    function tickets() {
      var today = dayOf(clock());
      if (builtFor !== today) {
        all = [];
        byId = new Map();
        for (var d = today - HISTORY_DAYS; d <= today; d++) {
          for (var k = 0, n = ticketsOn(d); k < n; k++) {
            var t = buildTicket(d, k);
            all.push(t);
            byId.set(t.id, t);
          }
        }
        builtFor = today;
      }
      return all;
    }

    function find(id) {
      tickets();
      return byId.get(Number(id)) || null;
    }

    function later(ms, value) {
      return ms > 0 ? new Promise(function (resolve) { setTimeout(function () { resolve(value); }, ms); }) : Promise.resolve(value);
    }

    function fail(status, url) {
      return Promise.reject({ status: status, path: String(url).split('?')[0], responseJSON: { error: 'RecordNotFound' } });
    }

    // Incremental export page: tickets updated since start_time, oldest first. The cursor remembers the
    // moment the run started, so a run sees one consistent snapshot even while the clock moves.
    function exportPage(url) {
      var cursor = /[?&]cursor=([^&]+)/.exec(url);
      var start = Number((/[?&]start_time=(\d+)/.exec(url) || [])[1] || 0);
      var snapshot = Math.floor(clock());
      var from = 0;
      if (cursor) {
        var parts = decodeURIComponent(cursor[1]).split('.');
        start = Number(parts[1]);
        snapshot = Number(parts[2]);
        from = Number(parts[3]);
      }
      var rows = tickets().filter(function (t) { return t.created <= snapshot && updatedAt(t, snapshot) >= start; })
        .map(function (t) { return { t: t, u: updatedAt(t, snapshot) }; })
        .sort(function (a, b) { return a.u - b.u || a.t.id - b.t.id; });
      var page = rows.slice(from, from + PAGE_SIZE).map(function (e) { return row(e.t, e.u); });
      var more = from + PAGE_SIZE < rows.length;
      return later(latency.export, {
        tickets: page, end_of_stream: !more,
        after_cursor: more ? ['demo', start, snapshot, from + PAGE_SIZE].join('.') : null
      });
    }

    function row(t, u) {
      return Object.assign({
        id: t.id, requester_id: t.requesterId, status: t.status, via: t.via,
        created_at: iso(t.created), updated_at: iso(u), generated_timestamp: u
      }, t.info);
    }

    // Search Export: "via:whatsapp updated>=<ISO time>", native WhatsApp tickets only, ordered by creation.
    function searchPage(url) {
      var q = decodeURIComponent((/[?&]query=([^&]*)/.exec(url) || [])[1] || '');
      var since = Date.parse((/updated>=(\S+)/.exec(q) || [])[1] || 0) / 1000 || 0;
      var cursor = /[?&]page\[after\]=([^&]+)/.exec(url);
      var snapshot = cursor ? Number(decodeURIComponent(cursor[1]).split('.')[1]) : Math.floor(clock());
      var from = cursor ? Number(decodeURIComponent(cursor[1]).split('.')[2]) : 0;
      var rows = tickets().filter(function (t) {
        return t.via.channel === 'whatsapp' && /via:whatsapp/.test(q) && t.created <= snapshot && updatedAt(t, snapshot) >= since;
      }).sort(function (a, b) { return a.created - b.created || a.id - b.id; });
      var size = Math.min(1000, Number((/page\[size\]=(\d+)/.exec(url) || [])[1]) || 100);
      var more = from + size < rows.length;
      var next = more ? ['s', snapshot, from + size].join('.') : null;
      return later(latency.export, {
        results: rows.slice(from, from + size).map(function (t) { return row(t, updatedAt(t, snapshot)); }),
        meta: { has_more: more, after_cursor: next },
        links: { next: more ? 'https://demo.zendesk.com/api/v2/search/export.json?filter[type]=ticket&page[size]=' + size + '&query=' + encodeURIComponent(q) + '&page[after]=' + next : null }
      });
    }

    // Search count: "type:ticket via:whatsapp updated>=<ISO time>".
    function searchCount(url) {
      var q = decodeURIComponent((/[?&]query=([^&]*)/.exec(url) || [])[1] || '');
      var since = Date.parse((/updated>=(\S+)/.exec(q) || [])[1] || 0) / 1000 || 0;
      var now = Math.floor(clock());
      var n = tickets().filter(function (t) { return t.via.channel === 'whatsapp' && t.created <= now && updatedAt(t, now) >= since; }).length;
      return later(latency.other, { count: n });
    }

    // List Tickets sorted by -updated_at (cursor pages of 100), the app's fallback when the export is refused.
    function listPage(url) {
      var cursor = /[?&]page\[after\]=([^&]+)/.exec(url);
      var snapshot = cursor ? Number(decodeURIComponent(cursor[1]).split('.')[1]) : Math.floor(clock());
      var from = cursor ? Number(decodeURIComponent(cursor[1]).split('.')[2]) : 0;
      var rows = tickets().filter(function (t) { return t.created <= snapshot; })
        .map(function (t) { return { t: t, u: updatedAt(t, snapshot) }; })
        .sort(function (a, b) { return b.u - a.u || b.t.id - a.t.id; });
      var more = from + 100 < rows.length;
      var next = ['l', snapshot, from + 100].join('.');
      return later(latency.other, {
        tickets: rows.slice(from, from + 100).map(function (e) { return row(e.t, e.u); }),
        meta: { has_more: more }, links: { next: more ? 'https://demo.zendesk.com/api/v2/tickets.json?page[size]=100&sort=-updated_at&page[after]=' + next : null }
      });
    }

    function usersFor(ids) {
      var out = [];
      ids.forEach(function (id) {
        var agent = AGENTS.filter(function (a) { return a.id === id; })[0];
        if (agent) { out.push({ id: id, role: 'agent', name: agent.name, phone: null }); return; }
        if (id >= REQUESTER_BASE && id < REQUESTER_BASE + REQUESTERS) {
          var c = customer(id);
          out.push({ id: id, role: 'end-user', name: c.name, phone: c.profilePhone ? c.phone : null });
        }
      });
      return out;
    }

    // Custom objects (shared results): one object, records kept in this browser so the ticket panel sees them.
    var objects = opts.objects || loadObjects();
    var nextRecord = 1 + objects.records.reduce(function (m, x) { return Math.max(m, x.id); }, 0);
    function saveObjects() {
      if (opts.objects) return;
      try { root.localStorage.setItem(STORAGE_OBJECTS, JSON.stringify(objects)); } catch (e) { /* storage blocked: kept in memory */ }
    }

    function customObjects(url, method, o) {
      var body = typeof o.data === 'string' ? JSON.parse(o.data) : o.data || {};
      if (url === '/api/v2/custom_objects' && method === 'POST') {
        objects.exists = true; objects.fields = [];
        saveObjects();
        return later(latency.other, { custom_object: body.custom_object });
      }
      if (!objects.exists) return fail(404, url);
      var rec = /\/records\/(\d+)/.exec(url);
      if (/\/fields/.test(url)) {
        if (method === 'POST') { objects.fields.push(body.custom_object_field); saveObjects(); }
        return later(latency.other, { custom_object_field: body.custom_object_field });
      }
      if (/\/records/.test(url)) {
        if (method === 'POST') {
          var r = { id: nextRecord++, name: body.custom_object_record.name, custom_object_fields: body.custom_object_record.custom_object_fields, updated_at: iso(clock()) };
          objects.records.push(r);
          saveObjects();
          return later(latency.other, { custom_object_record: r });
        }
        if (method === 'PATCH' && rec) {
          var found = objects.records.filter(function (x) { return x.id === Number(rec[1]); })[0];
          if (!found) return fail(404, url);
          Object.assign(found.custom_object_fields, body.custom_object_record.custom_object_fields);
          found.updated_at = iso(clock());
          saveObjects();
          return later(latency.other, { custom_object_record: found });
        }
        return later(latency.other, { custom_object_records: objects.records.slice(), meta: { has_more: false }, links: {} });
      }
      return later(latency.other, { custom_object: { key: 'wa_cost_snapshot' } });
    }

    function named(map, key) {
      return Object.keys(map).map(function (id) { var o = { id: Number(id), name: L(map[id]) }; if (key) o[key] = L(map[id]); return o; });
    }

    function installation() {
      return { installation: { id: opts.installationId || 1, settings: Object.assign({}, settings) } };
    }

    function request(o) {
      var url = o.url;
      var method = (o.type || 'GET').toUpperCase();
      if (url.indexOf('/api/v2/incremental/tickets') === 0) return exportPage(url);
      if (url.indexOf('/api/v2/search/export') === 0) return searchPage(url);
      if (url.indexOf('/api/v2/search/count') === 0) return searchCount(url);
      if (/^\/api\/v2\/tickets\.json\?/.test(url)) return listPage(url);
      var log = /^\/api\/v2\/tickets\/(\d+)\/conversation_log/.exec(url);
      if (log) {
        var t = find(log[1]);
        if (!t) return fail(404, url);
        return later(latency.log, { events: visibleEvents(t, clock()).map(function (e) {
          var copy = Object.assign({}, e);
          delete copy.at;
          return copy;
        }), meta: { has_more: false }, links: {} });
      }
      if (/^\/api\/v2\/tickets\/\d+\/comments/.test(url)) return later(latency.other, { comments: [], meta: { has_more: false } });
      if (url.indexOf('/api/v2/custom_objects') === 0) return customObjects(url.split('?')[0], method, o);
      if (url.indexOf('/api/v2/ticket_forms') === 0) return later(latency.other, { ticket_forms: named(FORMS, 'display_name') });
      if (url.indexOf('/api/v2/brands') === 0) return later(latency.other, { brands: named(BRANDS) });
      if (url.indexOf('/api/v2/groups') === 0) return later(latency.other, { groups: named(GROUPS), meta: { has_more: false }, links: {} });
      if (url.indexOf('/api/v2/ticket_fields') === 0) {
        return later(latency.other, { ticket_fields: [{ id: REASON_FIELD, title: L('Motivo de contacto'), type: 'tagger',
          custom_field_options: Object.keys(REASONS).map(function (v) { return { name: L(REASONS[v]), value: v }; }) }], meta: { has_more: false }, links: {} });
      }
      if (url.indexOf('/api/v2/organizations/show_many') === 0) {
        var orgIds = decodeURIComponent((/ids=([^&]*)/.exec(url) || [])[1] || '').split(',');
        return later(latency.other, { organizations: orgIds.filter(function (id) { return ORGS[id]; }).map(function (id) { return { id: Number(id), name: L(ORGS[id]) }; }) });
      }
      if (url.indexOf('/api/v2/users/show_many') === 0) {
        var ids = decodeURIComponent((/ids=([^&]*)/.exec(url) || [])[1] || '').split(',').map(Number);
        return later(latency.users, { users: usersFor(ids) });
      }
      if (/^\/api\/v2\/apps\/installations\/\d+/.test(url)) {
        if (method === 'PUT') {
          var body = typeof o.data === 'string' ? JSON.parse(o.data) : o.data || {};
          var saved = {};
          // Only what changed: the rest of the settings sent back are the installation's own values.
          SAVED_SETTINGS.forEach(function (k) {
            if (body.settings && k in body.settings && body.settings[k] !== settings[k]) saved[k] = body.settings[k];
          });
          Object.assign(settings, saved);
          if (opts.onSettings) opts.onSettings(saved);
        }
        return later(latency.other, installation());
      }
      return fail(404, url);
    }

    return { request: request, now: clock };
  }

  // What the ticket panel reads for any open ticket, as a WhatsApp conversation in the shape of ZAF's
  // ticket.conversation. Ids of demo tickets give their own conversation; any other id (a real ticket
  // open while presenting) gets one of the last 30 days, always the same for that id.
  function ticketView(id, nowSec) {
    var now = nowSec == null ? Date.now() / 1000 : nowSec;
    var rel = id - ID_BASE;
    var h = seedOf(3, id);
    var today = dayOf(now);
    var ownDay = rel >= 0 ? EPOCH_DAY + Math.floor(rel / SLOTS) : null;
    var own = ownDay != null && ownDay >= today - HISTORY_DAYS && ownDay <= today && rel % SLOTS < ticketsOn(ownDay);
    var day = own ? ownDay : today - 1 - (h % 30);
    var slot = own ? rel % SLOTS : (h >>> 8) % 20;
    var t = buildTicket(day, slot, { whatsapp: true, id: id });
    var c = customer(t.requesterId);
    var conversation = visibleEvents(t, now).filter(function (e) { return e.type === 'Messaging::ConversationMessage'; }).map(function (e) {
      var customerSide = e.author.type === 'end-user';
      return {
        author: { id: e.author['zen:support:user_id'], name: e.author.display_name, role: customerSide ? 'end-user' : e.author.type === 'system' ? 'system' : 'agent' },
        channel: { name: 'whatsapp' }, timestamp: e.created_at
      };
    });
    return {
      ticket: { id: id, via: t.via }, requesterId: t.requesterId, conversation: conversation,
      form: t.info.ticket_form_id, brand: t.info.brand_id, group: t.info.group_id,
      users: new Map([[t.requesterId, { role: 'end-user', name: c.name, phone: c.profilePhone ? c.phone : null }]])
    };
  }

  // Settings an admin saved from the dashboard while in demo mode (kept in this browser, shared by the
  // dashboard and the ticket panel, which have the same origin).
  function storedSettings() {
    try {
      var s = JSON.parse(root.localStorage.getItem(STORAGE_SETTINGS)) || {};
      var out = {};
      SAVED_SETTINGS.forEach(function (k) { if (k in s) out[k] = s[k]; });
      return out;
    } catch (e) { return {}; }
  }

  function loadObjects() {
    try {
      var o = JSON.parse(root.localStorage.getItem(STORAGE_OBJECTS));
      if (o && Array.isArray(o.records)) return o;
    } catch (e) { /* none saved, or storage blocked */ }
    return { exists: false, fields: [], records: [] };
  }

  function saveSettings(patch) {
    try {
      root.localStorage.setItem(STORAGE_SETTINGS, JSON.stringify(Object.assign(storedSettings(), patch)));
    } catch (e) { /* storage blocked: the demo still works, the saved country just isn't remembered */ }
  }

  var api = {
    isOn: isOn, createApi: createApi, ticketView: ticketView, storedSettings: storedSettings, saveSettings: saveSettings,
    TIMING: TIMING, SAVED_SETTINGS: SAVED_SETTINGS, HISTORY_DAYS: HISTORY_DAYS, BUSINESS: BUSINESS, ID_BASE: ID_BASE
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.WaDemo = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
