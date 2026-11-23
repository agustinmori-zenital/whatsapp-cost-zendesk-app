const test = require('node:test');
const assert = require('node:assert/strict');
const counter = require('../assets/counter.js');
const rates = require('../assets/rates.js');

const T0 = 1700000000;
const iso = (s) => new Date(s * 1000).toISOString().replace('.000Z', 'Z');
const wa = (from, to) => ({ channel: 'whatsapp', source: { from: from ? { phone: from } : {}, to: to ? { phone: to } : {} } });
const ticket = (id, via, extra = {}) => ({ id, via, requester_id: extra.requester || 99, created_at: iso(T0 - 1000), updated_at: iso(extra.updated || T0 + 10) });
const logMsg = (type, at, id, name) => ({ type: 'Messaging::ConversationMessage', created_at: iso(at), author: { type, display_name: name, 'zen:support:user_id': id } });

// 1: agent, 2: admin, 99: end user (Chile), 77: end user without phone, 500: bot (not returned by the API).
const USERS = [
  { id: 1, role: 'agent', name: 'Ana' }, { id: 2, role: 'admin', name: 'Beto' },
  { id: 99, role: 'end-user', name: 'Cliente', phone: '+56 9 8765 4321' }, { id: 77, role: 'end-user', name: 'Sin teléfono' }
];
const BIZ = '+54 11 4000 0000';

// Fake Zendesk API: ticket export pages in order, conversation logs and comments by ticket id, users.
function makeApi({ pages = [], logs = {}, comments = {} }) {
  const calls = [];
  let i = 0;
  const request = async (opts) => {
    calls.push(opts.url);
    if (opts.url.startsWith('/api/v2/users/show_many.json')) {
      const ids = decodeURIComponent(opts.url.split('ids=')[1]).split(',').map(Number);
      return { users: USERS.filter((u) => ids.includes(u.id)) };
    }
    const log = opts.url.match(/tickets\/(\d+)\/conversation_log/);
    if (log) return { events: logs[log[1]] || [], meta: { has_more: false } };
    const cm = opts.url.match(/tickets\/(\d+)\/comments/);
    if (cm) return { comments: comments[cm[1]] || [], meta: { has_more: false } };
    return pages[i++];
  };
  return { request, calls };
}
const fast = { pauseMs: 0, logSpacingMs: 0, partialMs: 0 };

test('finds WhatsApp tickets in the ticket export and reads their conversation logs', async () => {
  const { request, calls } = makeApi({
    pages: [
      { tickets: [ticket(10, wa('+56987654321', BIZ)), ticket(11, { channel: 'email' })], after_cursor: 'abc', end_of_stream: false },
      { tickets: [ticket(12, { channel: 'any_channel', source: { rel: 'infobip', from: { name: 'WhatsApp Business' } } })], end_of_stream: true }
    ],
    logs: {
      10: [
        logMsg('user', T0 + 1, 99, 'Cliente'), logMsg('bot', T0 + 2, null, 'Zenbot'), logMsg('agent', T0 + 3, 1, 'Ana'),
        logMsg('agent', T0 - 5, 1, 'Ana'), // before the range
        { type: 'Comment', created_at: iso(T0 + 4), author: { type: 'agent', 'zen:support:user_id': 1 } } // internal or mirrored comment
      ],
      12: [{ type: 'Comment', created_at: iso(T0 + 5), author: { type: 'agent' } }]
    },
    // Ticket 12 has no messaging messages: its public comments are used.
    comments: { 12: [{ author_id: 1, public: true, created_at: iso(T0 + 6), via: { channel: 'any_channel' } }, { author_id: 1, public: false, created_at: iso(T0 + 7) }] }
  });
  const r = await counter.countMessages({ request, startTime: T0, endTime: T0 + 1000, ...fast });
  assert.equal(r.status, 'done');
  assert.equal(r.scanned, 3);
  assert.deepEqual(r.tickets, [10, 12]);
  assert.deepEqual(r.messages.map((m) => [m.t, m.a]), [[10, 99], [10, 'bot:Zenbot'], [10, 1], [12, 1]]);
  // Phones come from the ticket's via: customer -> business for the inbound message, reversed for replies.
  assert.deepEqual([r.messages[0].fr, r.messages[0].to, r.messages[2].fr], ['+56987654321', BIZ, BIZ]);
  assert.equal(r.users.get('bot:Zenbot').role, 'bot');
  assert.equal(r.users.get(99).phone, '+56 9 8765 4321');
  assert.deepEqual(r.requesters, { 10: 99, 12: 99 });
  assert.ok(calls[0].includes('/api/v2/incremental/tickets/cursor.json?start_time=' + T0));
  assert.ok(calls[1].includes('cursor=abc'));
});

test('reads the conversation log as production returns it (end-user, system AI agent, agent)', async () => {
  const ev = (type, at, id, name, source) => ({ ...logMsg(type, at, id, name), source: { type: source } });
  const { request } = makeApi({
    pages: [{ tickets: [ticket(1067, { channel: 'whatsapp', source: { from: {}, to: {}, rel: null } })], end_of_stream: true }],
    logs: {
      1067: [
        ev('end-user', T0 + 1, 99, 'Fefo', 'whatsapp'),
        { type: 'Comment', created_at: iso(T0 + 2), author: { type: 'user', 'zen:support:user_id': 99 } },
        ev('system', T0 + 3, -1, 'Zeni Retail', 'ultimate'),
        ev('agent', T0 + 4, 1, 'Federico', 'zd:agentCopilot'),
        ev('agent', T0 + 5, 1, 'Federico', 'zd:agentWorkspace')
      ]
    }
  });
  const r = await counter.countMessages({ request, startTime: T0, endTime: T0 + 1000, ...fast });
  assert.deepEqual(r.messages.map((m) => m.a), [99, 'bot:Zeni Retail', 1, 1]);
  assert.equal(r.users.get(99).role, 'end-user');
  assert.equal(r.users.get('bot:Zeni Retail').role, 'bot');
  assert.equal(r.messages.filter((m) => r.users.get(m.a).role !== 'end-user').length, 3);
});

test('skips deleted tickets and falls back to comments when a conversation log is not found', async () => {
  const notFound = { status: 404, responseJSON: { error: 'RecordNotFound' } };
  const api = makeApi({
    pages: [{ tickets: [ticket(60, wa(null, BIZ)), { ...ticket(61, wa(null, BIZ)), status: 'deleted' }, ticket(62, wa(null, BIZ))], end_of_stream: true }],
    comments: { 60: [{ author_id: 1, public: true, created_at: iso(T0 + 1), via: { channel: 'whatsapp' } }] }
  });
  const request = async (opts) => {
    if (opts.url.includes('/60/conversation_log') || opts.url.includes('/62/')) throw notFound;
    return api.request(opts);
  };
  const r = await counter.countMessages({ request, startTime: T0, endTime: T0 + 100, ...fast });
  assert.equal(r.status, 'done');
  assert.deepEqual(r.tickets, [60, 62]);
  assert.equal(r.logMissing, 2);
  assert.deepEqual(r.messages.map((m) => m.t), [60]);
  assert.ok(!api.calls.some((u) => u.includes('/61/')), 'deleted ticket is not read');
  // Other errors still stop the run, with the failing path attached.
  const api2 = makeApi({ pages: [{ tickets: [ticket(60, wa(null, BIZ))], end_of_stream: true }] });
  const broken = async (opts) => { if (opts.url.includes('conversation_log')) throw { status: 500 }; return api2.request(opts); };
  await assert.rejects(counter.countMessages({ request: broken, startTime: T0, endTime: T0 + 100, ...fast }),
    (err) => err.status === 500 && err.path === '/api/v2/tickets/60/conversation_log');
});

test('stops early when no conversation log can be read and reports partial results', async () => {
  const many = Array.from({ length: 8 }, (_, k) => ticket(70 + k, wa(null, BIZ)));
  const api = makeApi({ pages: [{ tickets: many, end_of_stream: true }] });
  const request = async (opts) => { if (opts.url.includes('conversation_log')) throw { status: 404 }; return api.request(opts); };
  await assert.rejects(counter.countMessages({ request, startTime: T0, endTime: T0 + 100, ...fast }), (err) => err.code === 'log_unavailable');
  assert.ok(api.calls.filter((u) => u.includes('/comments')).length <= 6);
  // Partial results arrive while logs are read.
  const logs = {};
  const lots = Array.from({ length: 40 }, (_, k) => { logs[100 + k] = [logMsg('agent', T0 + 1, 1, 'Ana')]; return ticket(100 + k, wa(null, BIZ)); });
  const partials = [];
  const r = await counter.countMessages({ request: makeApi({ pages: [{ tickets: lots, end_of_stream: true }], logs }).request,
    startTime: T0, endTime: T0 + 100, ...fast, onPartial: (p) => partials.push(p.messages.length) });
  assert.equal(r.messages.length, 40);
  assert.ok(partials.length >= 1 && partials[0] < 40);
});

test('a listed channel marks tickets as WhatsApp', async () => {
  const pages = [{ tickets: [ticket(22, { channel: 'native_messaging', source: { rel: null } })], end_of_stream: true }];
  const logs = { 22: [logMsg('agent', T0 + 1, 1, 'Ana')] };
  const none = await counter.countMessages({ request: makeApi({ pages, logs }).request, startTime: T0, endTime: T0 + 100, ...fast });
  assert.deepEqual([none.messages.length, none.channels], [0, { native_messaging: 1 }]);
  const listed = await counter.countMessages({ request: makeApi({ pages, logs }).request, startTime: T0, endTime: T0 + 100, ...fast, channels: 'Native_Messaging' });
  assert.equal(listed.messages.length, 1);
  assert.deepEqual(counter.parseChannels(' a, ,B / c '), ['a', 'b / c']);
});

test('analyze: cost per ticket, market, business number, author, week and previous period', () => {
  const users = new Map(USERS.map((u) => [u.id, u]));
  const msgs = [
    // Previous period (T0 - 100 .. T0): one outbound to Chile.
    { t: 9, a: 1, at: T0 - 50, fr: BIZ, to: '+56987654321' },
    // Current: ticket 10 Chile via the far end of the conversation; agent 1 x2, bot 500 x1, customer x1.
    { t: 10, a: 99, at: T0 + 1, fr: '+56987654321', to: BIZ },
    { t: 10, a: 1, at: T0 + 2, fr: BIZ, to: '+56987654321' },
    { t: 10, a: 1, at: T0 + 3, fr: BIZ, to: '+56987654321' },
    { t: 10, a: 500, at: T0 + 4, fr: BIZ, to: null },
    // Ticket 12: no phone anywhere -> default market, no business number.
    { t: 12, a: 77, at: T0 + 5, fr: null, to: null },
    { t: 12, a: 2, at: T0 + 6, fr: null, to: null }
  ];
  const a = counter.analyze({ messages: msgs, users }, {
    rates: rates.SERVICE_USD, defaultMarket: 'Brazil', marketForPhone: rates.marketForPhone, from: T0, to: T0 + 100, prevFrom: T0 - 100
  });
  const cur = a.current;
  assert.deepEqual([cur.outbound, cur.inbound], [4, 2]);
  const t10 = cur.tickets.get(10);
  assert.deepEqual([t10.market, t10.detected, t10.outbound, t10.inbound, t10.number], ['Chile', true, 3, 1, BIZ]);
  assert.ok(Math.abs(t10.cost - 3 * 0.02) < 1e-9);
  const t12 = cur.tickets.get(12);
  assert.deepEqual([t12.market, t12.detected, t12.number], ['Brazil', false, '']);
  assert.ok(Math.abs(cur.cost - (3 * 0.02 + 0.0068)) < 1e-9);
  assert.equal(cur.byNumber.get(BIZ).outbound, 3);
  assert.equal(cur.byNumber.get('').outbound, 1);
  assert.equal(cur.byAuthor.get(1).outbound, 2);
  assert.equal(cur.byAuthor.get(500).outbound, 1);
  assert.equal(Array.from(cur.byWeek.values()).reduce((s, w) => s + w.outbound, 0), 4);
  assert.deepEqual([a.previous.outbound, a.previous.tickets.size], [1, 1]);
});

test('replies without phones use the business number of their ticket', () => {
  const users = new Map(USERS.map((u) => [u.id, u]));
  const msgs = [
    { t: 30, a: 99, at: T0 + 1, fr: '+56987654321', to: BIZ },
    { t: 30, a: 1, at: T0 + 2, fr: null, to: null }
  ];
  const cur = counter.analyze({ messages: msgs, users }, { rates: rates.SERVICE_USD, defaultMarket: 'Other', marketForPhone: rates.marketForPhone, from: T0, to: T0 + 100 }).current;
  assert.equal(cur.byNumber.get(BIZ).outbound, 1);
  assert.equal(cur.tickets.get(30).market, 'Chile');
});

test('without a chosen default, unknown customers use the business number country', () => {
  const users = new Map(USERS.map((u) => [u.id, u]));
  const msgs = [{ t: 40, a: 1, at: T0 + 1, fr: BIZ, to: null }];
  const run = (useNumberCountry) => counter.analyze({ messages: msgs, users }, {
    rates: rates.SERVICE_USD, defaultMarket: 'Brazil', marketForPhone: rates.marketForPhone, useNumberCountry, from: T0, to: T0 + 100
  }).current.tickets.get(40);
  assert.deepEqual([run(true).market, run(true).detected], ['Argentina', false]);
  assert.equal(run(false).market, 'Brazil');
});

test('update run: re-read tickets replace their old messages, users are reused', async () => {
  const { request, calls } = makeApi({
    pages: [{ tickets: [ticket(10, wa(null, BIZ), { requester: 1 })], end_of_stream: true }],
    logs: { 10: [logMsg('agent', T0 + 30, 1, 'Ana'), logMsg('agent', T0 + 50, 1, 'Ana')] }
  });
  const known = new Map([[1, { role: 'agent', name: 'Ana', phone: null }]]);
  // Only tickets changed since T0 + 40 are exported, but their messages count from the start of the period (T0 + 10).
  const fresh = await counter.countMessages({ request, startTime: T0 + 40, fromTime: T0 + 10, endTime: T0 + 100, ...fast, users: known });
  assert.deepEqual(fresh.messages.map((m) => m.at), [T0 + 30, T0 + 50]);
  assert.ok(!calls.some((u) => u.includes('show_many')), 'user 1 is already known');
  const old = { status: 'done', scanned: 2, channels: { whatsapp: 2 }, users: known, requesters: { 11: 99 },
    messages: [{ t: 10, a: 1, at: T0 + 30, fr: BIZ, to: null }, { t: 11, a: 1, at: T0 + 5, fr: BIZ, to: null }, { t: 11, a: 1, at: T0 + 20, fr: BIZ, to: null }] };
  // Ticket 10 is replaced by its full re-read (no message lost, none twice); ticket 11 keeps its messages from T0 + 10 on.
  const merged = counter.mergeResults(old, fresh, T0 + 10);
  assert.deepEqual(merged.messages.map((m) => [m.t, m.at]), [[11, T0 + 20], [10, T0 + 30], [10, T0 + 50]]);
  assert.deepEqual([merged.scanned, merged.channels, merged.requesters], [3, { whatsapp: 3 }, { 10: 1, 11: 99 }]);
});

test('customer country falls back to the requester profile phone', () => {
  const users = new Map(USERS.map((u) => [u.id, u]));
  const cur = counter.analyze({ messages: [{ t: 50, a: 1, at: T0 + 1, fr: null, to: null }], users, requesters: { 50: 99 } }, {
    rates: rates.SERVICE_USD, defaultMarket: 'Other', marketForPhone: rates.marketForPhone, from: T0, to: T0 + 100
  }).current;
  assert.deepEqual([cur.tickets.get(50).market, cur.tickets.get(50).detected], ['Chile', true]);
});

test('monthly cost subtracts 1,000 free messages per business number', () => {
  // 3,000 messages in 30 days at $0.01 each, one number: (3000 - 1000) x 0.01 = 20.
  assert.ok(Math.abs(counter.monthlyCost([{ outbound: 3000, cost: 30 }], 30, 1000) - 20) < 1e-9);
  // Same volume treated as 2 numbers: (3000 - 2000) x 0.01 = 10.
  assert.ok(Math.abs(counter.monthlyCost([{ outbound: 3000, cost: 30, numbers: 2 }], 30, 1000) - 10) < 1e-9);
  // Two numbers measured separately: only the busy one pays.
  assert.ok(Math.abs(counter.monthlyCost([{ outbound: 2500, cost: 25 }, { outbound: 500, cost: 5 }], 30, 1000) - 15) < 1e-9);
  // Unidentified messages next to identified numbers get no free messages of their own.
  assert.ok(Math.abs(counter.monthlyCost([{ outbound: 500, cost: 5, numbers: 0 }], 30, 1000) - 5) < 1e-9);
});

test('retries rate-limited requests, stops on request and skips messages without a time', async () => {
  let calls = 0;
  const waits = [];
  const request = async (opts) => {
    if (opts.url.startsWith('/api/v2/users/show_many.json')) return { users: [] };
    if (opts.url.includes('conversation_log')) {
      return { events: [logMsg('agent', T0 + 1, 1, 'Ana'), { type: 'Messaging::ConversationMessage', author: { type: 'agent' } }] };
    }
    calls += 1;
    if (calls === 1) throw { status: 429, getResponseHeader: (h) => (h === 'Retry-After' ? '7' : null) };
    return { tickets: [ticket(1, wa(null, BIZ))], end_of_stream: true };
  };
  const r = await counter.countMessages({ request, startTime: T0, endTime: T0 + 100, logSpacingMs: 0, sleep: async (ms) => { waits.push(ms); } });
  assert.equal(r.status, 'done');
  assert.equal(r.messages.length, 1);
  assert.ok(waits.includes(7000));
  const failing = async () => { throw { status: 429 }; };
  await assert.rejects(counter.countMessages({ request: failing, startTime: T0, endTime: T0 + 100, sleep: async () => {} }));
  let first = true;
  const stopped = await counter.countMessages({
    request: makeApi({ pages: [{ tickets: [], after_cursor: 'x', end_of_stream: false }] }).request,
    startTime: T0, endTime: T0 + 1000, ...fast,
    shouldStop: () => { if (first) { first = false; return false; } return true; }
  });
  assert.equal(stopped.status, 'stopped');
});

test('distribution flags outliers above mean + 2 sd', () => {
  const values = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 10];
  const d = counter.distribution(values);
  assert.equal(d.median, 1);
  assert.equal(values.filter((v) => v > d.threshold).length, 1);
  assert.equal(counter.distribution([2, 2, 2]).threshold, Infinity);
  assert.equal(counter.distribution([]).n, 0);
});

test('single ticket cost from the agent conversation', () => {
  const item = (role, id, channel, name) => ({ author: { id, role, name }, channel: { name: channel }, timestamp: iso(T0) });
  const conversation = [
    item('end-user', 99, 'whatsapp', 'Cliente'), item('agent', 1, 'whatsapp', 'Ana'),
    item('system', null, 'whatsapp', 'Zenbot'), item('agent', 1, 'internal', 'Ana')
  ];
  const users = new Map([[99, { role: 'end-user', name: 'Cliente', phone: '+56 9 8765 4321' }]]);
  const base = { ticket: { id: 10, via: wa(null, BIZ) }, conversation, users, requesterId: 99, marketForPhone: rates.marketForPhone, rates: rates.SERVICE_USD, defaultMarket: 'Other' };
  const r = counter.singleTicketCost(base);
  assert.deepEqual([r.whatsapp, r.outbound, r.inbound, r.market, r.detected], [true, 2, 1, 'Chile', true]);
  assert.ok(Math.abs(r.cost - 0.04) < 1e-9);
  const email = counter.singleTicketCost({ ...base, ticket: { id: 11, via: { channel: 'email' } }, conversation: [item('agent', 1, 'email', 'Ana')] });
  assert.equal(email.whatsapp, false);
  const listed = counter.singleTicketCost({ ...base, ticket: { id: 12, via: { channel: 'any_channel' } }, channels: 'any_channel', conversation: [item('agent', 1, 'any_channel', 'Ana')] });
  assert.deepEqual([listed.whatsapp, listed.outbound], [true, 1]);
  // No customer phone anywhere: the business number's country when no default is chosen.
  const guess = counter.singleTicketCost({ ...base, users: new Map(), useNumberCountry: true });
  assert.deepEqual([guess.market, guess.detected], ['Argentina', false]);
});

test('packed result survives JSON and unpacks to the same data', () => {
  const result = {
    status: 'done', scanned: 5, channels: { email: 2, 'native_messaging / whatsapp': 3 }, requesters: { 1: 99 }, logMissing: 0,
    messages: [{ t: 1, a: 2, at: T0, fr: BIZ, to: '+56987654321' }, { t: 1, a: 99, at: T0 + 1, fr: '+56987654321', to: BIZ }, { t: 3, a: 500, at: T0 + 2, fr: null, to: null }],
    users: new Map([[2, { role: 'agent', name: 'Ana', phone: null }], ['bot:Zenbot', { role: 'bot', name: 'Zenbot', phone: null }], [99, { role: 'end-user', name: 'Cliente', phone: '+56 9 8765 4321' }]]),
    info: {
      1: { form: 10, brand: 20, group: 30, assignee: 2, org: null, status: 'solved', tags: ['vip', 'reclamo'], fields: { 555: 'motivo_envio' } },
      3: { form: null, brand: 20, group: null, assignee: null, org: 40, status: null, tags: ['vip'], fields: {} }
    },
    names: { forms: { 10: 'Soporte' }, brands: { 20: 'Zeni' }, groups: {}, orgs: {}, fields: { 555: { title: 'Motivo', type: 'tagger', options: { motivo_envio: 'Envío' } } } },
    window: { start: T0 - 100, end: T0 + 100 }, nativeOnly: true
  };
  const packed = JSON.parse(JSON.stringify(counter.packResult(result)));
  assert.equal(packed.phones.length, 2);
  assert.equal(packed.strs.filter((s) => s === 'vip').length, 1, 'repeated tags stored once');
  assert.deepEqual(counter.unpackResult(packed), result);
});

test('CSV escapes separators, quotes and formulas', () => {
  const csv = counter.toCsv(['a', 'b'], [['x;y', '=SUM(A1)'], ['say "hi"', 3]]);
  assert.equal(csv, 'a;b\r\n"x;y";\'=SUM(A1)\r\n"say ""hi""";3');
});

test('maps phones to Meta markets by country calling code', () => {
  const m = rates.marketForPhone;
  assert.equal(m('+54 9 11 5555 6666'), 'Argentina');
  assert.equal(m('5491155556666'), 'Argentina');
  assert.equal(m('+591 7123 4567'), 'Rest of Latin America');
  assert.equal(m('+1 809 555 1234'), 'Rest of Latin America');
  assert.equal(m('+1 415 555 1234'), 'North America');
  assert.equal(m('+7 701 123 4567'), 'Kazakhstan');
  assert.equal(m('+7 912 123 4567'), 'Russia');
  assert.equal(m('+81 90 1234 5678'), 'Rest of Asia Pacific');
  assert.equal(m('+850 123 456 789'), 'Other');
  assert.equal(m('1155556666'), null, 'local number without country code');
  assert.equal(m(null), null);
});

test('findMarket accepts English or Spanish names', () => {
  assert.equal(rates.findMarket('México'), 'Mexico');
  assert.equal(rates.findMarket(' rest of latin america '), 'Rest of Latin America');
  assert.equal(rates.findMarket('Resto de Latinoamérica'), 'Rest of Latin America');
  assert.equal(rates.findMarket('Narnia'), null);
});

test('a ticket listed on two export pages is read once', async () => {
  const { request } = makeApi({
    pages: [
      { tickets: [ticket(1, wa(null, BIZ)), ticket(2, wa(null, BIZ))], after_cursor: 'a', end_of_stream: false },
      { tickets: [ticket(2, wa(null, BIZ)), ticket(3, wa(null, BIZ))], end_of_stream: true }
    ],
    logs: { 1: [logMsg('agent', T0 + 1, 1, 'Ana')], 2: [logMsg('agent', T0 + 2, 1, 'Ana')], 3: [logMsg('agent', T0 + 3, 1, 'Ana')] }
  });
  const r = await counter.countMessages({ request, startTime: T0, endTime: T0 + 100, ...fast });
  assert.deepEqual([r.tickets, r.messages.length, r.scanned], [[1, 2, 3], 3, 3]);
});

test('national numbers with a trunk 0 have no country; international prefixes still work', () => {
  const m = rates.marketForPhone;
  assert.equal(m('011 5555 6666'), null);
  assert.equal(m('0115555666677'), null);
  assert.equal(m('005491155556666'), 'Argentina');
  assert.equal(m('+54 11 5555 6666'), 'Argentina');
});

test('a stopped run lists only the tickets it read, so an update run keeps the others', async () => {
  const many = Array.from({ length: 7 }, (_, k) => ticket(300 + k, wa(null, BIZ)));
  const logs = {};
  many.forEach((t) => { logs[t.id] = [logMsg('agent', T0 + 3, 1, 'Ana')]; });
  let stop = false;
  const r = await counter.countMessages({
    request: makeApi({ pages: [{ tickets: many, end_of_stream: true }], logs }).request, startTime: T0, endTime: T0 + 100, ...fast,
    shouldStop: () => stop, onProgress: (p) => { if (p.step === 'messages' && p.done >= 3) stop = true; }
  });
  assert.equal(r.status, 'stopped');
  assert.deepEqual(r.tickets, [300, 301, 302]);
  const old = { status: 'done', scanned: 7, channels: {}, requesters: {}, users: new Map(), messages: many.map((t) => ({ t: t.id, a: 1, at: T0 + 3, fr: null, to: null })) };
  assert.equal(counter.mergeResults(old, r, T0).messages.length, 7, 'unread tickets keep their old messages');
});

test('a ticket deleted since the last run loses its messages, as in a full run', async () => {
  const gone = { ...ticket(1, wa(null, BIZ)), status: 'deleted' };
  const { request } = makeApi({ pages: [{ tickets: [gone, ticket(2, wa(null, BIZ))], end_of_stream: true }], logs: { 2: [logMsg('agent', T0 + 3, 1, 'Ana')] } });
  const fresh = await counter.countMessages({ request, startTime: T0, endTime: T0 + 100, ...fast });
  assert.deepEqual([fresh.tickets, fresh.deleted], [[2], [1]]);
  const old = { status: 'done', scanned: 2, channels: {}, requesters: {}, users: new Map(),
    messages: [{ t: 1, a: 1, at: T0 + 1, fr: null, to: null }, { t: 2, a: 1, at: T0 + 2, fr: null, to: null }, { t: 3, a: 1, at: T0 + 2, fr: null, to: null }] };
  assert.deepEqual(counter.mergeResults(old, fresh, T0).messages.map((m) => m.t).sort(), [2, 3]);
});

test('equal costs have no spread, however the floating point sums come out', () => {
  assert.equal(counter.distribution([0.1 + 0.2, 0.3, 0.1 * 3, 0.3, 0.3]).sd, 0);
  assert.equal(counter.distribution([0.026, 0.026, 0.026, 0.026, 0.026]).threshold, Infinity);
  assert.ok(counter.distribution([0.01, 0.02, 0.03]).sd > 0.005);
});
