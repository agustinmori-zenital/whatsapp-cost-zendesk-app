const test = require('node:test');
const assert = require('node:assert/strict');
const counter = require('../assets/counter.js');
const rates = require('../assets/rates.js');

const DAY = 86400;
const local = (y, m, d, h = 0, mi = 0, s = 0) => Math.floor(new Date(y, m - 1, d, h, mi, s).getTime() / 1000);

// Time zones with and without daylight saving changes around the dates used here.
const ZONES = ['UTC', 'America/Argentina/Buenos_Aires', 'America/Mexico_City', 'America/New_York', 'Europe/Madrid', 'Pacific/Auckland'];

ZONES.forEach((tz) => {
  test(`date ranges in ${tz}`, () => {
    process.env.TZ = tz;
    const now = local(2026, 11, 10, 15, 30); // what the dashboard passes (already minus 2 minutes)
    const iso = (s) => new Date(s * 1000).toISOString();

    // Presets: rolling days that end now; the previous period has the same length right before.
    const p7 = counter.buildRange('7', '', '', now);
    assert.deepEqual([p7.start, p7.end, p7.prevStart, p7.days], [now - 7 * DAY, now, now - 14 * DAY, 7]);

    // Custom: [from 00:00, day after `to` 00:00) in local time, `to` included.
    const c = counter.buildRange('custom', '2026-11-01', '2026-11-05', now);
    assert.equal(c.start, local(2026, 11, 1), iso(c.start));
    assert.equal(c.end, local(2026, 11, 6), iso(c.end));
    assert.ok(Math.abs(c.days - 5) <= 1 / 24 + 1e-9, 'a daylight saving change moves the length by one hour at most');
    assert.equal(c.prevStart, c.start - (c.end - c.start));
    assert.deepEqual([c.from, c.to], ['2026-11-01', '2026-11-05']);

    // A range that ends in the future is cut at now, and says so.
    const open = counter.buildRange('custom', '2026-11-08', '2026-12-31', now);
    assert.deepEqual([open.end, open.to], [now, '2026-11-10']);
    // Today only.
    const today = counter.buildRange('custom', '2026-11-10', '2026-11-10', now);
    assert.deepEqual([today.start, today.end, today.days], [local(2026, 11, 10), now, 1]);

    assert.equal(counter.buildRange('custom', '2026-11-11', '2026-11-12', now).error, 'future');
    assert.equal(counter.buildRange('custom', '2026-11-09', '2026-11-05', now).error, 'order');
    assert.equal(counter.buildRange('custom', '', '2026-11-05', now).error, 'missing');
    assert.equal(counter.buildRange('custom', '2026-11-01', 'no', now).error, 'missing');
    assert.equal(counter.buildRange('abc', '', '', now).error, 'invalid');
  });
});

test('messages count from the first second of the first day to the last second of the last day', () => {
  process.env.TZ = 'America/Argentina/Buenos_Aires';
  const now = local(2026, 11, 10, 15, 30);
  const r = counter.buildRange('custom', '2026-11-02', '2026-11-03', now);
  const users = new Map([[1, { role: 'agent' }]]);
  const at = [local(2026, 11, 1, 23, 59, 59), local(2026, 11, 2), local(2026, 11, 3, 23, 59, 59), local(2026, 11, 4)];
  const out = counter.analyze({ messages: at.map((t, i) => ({ t: 1 + i, a: 1, at: t, fr: null, to: null })), users }, {
    rates: rates.SERVICE_USD, defaultMarket: 'Other', marketForPhone: rates.marketForPhone, from: r.start, to: r.end, prevFrom: r.prevStart
  });
  assert.deepEqual(Array.from(out.current.tickets.keys()), [2, 3], 'the second before the first day and the first second after the last day are out');
  assert.deepEqual(Array.from(out.previous.tickets.keys()), [1], 'the previous period ends where this one starts');
});

// --- update runs must give the same numbers as a full run ---------------------------------------------

function rng(seed) {
  let a = seed;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const BASE = Date.UTC(2026, 0, 1) / 1000;
const BIZ = '+54 11 5550 1000';
const USERS = [{ id: 1, role: 'agent', name: 'Ana' }, { id: 2, role: 'agent', name: 'Beto' }, { id: 900, role: 'end-user', name: 'C', phone: '+56 9 5550 0001' }];

// 160 WhatsApp tickets whose conversations last up to a few days and span the whole year, so a ticket
// often has messages before and after any moment a run was made.
function world(seed) {
  const r = rng(seed);
  const tickets = [];
  for (let i = 0; i < 160; i++) {
    const created = BASE + Math.floor(r() * 300 * DAY);
    const events = [];
    let at = created;
    const sessions = 1 + Math.floor(r() * 3);
    for (let s = 0; s < sessions; s++) {
      if (s) at += Math.floor((0.5 + r() * 4) * DAY);
      events.push({ at, type: 'end-user', id: 900 });
      for (let k = 0, n = 1 + Math.floor(r() * 4); k < n; k++) { at += 30 + Math.floor(r() * 3000); events.push({ at, type: 'agent', id: 1 + (i % 2) }); }
    }
    // Some tickets are deleted some days after their last message.
    const deletedAt = r() < 0.12 ? at + Math.floor(r() * 20 * DAY) : null;
    tickets.push({ id: 5000 + i, created, events, deletedAt });
  }
  return tickets;
}

// Zendesk as the app sees it at moment `now`: the export lists tickets updated since start_time, a
// conversation log holds the events that exist by then.
function zendesk(tickets, now) {
  const seen = (t) => t.events.filter((e) => e.at <= now);
  const gone = (t) => t.deletedAt != null && t.deletedAt <= now;
  const updated = (t) => { const ev = seen(t); return gone(t) ? t.deletedAt : ev.length ? ev[ev.length - 1].at : t.created; };
  const via = { channel: 'whatsapp', source: { from: { phone: '+56 9 5550 0001' }, to: { phone: BIZ }, rel: null } };
  return async (o) => {
    if (o.url.includes('show_many')) return { users: USERS };
    const log = o.url.match(/tickets\/(\d+)\/conversation_log/);
    if (log) {
      const t = tickets.find((x) => x.id === Number(log[1]));
      return { events: seen(t).map((e) => ({ type: 'Messaging::ConversationMessage', created_at: new Date(e.at * 1000).toISOString(), author: { type: e.type, 'zen:support:user_id': e.id, display_name: 'x' } })), meta: { has_more: false } };
    }
    const start = Number(o.url.match(/start_time=(\d+)/)[1]);
    return {
      end_of_stream: true,
      tickets: tickets.filter((t) => t.created <= now && updated(t) >= start).map((t) => ({
        id: t.id, requester_id: 900, status: gone(t) ? 'deleted' : 'open', via, created_at: new Date(t.created * 1000).toISOString(), updated_at: new Date(updated(t) * 1000).toISOString()
      }))
    };
  };
}

const summary = (result, r) => {
  const a = counter.analyze(result, { rates: rates.SERVICE_USD, defaultMarket: 'Other', marketForPhone: rates.marketForPhone, from: r.start, to: r.end, prevFrom: r.prevStart });
  const pick = (s) => ({
    outbound: s.outbound, inbound: s.inbound, cost: Number(s.cost.toFixed(9)), tickets: s.tickets.size,
    perTicket: Array.from(s.tickets.values()).map((t) => [t.id, t.outbound, t.inbound]).sort((x, y) => x[0] - y[0]),
    weeks: Array.from(s.byWeek.entries()).sort((x, y) => x[0] - y[0]).map((e) => [e[0], e[1].outbound])
  });
  return { current: pick(a.current), previous: pick(a.previous) };
};

test('an update run gives the same numbers as a full run of the same period', async () => {
  process.env.TZ = 'America/Argentina/Buenos_Aires';
  const fast = { pauseMs: 0, logSpacingMs: 0 };
  let reused = 0;
  for (const seed of [1, 2, 3]) {
    const tickets = world(seed);
    let last = null;
    // The same dashboard used over time: periods change, runs repeat, days go by.
    const plan = [
      [150, '30'], [150.02, '30'], [151, '30'], [151, '7'], [152, '90'], [152.5, '7'], [160, '30'],
      [160, 'custom', '2026-06-01', '2026-06-20'], [161, '30'], [161.5, '30'], [200, '90'], [210, '30'], [240, 'custom', '2026-08-01', '2026-08-20'], [241, 'custom', '2026-08-01', '2026-08-28']
    ];
    for (const [day, period, from, to] of plan) {
      const now = Math.floor(BASE + day * DAY);
      const range = counter.buildRange(period, from, to, now - 120);
      assert.ok(!range.error, JSON.stringify(range));
      const request = zendesk(tickets, now);
      const reuse = counter.reusableRun(last, range, '');
      if (reuse) reused += 1;
      const result = await counter.runRange({ request, range, reuse, ...fast });
      const full = await counter.runRange({ request, range, reuse: null, ...fast });
      assert.deepEqual(summary(result, range), summary(full, range), `seed ${seed}, day ${day}, period ${period}${reuse ? ' (update run)' : ''}`);
      last = { result, range, channels: '', savedAt: now * 1000 };
    }
  }
  assert.ok(reused >= 12, `update runs were exercised (${reused})`);
});

test('reusableRun: only a complete run with the same channels that reaches the new period', () => {
  const run = (prevStart, end, extra = {}) => ({ savedAt: 1, channels: 'a, b', result: { status: 'done' }, range: { prevStart, end }, ...extra });
  const range = { prevStart: 100, end: 300 };
  assert.ok(counter.reusableRun(run(50, 200), range, 'B,a'), 'older start, ends inside the new range');
  assert.equal(counter.reusableRun(run(150, 200), range, 'a, b'), null, 'starts after what the new range needs');
  assert.equal(counter.reusableRun(run(50, 90), range, 'a, b'), null, 'ends before the new range: a gap would be left');
  assert.equal(counter.reusableRun(run(50, 350), range, 'a, b'), null, 'ends after the new range');
  assert.equal(counter.reusableRun(run(50, 200), range, 'a'), null, 'other channels');
  assert.equal(counter.reusableRun(run(50, 200, { result: { status: 'partial' } }), range, 'a, b'), null, 'partial result');
  assert.equal(counter.reusableRun(run(50, 200, { savedAt: null }), range, 'a, b'), null, 'never saved');
  assert.equal(counter.reusableRun(null, range, ''), null);
});

test('week keys: every day of two years falls in a listed week, also where clocks skip midnight', () => {
  ['America/Santiago', 'Africa/Cairo', 'America/Havana', 'Pacific/Auckland', 'America/Sao_Paulo', 'UTC'].forEach((tz) => {
    process.env.TZ = tz;
    const from = local(2024, 1, 1);
    const to = local(2026, 12, 31);
    const weeks = counter.weeks(from, to);
    const starts = new Set(weeks.map((w) => w.start));
    weeks.forEach((w, i) => {
      assert.equal(new Date(w.start * 1000).getDay(), 1, `${tz}: week ${i} starts on a Monday`);
      if (i) assert.equal(w.start, weeks[i - 1].end, `${tz}: weeks touch`);
    });
    for (let t = from; t < to; t += DAY) {
      const noon = t + 12 * 3600;
      assert.ok(starts.has(counter.weekStart(noon)), `${tz}: ${new Date(noon * 1000).toDateString()} has no week`);
    }
    assert.ok(weeks[0].start <= from && weeks[weeks.length - 1].end >= to);
  });
});

test('a half-typed year is not a date', () => {
  process.env.TZ = 'UTC';
  assert.equal(counter.buildRange('custom', '0026-11-01', '2026-11-05', local(2026, 11, 10)).error, 'missing');
});
