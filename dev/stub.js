// Fake ZAF client for a local preview: one export page of WhatsApp tickets, slow conversation logs.
// ?demo=1 turns the app's demo_mode setting on (the fake account of demo.js is used and any request that still
// reaches this client is recorded in window.__zafRequests and fails); ?ticket=1067 sets the open ticket of
// ticket-preview.html; ?locale=en-US or pt-BR sets the agent's language.
(function () {
  var params = new URLSearchParams(location.search);
  var demoOn = params.get('demo') === '1';
  window.__zafRequests = [];
  window.__zafInvokes = [];
  var now = Math.floor(Date.now() / 1000);
  var N = 80, rnd = (function (s) { return function () { s = (s * 16807) % 2147483647; return s / 2147483647; }; })(7);
  var phones = ['+5491155550000', '+56987654321', '+525512345678', '+5511987654321', '+573001234567'];
  var tickets = [], logs = {}, users = {};
  for (var i = 0; i < N; i++) {
    var id = 1000 + i, req = 5000 + i, at = now - Math.floor(rnd() * 55 * 86400);
    users[req] = { id: req, role: 'end-user', name: 'Cliente ' + i, phone: rnd() < .8 ? phones[i % 5] : null };
    tickets.push({ id: id, requester_id: req, status: 'solved', created_at: new Date(at * 1000).toISOString(), updated_at: new Date((at + 3600) * 1000).toISOString(), generated_timestamp: at + 3600, via: { channel: 'whatsapp', source: { from: {}, to: {}, rel: null } } });
    var ev = [], n = 3 + Math.floor(rnd() * (i % 13 === 0 ? 40 : 10));
    for (var k = 0; k < n; k++) {
      var r = rnd(), t = new Date((at + k * 60) * 1000).toISOString();
      ev.push(r < .45 ? { type: 'Messaging::ConversationMessage', created_at: t, author: { type: 'end-user', 'zen:support:user_id': req, display_name: 'Cliente' }, source: { type: 'whatsapp' } }
        : r < .7 ? { type: 'Messaging::ConversationMessage', created_at: t, author: { type: 'system', 'zen:support:user_id': -1, display_name: 'Zeni Retail' }, source: { type: 'ultimate' } }
        : { type: 'Messaging::ConversationMessage', created_at: t, author: { type: 'agent', 'zen:support:user_id': 1 + (i % 3), display_name: ['Ana', 'Federico', 'Lucía'][i % 3] }, source: { type: 'zd:agentWorkspace' } });
    }
    logs[id] = ev;
  }
  [1, 2, 3].forEach(function (a) { users[a] = { id: a, role: 'agent', name: ['Ana', 'Federico', 'Lucía'][a - 1] }; });
  var delay = function (ms, v) { return new Promise(function (r) { setTimeout(function () { r(v); }, ms); }); };
  // For Marketplace screenshots: ?autorun=1 clicks "See cost" after load (and "Calculate everything", or
  // "Estimate from the sample" with &sample=N), &scroll=<element id> shows the dashboard from
  // that element on when the run ends, &filter=form:360002 applies a filter, &dimension=attention picks the breakdown.
  if (params.get('autorun') === '1') {
    window.addEventListener('load', function () {
      if (params.get('dimension')) localStorage.setItem('wa-cost:dimension', params.get('dimension'));
      if (params.get('filter')) {
        var f = params.get('filter').split(':');
        var o = {}; o[f[0]] = f[1];
        localStorage.setItem('wa-cost:filters' + (demoOn ? ':demo' : ''), JSON.stringify(o));
      }
      var tries = setInterval(function () {
        var run = document.getElementById('run');
        if (!run || run.disabled) return;
        clearInterval(tries);
        run.click();
        var wait = setInterval(function () {
          // The time estimate asks first: &sample=N estimates from N tickets, otherwise everything is read.
          var plan = document.getElementById('plan');
          if (plan && !plan.hidden) {
            if (params.get('sample')) {
              document.getElementById('plan-size').value = params.get('sample');
              document.getElementById('plan-sample').click();
            } else {
              document.getElementById('plan-full').click();
            }
            return;
          }
          if (!document.getElementById('loading').hidden || document.getElementById('dashboard').hidden) return;
          clearInterval(wait);
          // Headless screenshots don't keep a scroll position: hide what comes before the target instead.
          var target = params.get('scroll') && document.getElementById(params.get('scroll'));
          for (var el = target; el && el.id !== 'dashboard'; el = el.parentNode) {
            for (var sib = el.previousElementSibling; sib; sib = sib.previousElementSibling) sib.style.display = 'none';
          }
        }, 200);
      }, 200);
    });
  }
  window.ZAFClient = { init: function () { return {
    metadata: function () { return Promise.resolve({ installationId: 1, settings: { business_numbers: 1, demo_mode: demoOn } }); },
    invoke: function () { window.__zafInvokes.push(Array.prototype.slice.call(arguments)); }, on: function () {},
    get: function (keys) {
      // ?locale=pt-BR sets the agent's Zendesk language (default es-419).
      var out = { 'ticket.id': Number(params.get('ticket')) || null, 'ticket.requester.id': 5000, 'ticket.conversation': [],
        'currentUser.locale': params.get('locale') || 'es-419', 'currentUser.name': 'Agus Demo', 'currentUser.email': 'agus@example.com' };
      return Promise.resolve(out);
    },
    request: function (o) {
      var u = o.url;
      window.__zafRequests.push((o.type || 'GET') + ' ' + u);
      if (demoOn) return Promise.reject({ status: 500, path: u.split('?')[0] });
      if (u.indexOf('/incremental/tickets') >= 0) return delay(1500, { tickets: tickets, end_of_stream: true, after_cursor: null });
      var m = u.match(/tickets\/(\d+)\/conversation_log/);
      if (m) return delay(250, { events: logs[m[1]] || [], meta: { has_more: false }, links: {} });
      if (u.indexOf('show_many') >= 0) {
        var ids = u.split('ids=')[1].split(',');
        return delay(200, { users: ids.map(function (x) { return users[x]; }).filter(Boolean) });
      }
      return delay(100, {});
    }
  }; } };
})();
