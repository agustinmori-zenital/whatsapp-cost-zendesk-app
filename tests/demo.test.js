const test = require('node:test');
const assert = require('node:assert/strict');
const counter = require('../assets/counter.js');
const rates = require('../assets/rates.js');
const demo = require('../assets/demo.js');

process.env.TZ = 'America/Argentina/Buenos_Aires';
const DAY = 86400;
const NOW = Math.floor(Date.UTC(2026, 10, 10, 15, 0) / 1000);
const NO_DELAY = { export: 0, log: 0, users: 0, other: 0 };
const fast = { pauseMs: 0, logSpacingMs: 0, partialMs: 0 };

const api = (now = NOW, extra = {}) => demo.createApi({ now: () => now, latency: NO_DELAY, ...extra });

// The dashboard's own flow (range -> runRange -> analyze) over the demo API.
async function run(demoApi, period, from, to, reuse = null) {
  const now = Math.floor(demoApi.now());
  const range = counter.buildRange(period, from, to, now - 120);
  assert.ok(!range.error, JSON.stringify(range));
  const result = await counter.runRange({ request: demoApi.request, range, reuse, ...fast });
  const a = counter.analyze(result, { rates: rates.SERVICE_USD, defaultMarket: 'Argentina', marketForPhone: rates.marketForPhone, from: range.start, to: range.end, prevFrom: range.prevStart });
  return { range, result, ...a };
}

test('demo mode is on only for the demo_mode setting', () => {
  assert.equal(demo.isOn({ demo_mode: true }), true);
  assert.equal(demo.isOn({ demo_mode: 'true' }), true);
  [{}, { demo_mode: false }, { demo_mode: 'false' }, { demo_mode: '' }, null, undefined].forEach((s) => assert.equal(demo.isOn(s), false));
});

test('a demo run exercises every part of the dashboard with realistic data', async () => {
  const r = await run(api(), '30');
  assert.equal(r.result.status, 'done');
  assert.ok(r.result.scanned > r.result.tickets.length, 'the export also has tickets from other channels');
  const cur = r.current;
  const costs = Array.from(cur.tickets.values());
  assert.ok(costs.length > 250 && costs.length < 700, `tickets: ${costs.length}`);
  assert.ok(cur.outbound > cur.inbound * 0.8 && cur.inbound > 0);
  assert.ok(cur.byMarket.size >= 6, 'several countries');
  assert.deepEqual(Array.from(cur.byNumber.keys()).sort(), demo.BUSINESS.slice().sort(), 'two business numbers, none unidentified');
  assert.ok(cur.byAuthor.size >= 6, 'agents and the AI agent');
  const users = r.result.users;
  const bots = Array.from(cur.byAuthor.values()).filter((g) => users.get(g.key).role === 'bot').reduce((s, g) => s + g.outbound, 0);
  assert.ok(bots / cur.outbound > 0.1 && bots / cur.outbound < 0.6, `bot share ${bots / cur.outbound}`);
  const detected = costs.filter((t) => t.detected).length / costs.length;
  assert.ok(detected > 0.8 && detected < 1, `detected ${detected}: some tickets fall back to the default country`);
  const dist = counter.distribution(costs.map((t) => t.cost));
  assert.ok(costs.filter((t) => t.cost > dist.threshold).length >= 3, 'outlier tickets to show');
  assert.ok(r.previous.outbound > 0 && r.previous.tickets.size > 0, 'previous period to compare with');
  assert.ok(cur.byWeek.size >= 4, 'weekly chart');
  const groups = Array.from(cur.byNumber.values()).map((g) => ({ outbound: g.outbound, cost: g.cost, numbers: 1 }));
  assert.ok(counter.monthlyCost(groups, r.range.days, rates.FREE_SERVICE_PER_NUMBER_PER_MONTH) > 0, 'monthly cost above the free messages');
});

test('demo data is deterministic and every message falls inside the chosen dates', async () => {
  const a = await run(api(), '7');
  const b = await run(api(), '7');
  assert.deepEqual([a.current.outbound, a.current.cost, a.current.tickets.size], [b.current.outbound, b.current.cost, b.current.tickets.size]);

  // A custom range in the past: both periods are inside what the demo account holds.
  const c = await run(api(), 'custom', '2026-09-01', '2026-09-15');
  assert.equal(c.range.days, 15);
  assert.ok(c.current.outbound > 0 && c.previous.outbound > 0);
  c.result.messages.forEach((m) => assert.ok(m.at >= c.range.prevStart && m.at < c.range.end, 'message outside both periods'));
  // The same days read later give the same numbers (the past does not change).
  const later = await run(api(NOW + 20 * DAY), 'custom', '2026-09-01', '2026-09-15');
  assert.deepEqual([later.current.outbound, later.current.cost], [c.current.outbound, c.current.cost]);

  // 90 days needs the 90 before it: the demo account holds them.
  const d = await run(api(), '90');
  assert.ok(d.previous.outbound > d.current.outbound * 0.5, 'a full previous period, not a cut-off one');
});

test('the export is paged and lists every ticket once, oldest update first', async () => {
  const demoApi = api();
  const since = NOW - 60 * DAY;
  const seen = [];
  let page = await demoApi.request({ url: '/api/v2/incremental/tickets/cursor.json?start_time=' + since, type: 'GET' });
  let pages = 1;
  seen.push(...page.tickets);
  while (!page.end_of_stream) {
    page = await demoApi.request({ url: '/api/v2/incremental/tickets/cursor.json?cursor=' + encodeURIComponent(page.after_cursor), type: 'GET' });
    seen.push(...page.tickets);
    pages += 1;
  }
  assert.ok(pages >= 3, `pages: ${pages}`);
  assert.equal(new Set(seen.map((t) => t.id)).size, seen.length);
  const updates = seen.map((t) => Date.parse(t.updated_at));
  assert.deepEqual(updates, updates.slice().sort((x, y) => x - y));
  seen.forEach((t) => assert.ok(Date.parse(t.updated_at) / 1000 >= since));
  await assert.rejects(demoApi.request({ url: '/api/v2/tickets/1/conversation_log', type: 'GET' }), (e) => e.status === 404);
  await assert.rejects(demoApi.request({ url: '/api/v2/nothing', type: 'GET' }), (e) => e.status === 404);
});

test('an update run in demo mode matches a full run, as the clock moves', async () => {
  const first = await run(api(NOW), '30');
  const last = { result: first.result, range: first.range, channels: '', savedAt: NOW * 1000 };
  for (const hours of [1, 26, 30]) {
    const demoApi = api(NOW + hours * 3600);
    const range = counter.buildRange('30', '', '', Math.floor(NOW + hours * 3600) - 120);
    const reuse = counter.reusableRun(last, range, '');
    assert.ok(reuse, 'the next run extends the last one');
    const updated = await run(demoApi, '30', '', '', reuse);
    const full = await run(demoApi, '30', '', '');
    const pick = (x) => [x.current.outbound, x.current.inbound, Number(x.current.cost.toFixed(9)), x.current.tickets.size, x.previous.outbound, x.previous.tickets.size];
    assert.deepEqual(pick(updated), pick(full), `after ${hours} h`);
  }
});

test('the demo account never lets demo_mode be saved, only the settings a dashboard may change', async () => {
  const saved = [];
  const demoApi = api(NOW, { settings: { demo_mode: true, default_market: '', business_numbers: 1 }, installationId: 7, onSettings: (s) => saved.push(s) });
  const url = '/api/v2/apps/installations/7.json';
  const before = await demoApi.request({ url, type: 'GET' });
  assert.equal(before.installation.settings.default_market, '');
  await demoApi.request({
    url, type: 'PUT', contentType: 'application/json',
    data: JSON.stringify({ settings: Object.assign({}, before.installation.settings, { default_market: 'Chile', whatsapp_channels: 'x', demo_mode: false, evil: 1 }) })
  });
  assert.deepEqual(saved, [{ default_market: 'Chile', whatsapp_channels: 'x' }], 'only what changed, never demo_mode or the installation\'s own values');
  const after = await demoApi.request({ url, type: 'GET' });
  assert.deepEqual([after.installation.settings.default_market, after.installation.settings.demo_mode, 'evil' in after.installation.settings], ['Chile', true, false]);
});

test('settings saved in demo mode live in browser storage and never include demo_mode', () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  try {
    assert.deepEqual(demo.storedSettings(), {});
    demo.saveSettings({ default_market: 'Perú' });
    demo.saveSettings({ whatsapp_channels: 'a', demo_mode: false });
    assert.deepEqual(demo.storedSettings(), { default_market: 'Perú', whatsapp_channels: 'a' });
    store.set('wa-cost:demo:settings', '{broken');
    assert.deepEqual(demo.storedSettings(), {}, 'bad storage is ignored');
  } finally {
    delete globalThis.localStorage;
  }
});

test('the ticket panel shows a WhatsApp conversation for any open ticket, always the same one', () => {
  const cost = (id, now = NOW) => {
    const v = demo.ticketView(id, now);
    return counter.singleTicketCost({
      ticket: v.ticket, conversation: v.conversation, users: v.users, requesterId: v.requesterId,
      marketForPhone: rates.marketForPhone, rates: rates.SERVICE_USD, defaultMarket: 'Other', useNumberCountry: true
    });
  };
  [1067, 3, 99999999, 770712].forEach((id) => {
    const r = cost(id);
    assert.equal(r.whatsapp, true, `ticket ${id}`);
    assert.ok(r.outbound >= 1 && r.inbound >= 1, `ticket ${id}: ${r.outbound} sent, ${r.inbound} received`);
    assert.ok(Math.abs(r.cost - r.outbound * r.rate) < 1e-12);
    assert.deepEqual(cost(id), r, 'same ticket, same conversation');
  });
  // Business number's country when the customer country is unknown: the panel's usual fallback still works.
  assert.ok(Array.from({ length: 40 }, (_, i) => cost(1000 + i).market).some((m) => m !== 'Other'));
});
