const test = require('node:test');
const assert = require('node:assert/strict');
const counter = require('../assets/counter.js');
const rates = require('../assets/rates.js');
const demo = require('../assets/demo.js');

process.env.TZ = 'America/Argentina/Buenos_Aires';
const NOW = Math.floor(Date.UTC(2026, 10, 10, 15, 0) / 1000);
const NO_DELAY = { export: 0, log: 0, users: 0, other: 0 };
const fast = { pauseMs: 0, logSpacingMs: 0, partialMs: 0 };
const api = () => demo.createApi({ now: () => NOW, latency: NO_DELAY });

function analyze(result, range) {
  return counter.analyze(result, { rates: rates.SERVICE_USD, defaultMarket: 'Argentina', marketForPhone: rates.marketForPhone,
    from: range.start, to: range.end, prevFrom: range.prevStart });
}

test('the margin of a simple random sample: none for a census, none without spread, larger for smaller samples', () => {
  assert.equal(counter.sampleMargin(10, 20, 100, 100), 0);
  assert.equal(counter.sampleMargin(10, 1, 100, 1000), 0, 'every ticket cost 0.1: no spread');
  const small = counter.sampleMargin(5, 3, 50, 1000);
  const big = counter.sampleMargin(10, 6, 100, 1000);
  assert.ok(small > big && big > 0);
  // Sample [0, 0, 1, 1] of 8 tickets: mean 0.5, variance 1/3, total 4 ± 1.96 x 8 x sqrt(0.5 x (1/3) / 4).
  assert.ok(Math.abs(counter.sampleMargin(2, 2, 4, 8) - 1.96 * 8 * Math.sqrt(0.5 / 3 / 4)) < 1e-12);
});

test('a sample reads only its tickets, scales totals up and its margin covers the exact cost', async () => {
  const demoApi = api();
  const range = counter.buildRange('30', null, null, NOW - 120);
  const total = await counter.countTickets(demoApi.request, range.prevStart);
  assert.ok(total > 400, `tickets: ${total}`);
  const exact = await counter.runRange({ request: demoApi.request, range, ...fast });
  const exactCur = analyze(exact, range).current;

  const sampled = await counter.runRange({ request: demoApi.request, range, sampleSize: 200, ...fast });
  assert.equal(sampled.status, 'done');
  assert.equal(sampled.tickets.length, 200, 'only the sample was read');
  assert.equal(sampled.sample.read, 200);
  assert.equal(sampled.sample.rows.length, total, 'every ticket is listed for later');
  assert.equal(new Set(sampled.sample.rows.map((r) => r.id)).size, total);
  assert.deepEqual(sampled.sample.rows.slice(0, 200).map((r) => r.id).sort(), sampled.tickets.slice().sort(), 'the sample is the first rows');
  assert.equal(counter.planRun({ result: sampled, range, savedAt: 1 }, range, '').mode, 'full', 'a sample is never a base');

  const cur = analyze(sampled, range).current;
  assert.ok(cur.sample.n > 50 && cur.sample.n < cur.sample.N);
  assert.ok(Math.abs(cur.sample.w - cur.sample.N / cur.sample.n) < 1e-12);
  // Scaled totals: near the exact ones (the margin is 95%; three margins never miss on this data).
  assert.ok(Math.abs(cur.cost - exactCur.cost) < 3 * cur.sample.margin, `${cur.cost} vs ${exactCur.cost} ± ${cur.sample.margin}`);
  assert.ok(cur.sample.margin > 0 && cur.sample.margin < cur.cost);

  // Breakdown rows are scaled and carry their own margin.
  const rows = counter.breakdown(cur, null, (t) => (sampled.info[t.id] || {}).form || null);
  assert.ok(rows.length > 1 && rows.every((r) => r.margin >= 0));
  assert.ok(Math.abs(rows.reduce((s, r) => s + r.cost, 0) - cur.cost) < 1e-6);
});

test('extending a sample reads the next tickets only, and reading them all gives the exact result', async () => {
  const demoApi = api();
  const range = counter.buildRange('30', null, null, NOW - 120);
  const exact = await counter.runRange({ request: demoApi.request, range, ...fast });
  const exactCur = analyze(exact, range).current;
  const sampled = await counter.runRange({ request: demoApi.request, range, sampleSize: 150, ...fast });

  let logs = 0;
  const counting = (o) => { if (/conversation_log/.test(o.url)) logs += 1; return demoApi.request(o); };
  const more = await counter.extendSample({ request: counting, result: sampled, add: 100, ...fast });
  assert.equal(logs, 100);
  assert.equal(more.sample.read, 250);
  assert.equal(more.tickets.length, 250);
  const before = analyze(sampled, range).current.sample;
  const after = analyze(more, range).current.sample;
  assert.ok(after.n > before.n);

  // Through the browser cache (packed, phones masked) and on to every ticket.
  const packed = counter.unpackResult(JSON.parse(JSON.stringify(counter.packResult(more, { marketForPhone: rates.marketForPhone }))));
  assert.equal(packed.sample.read, 250);
  const all = await counter.extendSample({ request: demoApi.request, result: packed, add: packed.sample.rows.length, ...fast });
  assert.equal(all.sample, null);
  assert.equal(all.status, 'done');
  const allCur = analyze(all, range).current;
  assert.equal(allCur.sample, undefined);
  assert.equal(allCur.tickets.size, exactCur.tickets.size);
  assert.ok(Math.abs(allCur.cost - exactCur.cost) < 1e-9, `${allCur.cost} vs ${exactCur.cost}`);
  assert.equal(allCur.outbound, exactCur.outbound);
});

test('a stopped extension keeps the tickets it read as a smaller sample', async () => {
  const demoApi = api();
  const range = counter.buildRange('30', null, null, NOW - 120);
  const sampled = await counter.runRange({ request: demoApi.request, range, sampleSize: 90, ...fast });
  let reads = 0;
  const more = await counter.extendSample({ request: demoApi.request, result: sampled, add: 300, ...fast,
    shouldStop: () => reads >= 30,
    onProgress: (p) => { reads = p.done; } });
  assert.equal(more.status, 'done');
  assert.ok(more.sample.read >= 120 && more.sample.read < 390, `read ${more.sample.read}`);
  assert.equal(more.tickets.length, more.sample.read);
});
