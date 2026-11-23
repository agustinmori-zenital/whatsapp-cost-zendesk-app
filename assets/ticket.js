(function () {
  'use strict';

  var client = ZAFClient.init();
  var counter = window.MessageCounter;
  var rates = window.MetaRates;
  var demoMode = window.WaDemo;
  var shareLib = window.WaShare;
  var i18n = window.WaI18n;
  var tr = i18n.t;
  var $ = function (id) { return document.getElementById(id); };

  function fmt(n) { return Math.round(n).toLocaleString(i18n.locale(), { useGrouping: 'always' }); }
  function dec(n, d) { return n.toLocaleString(i18n.locale(), { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function money(n) { return 'US$ ' + dec(n, n > 0 && n < 0.1 ? 3 : 2); }
  function rate(n) { return 'US$ ' + n.toLocaleString(i18n.locale(), { maximumFractionDigits: 4 }); }

  function recall(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function resize() {
    client.invoke('resize', { width: '100%', height: Math.ceil(document.body.scrollHeight) + 'px' });
  }

  function times(n) { return n.toLocaleString(i18n.locale(), { maximumFractionDigits: 1 }) + '×'; }

  // Averages of the last dashboard calculation: the shared copy (custom object) when there is one,
  // else the one saved by a dashboard opened in this browser.
  // Reading the shared averages lists every shared record (the whole result), so each browser keeps the
  // averages for a few hours instead of downloading them on every ticket it opens.
  var BENCH_TTL_MS = 6 * 3600 * 1000;
  var benchCache = null;
  function loadBenchmarks(request, demo) {
    if (benchCache) return benchCache;
    var suffix = demo ? ':demo' : '';
    var read = function (key) {
      try { return JSON.parse(recall(key)); } catch (e) { return null; }
    };
    var kept = read('wa-cost:benchmarks:shared' + suffix);
    var fresh = kept && kept.fetchedAt && Date.now() - kept.fetchedAt < BENCH_TTL_MS;
    var shared = fresh || !shareLib ? Promise.resolve(kept && kept.data) : shareLib.create(request).benchmarks().then(function (data) {
      try { localStorage.setItem('wa-cost:benchmarks:shared' + suffix, JSON.stringify({ fetchedAt: Date.now(), data: data })); } catch (e) { /* storage blocked */ }
      return data;
    });
    benchCache = shared.catch(function () { return kept && kept.data; }).then(function (data) {
      var mine = read('wa-cost:benchmarks' + suffix);
      return data && (!mine || (data.savedAt || 0) >= (mine.savedAt || 0)) ? data : mine;
    });
    return benchCache;
  }

  // "2,1× the average": overall, and within the ticket's form and group when they have enough tickets.
  function renderCompare(cost, bench, where) {
    var box = $('compare');
    box.replaceChildren();
    if (!bench || !bench.mean) { box.hidden = true; return; }
    function line(text, avg) {
      var p = document.createElement('p');
      p.appendChild(document.createTextNode(text + ' '));
      var b = document.createElement('strong');
      b.textContent = money(avg);
      p.appendChild(b);
      if (avg > 0) {
        var t = document.createElement('span');
        t.className = 'times' + (cost <= avg ? ' low' : '');
        t.textContent = cost <= avg ? tr('debajo') : times(cost / avg);
        t.title = cost <= avg ? tr('Este ticket cuesta menos que el promedio') : tr('Este ticket cuesta {x} el promedio', { x: times(cost / avg) });
        p.appendChild(t);
      }
      box.appendChild(p);
    }
    line(tr('Promedio de un ticket de WhatsApp:'), bench.mean);
    var names = bench.names || {};
    [['form', 'Promedio en el formulario {name}:'], ['group', 'Promedio en el grupo {name}:']].forEach(function (k) {
      var id = where[k[0]];
      var e = id && bench[k[0]] && bench[k[0]][id];
      if (e && e[1] >= 5) line(tr(k[1], { name: (names[k[0]] || {})[id] || '#' + id }), e[0]);
    });
    if (bench.savedAt) {
      var d = new Date(bench.savedAt);
      var note = document.createElement('p');
      note.className = 'small';
      note.textContent = tr('Según el cálculo del {date} en el dashboard.', { date: d.toLocaleDateString(i18n.locale(), { day: '2-digit', month: '2-digit' }) });
      box.appendChild(note);
    }
    box.hidden = false;
  }

  function show(id) {
    ['loading', 'cost', 'not-wa', 'error'].forEach(function (x) { $(x).hidden = x !== id; });
    resize();
  }

  var loads = 0; // a slow older load must not draw over a newer one

  // The interface language: the viewer's choice in the dashboard, else the Zendesk profile's.
  var ready = i18n.init(client).then(function () { i18n.translatePage(document.body); });

  async function load() {
    var mine = ++loads;
    await ready;
    show('loading');
    // ticket.conversation is the conversation the agent sees, messaging messages included (the
    // comments API does not return messaging messages).
    var first = await Promise.all([
      client.metadata(),
      client.get(['ticket.id', 'ticket.requester.id', 'ticket.conversation']),
      // Optional: form, brand and group for the comparison with averages (not every account has forms).
      client.get(['ticket.form.id', 'ticket.brand.id', 'ticket.assignee']).catch(function () { return {}; })
    ]);
    if (mine !== loads) return;
    var md = first[0];
    var data = first[1];
    var ticketId = data['ticket.id'];
    var requesterId = data['ticket.requester.id'];
    var demo = demoMode.isOn(md && md.settings);
    $('demo-badge').hidden = !demo;
    // A new ticket has no id or messages yet.
    if (!ticketId) { show('not-wa'); return; }

    var settings = (md && md.settings) || {};
    var extra = first[2] || {};
    var assignee = extra['ticket.assignee'] || {};
    var where = { form: (extra['ticket.form'] || {}).id || extra['ticket.form.id'], brand: (extra['ticket.brand'] || {}).id || extra['ticket.brand.id'],
      group: assignee.group && assignee.group.id };
    var request = function (o) { return client.request(o); };
    var ticket, conversation, users;
    if (demo) {
      // Simulated conversation for whatever ticket is open: nothing is read from the account.
      var view = demoMode.ticketView(ticketId);
      ticket = view.ticket;
      conversation = view.conversation;
      users = view.users;
      requesterId = view.requesterId;
      settings = Object.assign({}, settings, demoMode.storedSettings());
      where = { form: view.form, brand: view.brand, group: view.group };
      request = demoMode.createApi({ settings: settings }).request;
    } else {
      // Independent calls run at once: the ticket's via (phones) and the requester's profile phone.
      var loaded = await Promise.all([
        request({ url: '/api/v2/tickets/' + ticketId + '.json', type: 'GET' }),
        requesterId ? counter.fetchUsers(request, [requesterId]) : new Map()
      ]);
      if (mine !== loads) return;
      ticket = loaded[0].ticket;
      conversation = data['ticket.conversation'] || [];
      users = loaded[1];
    }
    // Saved setting; without one, the business number's country, then the most common country of the
    // last dashboard run in this browser.
    var chosen = rates.findMarket(settings.default_market);
    var defaultMarket = chosen || rates.findMarket(recall('wa-cost:common-market' + (demo ? ':demo' : ''))) || 'Other';

    var r = counter.singleTicketCost({
      ticket: ticket, conversation: conversation, users: users, requesterId: requesterId,
      marketForPhone: rates.marketForPhone, rates: rates.SERVICE_USD, defaultMarket: defaultMarket, useNumberCountry: !chosen,
      channels: settings.whatsapp_channels
    });

    if (mine !== loads) return;
    if (!r.whatsapp) { show('not-wa'); return; }
    $('value').textContent = money(r.cost);
    $('formula').textContent = tr('{n} mensajes × {rate}', { n: fmt(r.outbound), rate: rate(r.rate) });
    $('sent').textContent = fmt(r.outbound);
    $('received').textContent = fmt(r.inbound);
    $('market').textContent = rates.name(r.market, i18n.locale()) + (r.detected ? '' : ' ' + tr('(supuesto)'));
    var note = $('note');
    note.hidden = r.detected;
    note.textContent = tr('No encontramos el teléfono del cliente; usamos la tarifa de {market}. Un administrador puede guardar el país por defecto desde el dashboard (Ajustes).',
      { market: rates.name(r.market, i18n.locale()) });
    renderCompare(r.cost, null, where);
    show('cost');
    var bench = await loadBenchmarks(request, demo);
    if (mine !== loads) return;
    renderCompare(r.cost, bench, where);
    resize();
  }

  function fail(err, mine) {
    if (mine !== loads) return;
    $('error').textContent = err && err.status === 403
      ? tr('No tienes permiso para ver los comentarios de este ticket.')
      : tr('No pudimos calcular el costo de este ticket.');
    show('error');
  }

  function run() {
    var next = loads + 1; // the id load() is about to take
    load().catch(function (err) { fail(err, next); });
  }

  run();
  // Recalculate when a new message is added while the ticket is open.
  var timer;
  client.on('app.willDestroy', function () { clearTimeout(timer); });
  client.on('ticket.conversation.changed', function () {
    clearTimeout(timer);
    timer = setTimeout(run, 1500);
  });
})();
