const test = require('node:test');
const assert = require('node:assert/strict');
const counter = require('../assets/counter.js');
const rates = require('../assets/rates.js');
const demo = require('../assets/demo.js');
const share = require('../assets/share.js');

process.env.TZ = 'America/Argentina/Buenos_Aires';
const DAY = 86400;
const NOW = Math.floor(Date.UTC(2026, 10, 10, 15, 0) / 1000);
const NO_DELAY = { export: 0, log: 0, users: 0, other: 0 };
const fast = { pauseMs: 0, logSpacingMs: 0, partialMs: 0 };
const api = (extra = {}) => demo.createApi({ now: () => NOW, latency: NO_DELAY, objects: { exists: false, fields: [], records: [] }, ...extra });

async function demoRun(period = '30', filter = null) {
  const demoApi = api();
  const range = counter.buildRange(period, '', '', NOW - 120);
  const result = await counter.runRange({ request: demoApi.request, range, ...fast });
  const opts = { rates: rates.SERVICE_USD, defaultMarket: 'Argentina', marketForPhone: rates.marketForPhone, from: range.start, to: range.end, prevFrom: range.prevStart, months: true, ticketFilter: filter };
  return { range, result, ...counter.analyze(result, opts), opts };
}

test('ticket fields are kept from the export: form, brand, group, assignee, organization, tags, short custom fields', () => {
  const info = counter.ticketInfo({
    ticket_form_id: 1, brand_id: 2, group_id: 3, assignee_id: 4, organization_id: null, status: 'open', tags: ['a', 'b'],
    custom_fields: [{ id: 10, value: 'x' }, { id: 11, value: null }, { id: 12, value: ['m', 'n'] }, { id: 13, value: 'y'.repeat(200) }, { id: 14, value: false }, { id: 15, value: true }]
  });
  assert.deepEqual(info, { form: 1, brand: 2, group: 3, assignee: 4, org: null, status: 'open', tags: ['a', 'b'], fields: { 10: 'x', 12: 'm, n', 15: 'true' } });
});

test('a run brings ticket fields and their names, and assignee names', async () => {
  const r = await demoRun();
  const ids = Array.from(r.current.tickets.keys());
  assert.ok(ids.every((id) => r.result.info[id]), 'every WhatsApp ticket has its fields');
  assert.equal(r.result.names.forms[360002], 'Reclamos');
  assert.equal(r.result.names.groups[4100], 'Soporte N1');
  assert.equal(r.result.names.brands[9200], 'Zeni México');
  assert.equal(r.result.names.fields[9001].options.motivo_envio, 'Envío');
  assert.equal(r.result.users.get(8103).name, 'Lucía Fernández');
});

test('names that cannot be read leave the ids, and earlier names are kept', async () => {
  const request = async (o) => {
    if (o.url.startsWith('/api/v2/brands')) return { brands: [{ id: 2, name: 'Marca' }] };
    throw Object.assign(new Error('forbidden'), { status: 403 });
  };
  const names = await counter.fetchNames(request, { 1: { form: 5, brand: 2, group: 3, org: 4, fields: {} } }, { forms: { 5: 'Viejo' } });
  assert.deepEqual(names, { forms: { 5: 'Viejo' }, brands: { 2: 'Marca' }, groups: {}, orgs: {}, fields: {} });
});

test('a filter keeps only its tickets, in both periods, and the totals add up', async () => {
  const all = await demoRun();
  const form = (id) => all.result.info[id] && all.result.info[id].form;
  const parts = [360001, 360002, 360003].map((f) => counter.analyze(all.result, { ...all.opts, ticketFilter: (id) => form(id) === f }));
  const sum = (k, side) => parts.reduce((s, p) => s + p[side][k], 0);
  assert.equal(sum('outbound', 'current'), all.current.outbound);
  assert.ok(Math.abs(sum('cost', 'current') - all.current.cost) < 1e-9);
  assert.equal(sum('outbound', 'previous'), all.previous.outbound);
  parts[1].current.tickets.forEach((t) => assert.equal(form(t.id), 360002));
  assert.ok(parts[1].current.cost / parts[1].current.tickets.size > parts[2].current.cost / parts[2].current.tickets.size, 'complaints cost more per ticket than sales');
});

test('breakdown groups tickets by any key, tags count in each, previous period alongside', async () => {
  const r = await demoRun();
  const rows = counter.breakdown(r.current, r.previous, (t) => String(r.result.info[t.id].group));
  assert.equal(rows.reduce((s, x) => s + x.tickets, 0), r.current.tickets.size);
  assert.ok(Math.abs(rows.reduce((s, x) => s + x.cost, 0) - r.current.cost) < 1e-9);
  assert.ok(rows.every((x) => x.prev.tickets > 0), 'previous period per group');
  assert.deepEqual(rows.map((x) => x.cost), rows.map((x) => x.cost).sort((a, b) => b - a), 'most expensive first');
  const tags = counter.breakdown(r.current, null, (t) => r.result.info[t.id].tags.length ? r.result.info[t.id].tags : '__none');
  assert.ok(tags.reduce((s, x) => s + x.tickets, 0) >= r.current.tickets.size, 'a ticket counts in each of its tags');
  assert.deepEqual(counter.breakdown(r.current, null, () => null), [], 'null keys are left out');
});

test('who answered: only bots, bot then agent, only agents', async () => {
  const r = await demoRun();
  const kinds = new Set();
  r.current.tickets.forEach((t) => {
    kinds.add(t.attention);
    if (t.attention === 'bot') assert.equal(t.agentOut, 0);
    if (t.attention === 'agent') assert.equal(t.botOut, 0);
    assert.equal(t.botOut + t.agentOut, t.outbound);
  });
  assert.deepEqual(['agent', 'bot', 'mixed'].filter((k) => kinds.has(k)), ['agent', 'bot', 'mixed']);
  assert.equal(counter.attention({ botOut: 0, agentOut: 0 }), 'none');
});

test('conversations: a gap of more than 24 h starts another one', () => {
  const users = new Map([[1, { role: 'end-user' }], [2, { role: 'agent' }]]);
  const T = NOW - 10 * DAY;
  const messages = [[1, 0], [2, 60], [1, DAY + 61], [2, DAY + 120], [2, DAY + 200], [1, 3 * DAY]].map(([a, dt]) => ({ t: 7, a, at: T + dt }));
  const s = counter.analyze({ messages, users, requesters: {} }, { rates: rates.SERVICE_USD, defaultMarket: 'Chile', marketForPhone: rates.marketForPhone, from: T, to: NOW }).current;
  const t = s.tickets.get(7);
  assert.equal(t.sessions, 3);
  assert.deepEqual([t.first, t.last], [T, T + 3 * DAY]);
  assert.equal(t.attention, 'agent');
});

test('cost by hour of the week adds up to the total', async () => {
  const r = await demoRun('7');
  let cost = 0;
  let sent = 0;
  r.current.byHour.forEach((h, k) => { assert.ok(k >= 0 && k < 168); cost += h.cost; sent += h.outbound; });
  assert.equal(sent, r.current.outbound);
  assert.ok(Math.abs(cost - r.current.cost) < 1e-9);
});

test('calendar months of both periods, complete only when fully inside the data', async () => {
  const ms = counter.months(Math.floor(new Date(2026, 8, 15).getTime() / 1000), Math.floor(new Date(2026, 10, 10).getTime() / 1000));
  assert.deepEqual(ms.map((m) => [m.key, m.complete]), [['2026-09', false], ['2026-10', true], ['2026-11', false]]);
  const dec = counter.months(Math.floor(new Date(2026, 11, 1).getTime() / 1000), Math.floor(new Date(2027, 1, 1).getTime() / 1000));
  assert.deepEqual(dec.map((m) => [m.key, m.complete]), [['2026-12', true], ['2027-01', true]], 'across a new year');

  const r = await demoRun();
  const oct = r.months.find((m) => m.key === '2026-10');
  assert.ok(oct && oct.complete && oct.summary.outbound > 0);
  const inData = r.result.messages.filter((m) => m.at >= oct.start && m.at < oct.end);
  assert.ok(oct.summary.outbound <= inData.length);
});

test('Meta invoices typed by an admin are read in Spanish and English number formats', () => {
  assert.deepEqual(counter.parseBilling('2026-10=123.45, 2026-09=98,10; 2026-08: 1.234,56\n2026-07=1,234.5, junk, 2026-06=-3'),
    { '2026-10': 123.45, '2026-09': 98.1, '2026-08': 1234.56, '2026-07': 1234.5 });
  assert.equal(counter.formatBilling({ '2026-09': 98.1, '2026-10': 123.45 }), '2026-10=123.45, 2026-09=98.1');
  assert.deepEqual(counter.parseBilling(counter.formatBilling({ '2026-10': 1234.5 })), { '2026-10': 1234.5 });
  assert.deepEqual(counter.parseBilling(''), {});
});

test('benchmarks: average cost per ticket overall and per form, group and brand', async () => {
  const r = await demoRun();
  const b = counter.benchmarks(r.current, r.result.info);
  assert.equal(b.n, r.current.tickets.size);
  assert.ok(Math.abs(b.mean - r.current.cost / b.n) < 1e-4);
  assert.ok(b.form[360002][0] > b.form[360003][0]);
  assert.equal(Object.values(b.brand).reduce((s, e) => s + e[1], 0), b.n);
  assert.ok(JSON.stringify(b).length < 2000, 'small enough for one record');
});

test('the business number comes from the WhatsApp integration when the via has no phone', async () => {
  const events = (integ) => [
    { type: 'Messaging::ConversationMessage', created_at: new Date((NOW - 3600) * 1000).toISOString(), author: { type: 'end-user', 'zen:support:user_id': 50 }, source: { type: 'whatsapp', integration_id: integ } },
    { type: 'Messaging::ConversationMessage', created_at: new Date((NOW - 3500) * 1000).toISOString(), author: { type: 'agent', 'zen:support:user_id': 2 }, source: { type: 'zd:agentWorkspace' } }
  ];
  const logs = { 1: events('64a1b2c3d4e5f60718293a4b'), 2: events('64ffffffffffffffffffffff'), 3: events('64a1b2c3d4e5f60718293a4b') };
  const request = async (o) => {
    if (o.url.includes('/incremental/')) return { tickets: [1, 2, 3].map((id) => ({ id, status: 'open', via: { channel: 'whatsapp', source: { from: {}, to: {} } }, created_at: new Date((NOW - 7200) * 1000).toISOString(), updated_at: new Date((NOW - 3500) * 1000).toISOString() })), end_of_stream: true };
    const m = /tickets\/(\d+)\/conversation_log/.exec(o.url);
    if (m) return { events: logs[m[1]], meta: { has_more: false } };
    if (o.url.includes('show_many')) return { users: [] };
    return {};
  };
  const result = await counter.countMessages({ request, startTime: NOW - DAY, endTime: NOW, ...fast });
  const s = counter.analyze(result, { rates: rates.SERVICE_USD, defaultMarket: 'Chile', marketForPhone: rates.marketForPhone, from: NOW - DAY, to: NOW }).current;
  assert.deepEqual(Array.from(s.byNumber.keys()).sort(), ['wa:64a1b2c3d4e5f60718293a4b', 'wa:64ffffffffffffffffffffff']);
  assert.equal(s.byNumber.get('wa:64a1b2c3d4e5f60718293a4b').tickets.size, 2);
  assert.equal(s.tickets.get(1).market, 'Chile', 'an integration id says nothing about the country');
});

test('an update run keeps ticket fields and takes the new ones of re-read tickets', () => {
  const old = { messages: [], users: new Map(), info: { 1: { form: 1 }, 2: { form: 1 } }, names: { forms: { 1: 'A' } } };
  const fresh = { messages: [], users: new Map(), tickets: [2], info: { 2: { form: 9 } }, names: null, channels: {} };
  const m = counter.mergeResults(old, fresh, 0);
  assert.deepEqual(m.info, { 1: { form: 1 }, 2: { form: 9 } });
  assert.deepEqual(m.names, { forms: { 1: 'A' } });
});

test('shared results: gzip round trip, split into records under 32 KB, readers see a whole result', async () => {
  const objects = { exists: false, fields: [], records: [] };
  const demoApi = demo.createApi({ now: () => NOW, latency: NO_DELAY, objects });
  const s = share.create(demoApi.request);
  assert.equal(await s.status(), 'missing');
  assert.equal(await s.load(), null);
  await s.setup();
  assert.equal(await s.status(), 'ready');
  assert.deepEqual(objects.fields.map((f) => [f.key, f.type]), [['data', 'textarea']]);

  const r = await demoRun('90');
  const snap = { savedAt: 1000, period: '90', range: r.range, channels: '', result: counter.packResult(r.result) };
  const first = await s.publish(snap, { mean: 0.1, n: 5 });
  assert.ok(first.parts >= 2, 'a 90-day result needs several records');
  objects.records.forEach((rec) => assert.ok(JSON.stringify(rec).length < 32 * 1024, rec.name + ' fits in one record'));
  assert.deepEqual(await s.load(), JSON.parse(JSON.stringify(snap)));
  assert.equal((await s.benchmarks()).mean, 0.1);

  // A second publish writes the other generation, then switches the meta record: never a mix of both.
  const smaller = Object.assign({}, snap, { savedAt: 2000, result: counter.packResult((await demoRun('7')).result) });
  await s.publish(smaller, null);
  assert.equal((await s.peek()).gen, 'b');
  assert.equal((await s.load()).savedAt, 2000);
  assert.ok(objects.records.some((rec) => rec.name === 'result-a-0'), 'the old generation stays until it is overwritten');
});

test('shared results report unavailable when the plan has no custom objects', async () => {
  const s = share.create(async () => { throw { status: 403 }; });
  assert.equal(await s.status(), 'unavailable');
  assert.equal(await share.decompress(await share.compress('hola ñandú')), 'hola ñandú');
});

test('the ticket panel demo view carries form, brand and group', () => {
  const v = demo.ticketView(775108, NOW);
  assert.ok(v.form && v.brand);
});

// --- Performance (0.16) ---------------------------------------------------------------------------

// A demo account that counts the calls it receives.
function counted(now = NOW) {
  const demoApi = demo.createApi({ now: () => now, latency: NO_DELAY, objects: { exists: false, fields: [], records: [] } });
  const calls = { export: 0, search: 0, log: 0, other: 0 };
  const request = (o) => {
    const k = o.url.includes('/incremental/') ? 'export' : o.url.includes('/search/export') ? 'search' : o.url.includes('conversation_log') ? 'log' : 'other';
    calls[k] += 1;
    return demoApi.request(o);
  };
  return { request, calls };
}

const pick = (a) => [a.current.outbound, a.current.inbound, Number(a.current.cost.toFixed(9)), a.current.tickets.size, a.previous.outbound, a.previous.tickets.size];
function analyzeFor(result, range) {
  return counter.analyze(result, { rates: rates.SERVICE_USD, defaultMarket: 'Argentina', marketForPhone: rates.marketForPhone, from: range.start, to: range.end, prevFrom: range.prevStart });
}
async function runWith(now, period, from, to, base, extra = {}) {
  const c = counted(now);
  const range = counter.buildRange(period, from, to, now - 120);
  const plan = counter.planRun(base, range, '');
  const result = await counter.runRange({ request: c.request, range, plan, ...fast, ...extra });
  return { range, plan, result, calls: c.calls, a: analyzeFor(result, range) };
}
const asBase = (r, savedAt = NOW * 1000) => ({ result: r.result, range: r.range, channels: '', savedAt });

test('a range inside the last calculation is answered with no API calls, same numbers as reading it', async () => {
  const ninety = await runWith(NOW, '90', '', '', null);
  assert.equal(ninety.plan.mode, 'full');
  const past = await runWith(NOW, 'custom', '2026-10-01', '2026-10-20', asBase(ninety));
  assert.equal(past.plan.mode, 'cached');
  assert.deepEqual(past.calls, { export: 0, search: 0, log: 0, other: 0 });
  const fresh = await runWith(NOW, 'custom', '2026-10-01', '2026-10-20', null);
  assert.deepEqual(pick(past.a), pick(fresh.a));
});

test('a longer period extends the last one, skips the logs it already holds and gives the same numbers', async () => {
  const thirty = await runWith(NOW, '30', '', '', null);
  const later = NOW + 5 * 3600;
  const ninety = await runWith(later, '90', '', '', asBase(thirty));
  assert.equal(ninety.plan.mode, 'extend');
  const full = await runWith(later, '90', '', '', null);
  assert.deepEqual(pick(ninety.a), pick(full.a));
  assert.ok(ninety.calls.log < full.calls.log * 0.8, `logs ${ninety.calls.log} vs ${full.calls.log}`);
  assert.ok(ninety.result.skipped > 100);
  // And the window now covers 180 days: going back to 30 days needs only the update since then.
  assert.ok(ninety.result.window.end - ninety.result.window.start >= 179 * DAY);
  const back = counter.planRun(asBase(ninety, later * 1000), counter.buildRange('30', '', '', later + 3600), '');
  assert.equal(back.mode, 'update');
});

test('an update keeps the earlier history, so the longer period is still there afterwards', async () => {
  const ninety = await runWith(NOW, '90', '', '', null);
  const later = NOW + 2 * DAY;
  const thirty = await runWith(later, '30', '', '', asBase(ninety));
  assert.equal(thirty.plan.mode, 'update');
  assert.deepEqual(pick(thirty.a), pick((await runWith(later, '30', '', '', null)).a));
  const again = counter.planRun(asBase(thirty, later * 1000), counter.buildRange('90', '', '', later - 120), '');
  assert.equal(again.mode, 'cached', 'the 90 days kept after a 30-day update');
});

test('other channels or no overlap mean a full read', () => {
  const range = counter.buildRange('30', '', '', NOW);
  const base = { result: { status: 'done' }, range, channels: '', savedAt: 1 };
  assert.equal(counter.planRun(base, range, 'native_messaging').mode, 'full');
  assert.equal(counter.planRun(base, counter.buildRange('30', '', '', NOW + 100 * DAY), '').mode, 'full');
  assert.equal(counter.planRun({ ...base, result: { status: 'stopped' } }, range, '').mode, 'full');
  assert.equal(counter.planRun(null, range, '').mode, 'full');
});

test('search finds the same WhatsApp tickets as the export with fewer, smaller pages', async () => {
  const byExport = await runWith(NOW, '30', '', '', null);
  assert.equal(byExport.result.nativeOnly, true, 'all demo WhatsApp tickets are native');
  const bySearch = await runWith(NOW, '30', '', '', null, { search: true });
  assert.equal(bySearch.result.source, 'search');
  assert.equal(bySearch.calls.export, 0);
  assert.deepEqual(pick(bySearch.a), pick(byExport.a));
  assert.deepEqual(Object.keys(bySearch.result.info).sort(), Object.keys(byExport.result.info).sort());
});

test('search falls back to the export when it fails, returns partial objects, or finds nothing', async () => {
  const c = counted();
  const failing = (o) => (o.url.includes('/search/') ? Promise.reject({ status: 400 }) : c.request(o));
  const range = counter.buildRange('7', '', '', NOW - 120);
  const r1 = await counter.runRange({ request: failing, range, search: true, ...fast });
  assert.equal(r1.source, 'export');
  const thin = (o) => (o.url.includes('/search/') ? Promise.resolve({ results: [{ id: 1 }], meta: {} }) : c.request(o));
  assert.equal((await counter.runRange({ request: thin, range, search: true, ...fast })).source, 'export');
  const none = (o) => (o.url.includes('/search/') ? Promise.resolve({ results: [], meta: { has_more: false } }) : c.request(o));
  const r3 = await counter.runRange({ request: none, range, search: true, ...fast });
  assert.equal(r3.source, 'export');
  assert.ok(r3.messages.length > 0);
  // Extra channels need the export: the search only knows native WhatsApp.
  const r4 = await counter.runRange({ request: c.request, range, search: true, channels: 'web', ...fast });
  assert.equal(r4.source, 'export');
});

test('the log pace slows down after a 429 and partial results are spaced in time', async () => {
  const waits = [];
  let first = true;
  const api0 = demo.createApi({ now: () => NOW, latency: NO_DELAY, objects: { exists: false, fields: [], records: [] } });
  const request = (o) => {
    if (first && o.url.includes('conversation_log')) { first = false; return Promise.reject({ status: 429, getResponseHeader: () => '1' }); }
    return api0.request(o);
  };
  const range = counter.buildRange('7', '', '', NOW - 120);
  let partials = 0;
  await counter.runRange({ request, range, pauseMs: 0, logSpacingMs: 100, partialMs: 60000, sleep: async (ms) => { waits.push(ms); }, onPartial: () => { partials += 1; } });
  assert.ok(waits.includes(1000), 'waited Retry-After');
  assert.ok(waits.some((ms) => ms > 400), 'batches of 3 now spaced 150 ms each');
  assert.equal(partials, 0, 'no partial within 60 s');
});

test('the most common country without a full analysis matches the analysis', async () => {
  const r = await demoRun();
  const a = counter.analyze(r.result, { ...r.opts, defaultMarket: 'Other', useNumberCountry: true });
  const counts = new Map();
  a.current.tickets.forEach((t) => { if (t.detected) counts.set(t.market, (counts.get(t.market) || 0) + 1); });
  const best = Array.from(counts).sort((x, y) => y[1] - x[1])[0][0];
  assert.equal(counter.commonMarket(r.result, rates.marketForPhone, r.range.start, r.range.end), best);
});

// --- Pipelined reading, current period first, fewer user lookups (0.17) --------------------------

test('conversation logs are read while the export is still listing tickets', async () => {
  const demoApi = demo.createApi({ now: () => NOW, latency: NO_DELAY, objects: { exists: false, fields: [], records: [] } });
  const order = [];
  const request = (o) => { order.push(o.url.includes('/incremental/') ? 'E' : o.url.includes('conversation_log') ? 'L' : 'o'); return demoApi.request(o); };
  const range = counter.buildRange('30', '', '', NOW - 120);
  // Export pages 5 ms apart (instead of 6.5 s): logs fill the pauses.
  const r = await counter.runRange({ request, range, pauseMs: 5, logSpacingMs: 0, partialMs: 0 });
  assert.equal(r.status, 'done');
  const lastExport = order.lastIndexOf('E');
  assert.ok(order.indexOf('L') < lastExport, 'a log before the last export page');
});

test('the current period is complete before the previous one, with the final numbers', async () => {
  const demoApi = api();
  const range = counter.buildRange('30', '', '', NOW - 120);
  let ready = null;
  let readyAt = null;
  let logs = 0;
  const request = (o) => { if (o.url.includes('conversation_log')) logs += 1; return demoApi.request(o); };
  const result = await counter.runRange({ request, range, ...fast, onCurrentReady: (p) => { ready = p; readyAt = logs; } });
  assert.ok(ready, 'announced once the current period was read');
  assert.equal(ready.status, 'partial');
  assert.ok(readyAt < logs, 'before the previous-period logs');
  const o = { rates: rates.SERVICE_USD, defaultMarket: 'Argentina', marketForPhone: rates.marketForPhone, from: range.start, to: range.end };
  const early = counter.analyze(ready, o).current;
  const final = counter.analyze(result, o).current;
  assert.deepEqual([early.outbound, early.inbound, early.tickets.size, Number(early.cost.toFixed(9))],
    [final.outbound, final.inbound, final.tickets.size, Number(final.cost.toFixed(9))]);
  const detected = (s) => Array.from(s.tickets.values()).filter((t) => t.detected).length;
  assert.equal(detected(early), detected(final), 'profile phones of the current tickets already read');
});

test('profiles are looked up only when the country needs them, and only once', async () => {
  const T = NOW - 3600;
  const lookups = [];
  const ticket = (id, from) => ({ id, status: 'open', requester_id: 500 + id, assignee_id: 7, via: { channel: 'whatsapp', source: { from: from ? { phone: from } : {}, to: {} } },
    created_at: new Date(T * 1000).toISOString(), updated_at: new Date((T + 60) * 1000).toISOString() });
  const log = (id) => ({ events: [
    { type: 'Messaging::ConversationMessage', created_at: new Date((T + 10) * 1000).toISOString(), author: { type: 'end-user', 'zen:support:user_id': 500 + id } },
    { type: 'Messaging::ConversationMessage', created_at: new Date((T + 20) * 1000).toISOString(), author: { type: 'agent', 'zen:support:user_id': 7, display_name: 'Ana' } }
  ], meta: { has_more: false } });
  const request = async (o) => {
    if (o.url.includes('/incremental/')) return { tickets: [ticket(1, '+56987654321'), ticket(2, null)], end_of_stream: true };
    const m = /tickets\/(\d+)\/conversation_log/.exec(o.url);
    if (m) return log(Number(m[1]));
    if (o.url.includes('show_many')) {
      const ids = o.url.split('ids=')[1].split(',').map(Number);
      lookups.push(...ids);
      return { users: ids.map((id) => ({ id, role: id === 7 ? 'agent' : 'end-user', name: 'U' + id, phone: null })) };
    }
    return {};
  };
  const first = await counter.countMessages({ request, startTime: T - 100, endTime: NOW, ...fast });
  assert.deepEqual(lookups.sort(), [502], 'only the customer of the ticket without a phone (agent 7 is known from the log)');
  assert.equal(first.users.get(502).phone, '', 'looked up, no phone');
  lookups.length = 0;
  await counter.countMessages({ request, startTime: T - 100, endTime: NOW, users: first.users, ...fast });
  assert.deepEqual(lookups, [], 'not asked again on the next run');
});

test('when Zendesk refuses the ticket export, tickets come from List Tickets with the same numbers', async () => {
  const demoApi = api();
  const refused = (o) => (o.url.includes('/incremental/') ? Promise.reject({ status: 403 }) : demoApi.request(o));
  const range = counter.buildRange('30', '', '', NOW - 120);
  const listed = await counter.runRange({ request: refused, range, ...fast });
  assert.equal(listed.source, 'list');
  assert.equal(listed.exportStatus, 403);
  const exported = await counter.runRange({ request: api().request, range, ...fast });
  const o = { rates: rates.SERVICE_USD, defaultMarket: 'Argentina', marketForPhone: rates.marketForPhone, from: range.start, to: range.end, prevFrom: range.prevStart };
  const pickA = (r) => { const a = counter.analyze(r, o); return [a.current.outbound, a.current.tickets.size, Number(a.current.cost.toFixed(9)), a.previous.outbound]; };
  assert.deepEqual(pickA(listed), pickA(exported));
  // Other errors still stop the run.
  const broken = (o) => (o.url.includes('/incremental/') ? Promise.reject({ status: 500 }) : demoApi.request(o));
  await assert.rejects(counter.runRange({ request: broken, range, ...fast }), (e) => e.status === 500);
});

test('every translation keeps the placeholders of its Spanish text, in English and Portuguese', () => {
  const dict = require('../assets/i18n-dict.js');
  const marks = (s) => (s.match(/\{\w+\}|\[[^\]]+\]/g) || []).sort().join(' ');
  for (const lang of ['en', 'pt-BR']) {
    for (const [es, tr] of Object.entries(dict[lang])) assert.equal(marks(tr), marks(es), `${lang}: ${es}`);
  }
  assert.deepEqual(Object.keys(dict.en).sort(), Object.keys(dict['pt-BR']).sort());
});

test('language follows the Zendesk locale: Spanish and Portuguese variants, English otherwise', () => {
  const i18n = require('../assets/i18n.js');
  globalThis.WaDict = require('../assets/i18n-dict.js');
  try {
    assert.deepEqual(['es-419', 'es', 'ES-es', 'pt-BR', 'pt', 'en-US', 'fr', '', null].map(i18n.fromLocale), ['es', 'es', 'es', 'pt-BR', 'pt-BR', 'en', 'en', 'en', 'en']);
    i18n.set('pt-BR');
    assert.equal(i18n.t('Ver costo'), 'Ver custo');
    assert.equal(i18n.t('{n} mensajes × {rate}', { n: 3, rate: 'US$ 0,02' }), '3 mensagens × US$ 0,02');
    i18n.set('en');
    assert.equal(i18n.t('texto sin traducción'), 'texto sin traducción', 'falls back to Spanish');
    i18n.set('es');
    assert.equal(i18n.t('Ver costo'), 'Ver costo');
  } finally {
    delete globalThis.WaDict;
  }
});

test('stored results keep the customer country, not the phone or the name, and give the same numbers', async () => {
  const r = await demoRun();
  const packed = JSON.stringify(counter.packResult(r.result, { marketForPhone: rates.marketForPhone }));
  assert.ok(!/\+5[1-7] 9|\+34 600|\+44 7700|\+1 415/.test(packed.replace(/\+54 11 5550 1000|\+52 55 5550 2000/g, '')), 'no customer phone left');
  assert.ok(!/Cliente \d+/.test(packed), 'no customer name left');
  assert.ok(packed.includes('+54 11 5550 1000'), 'business numbers kept');
  const back = counter.unpackResult(JSON.parse(packed));
  const o = { ...r.opts, months: false };
  const a = counter.analyze(back, o);
  assert.deepEqual([a.current.outbound, Number(a.current.cost.toFixed(9)), Array.from(a.current.tickets.values()).filter((t) => t.detected).length],
    [r.current.outbound, Number(r.current.cost.toFixed(9)), Array.from(r.current.tickets.values()).filter((t) => t.detected).length]);
});

test('names: forms by their agent-facing name, and ids missing from the lists looked up one by one', async () => {
  const calls = [];
  const request = async (o) => {
    calls.push(o.url);
    if (o.url === '/api/v2/ticket_forms.json') return { ticket_forms: [{ id: 1, name: 'Soporte', display_name: 'Por favor complete estos datos' }] };
    if (o.url === '/api/v2/ticket_forms/2.json') return { ticket_form: { id: 2, name: 'Viejo (inactivo)', active: false } };
    if (o.url === '/api/v2/ticket_forms/3.json') throw { status: 404 };
    if (o.url === '/api/v2/brands/9.json') return { brand: { id: 9, name: 'Marca nueva' } };
    if (o.url === '/api/v2/brands.json') return { brands: [] };
    return {};
  };
  const info = { 10: { form: 1, brand: 9, fields: {} }, 11: { form: 2, fields: {} }, 12: { form: 3, fields: {} } };
  const names = await counter.fetchNames(request, info, null);
  assert.deepEqual(names.forms, { 1: 'Soporte', 2: 'Viejo (inactivo)' });
  assert.equal(names.brands[9], 'Marca nueva');
  assert.equal(counter.missingNames(info, names), true, 'form 3 is still unnamed');
  assert.equal(counter.missingNames({ 10: info[10] }, names), false);
});

test('switching period reuses a calculation that ended a few minutes earlier', () => {
  const range = counter.buildRange('90', '', '', NOW);
  const base = { result: { status: 'done' }, range, channels: '', savedAt: 1 };
  const later7 = counter.buildRange('7', '', '', NOW + 600);
  assert.equal(counter.planRun(base, later7, '').mode, 'update', '"Ver costo" reads the new minutes');
  assert.equal(counter.planRun(base, later7, '', 1800).mode, 'cached', 'a period switch does not');
  assert.equal(counter.planRun(base, counter.buildRange('7', '', '', NOW + 3600), '', 1800).mode, 'update');
});
