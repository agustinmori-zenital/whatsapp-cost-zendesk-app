(function () {
  'use strict';

  var client = ZAFClient.init();
  var counter = window.MessageCounter;
  var rates = window.MetaRates;
  var chart = window.BellChart;
  var demoMode = window.WaDemo;
  var shareLib = window.WaShare;
  var i18n = window.WaI18n;
  var t = i18n.t;
  var FREE = rates.FREE_SERVICE_PER_NUMBER_PER_MONTH;
  var BREAKDOWN_SHORT = 12;
  var PERIOD_SWITCH_TOLERANCE = 30 * 60; // a period switch reuses the last calculation if it is this fresh
  // A full run that would read logs for at least this long first offers a sample (see showPlan).
  var SAMPLE_OFFER_MINUTES = 5;
  var SAMPLE_DEFAULT = 500; // tickets in a first sample: about 5 minutes
  var NONE = '__none';
  // Ways to break the costs down. `filter`: also offered as a filter (and rows of the table apply it).
  var DIMENSIONS = [
    { id: 'form', label: 'Formulario', none: 'Sin formulario', filter: true },
    { id: 'brand', label: 'Marca', none: 'Sin marca', filter: true },
    { id: 'group', label: 'Grupo', none: 'Sin grupo', filter: true },
    { id: 'assignee', label: 'Agente asignado', none: 'Sin asignar', filter: true },
    { id: 'tag', label: 'Etiqueta', none: 'Sin etiquetas', filter: true },
    { id: 'attention', label: 'Atendido por', filter: true },
    { id: 'sessions', label: 'Conversaciones por ticket' },
    { id: 'org', label: 'Organización', none: 'Sin organización' },
    { id: 'status', label: 'Estado del ticket', none: 'Sin estado' },
    { id: 'market', label: 'País del cliente' }
  ];
  var ATTENTION = { bot: 'Solo IA o bots', mixed: 'IA y después un agente', agent: 'Solo agentes', none: 'Sin respuestas' };
  var STATUS = { 'new': 'Nuevo', open: 'Abierto', pending: 'Pendiente', hold: 'En espera', solved: 'Resuelto', closed: 'Cerrado' };
  // Monday first, in the interface language.
  function weekday(i, style) { return new Date(2024, 0, 1 + i).toLocaleDateString(i18n.locale(), { weekday: style }); }
  var FILTERS_KEY = 'wa-cost:filters';
  var DIMENSION_KEY = 'wa-cost:dimension';
  // "¿Necesitas ayuda?": with `zendesk` (a Zendesk subdomain whose Help Center accepts requests from anyone),
  // the message becomes a request there and Zendesk emails the team; without it, the agent's mail app opens
  // with the message ready to send to `email`.
  var SUPPORT = { email: 'delivery.zenter@zenital.co', zendesk: null };
  // Averages per form, group and brand for the ticket panel when shared results are off (same browser only).
  var BENCHMARKS_KEY = 'wa-cost:benchmarks';
  var OUTLIERS_SHORT = 5;
  var OUTLIERS_LONG = 25;
  var TOP_AUTHORS = 8;
  var DAY = 86400;
  // v4: v3 held results from update runs that lost messages (0.13), so they are discarded.
  var CACHE_KEY = 'wa-cost:last:v4';
  var OLD_CACHE_KEY = 'wa-cost:last:v3';
  // Read by the ticket sidebar (same app origin) when no default country is saved in the settings.
  var COMMON_MARKET_KEY = 'wa-cost:common-market';
  // Demo mode keeps its own copies, so simulated numbers never replace or feed the real ones.
  var DEMO_SUFFIX = ':demo';
  var RANGE_ERRORS = {
    missing: 'Elige las fechas "Desde" y "Hasta".',
    future: 'La fecha "Desde" todavía no llegó. Elige una fecha pasada.',
    order: 'La fecha "Desde" tiene que ser anterior a "Hasta".',
    invalid: 'Ese período no es válido. Prueba con otras fechas.'
  };
  var $ = function (id) { return document.getElementById(id); };
  var els = {
    form: $('form'), from: $('from'), to: $('to'), run: $('run'), stop: $('stop'), customRange: $('custom-range'),
    loading: $('loading'), loadingTitle: $('loading-title'), loadingText: $('loading-text'), loadingPct: $('loading-pct'), loadingEta: $('loading-eta'),
    progress: $('progress'), progressBars: [$('progress-bar-1'), $('progress-bar-2')], steps: [$('step-1'), $('step-2')], stepMeta: [$('step-1-meta'), $('step-2-meta')], error: $('error'), empty: $('empty'), dashboard: $('dashboard'),
    headline: $('headline'), exportBtn: $('export'),
    kpiTicket: $('kpi-ticket'), kpiTicketSub: $('kpi-ticket-sub'), kpiTicketDelta: $('kpi-ticket-delta'),
    kpiMonth: $('kpi-month'), kpiMonthSub: $('kpi-month-sub'), kpiMonthDelta: $('kpi-month-delta'),
    statSent: $('stat-sent'), statSentSub: $('stat-sent-sub'), statBots: $('stat-bots'), statBotsSub: $('stat-bots-sub'),
    statDetected: $('stat-detected'), statDetectedSub: $('stat-detected-sub'), statYear: $('stat-year'), statYearSub: $('stat-year-sub'),
    kpiTickets: $('kpi-tickets'), kpiTicketsSub: $('kpi-tickets-sub'), kpiTicketsDelta: $('kpi-tickets-delta'),
    chart: $('chart'), tooltip: $('tooltip'), weekly: $('weekly'), weeklyTooltip: $('weekly-tooltip'),
    markets: $('markets'), numbersList: $('numbers-list'), numbersNote: $('numbers-note'), authors: $('authors'),
    outliers: $('outliers'), outlierCount: $('outlier-count'), outlierNote: $('outlier-note'), outliersMore: $('outliers-more'),
    unknownNote: $('unknown-note'), defaultMarket: $('default-market'), numbers: $('numbers'), ratesDate: $('rates-date'),
    channels: $('channels'), budget: $('budget'), autoRefresh: $('auto-refresh'), lang: $('lang'),
    budgetAlert: $('budget-alert'), budgetAlertText: $('budget-alert-text'),
    filters: $('filters'), clearFilters: $('clear-filters'), filterNote: $('filter-note'),
    dimension: $('dimension'), breakdown: $('breakdown'), breakdownMore: $('breakdown-more'), breakdownNote: $('breakdown-note'),
    heatmap: $('heatmap'), heatmapTooltip: $('heatmap-tooltip'), billing: $('billing'), billingNote: $('billing-note'),
    shareStatus: $('share-status'), shareBtn: $('share-btn'),
    helpOpen: $('help-open'), helpForm: $('help-form'), helpName: $('help-name'), helpEmail: $('help-email'), helpMessage: $('help-message'),
    helpTech: $('help-tech'), helpSend: $('help-send'), helpCancel: $('help-cancel'), helpStatus: $('help-status'),
    demoBadge: $('demo-badge'), demoNote: $('demo-note'),
    plan: $('plan'), planText: $('plan-text'), planSize: $('plan-size'), planSizeText: $('plan-size-text'),
    planSample: $('plan-sample'), planFull: $('plan-full'), planCancel: $('plan-cancel'),
    sample: $('sample'), sampleText: $('sample-text'), sampleMargin: $('sample-margin'), sampleSize: $('sample-size'),
    sampleSizeText: $('sample-size-text'), sampleExtend: $('sample-extend'), sampleAll: $('sample-all'),
    freshness: $('freshness'), diagnostic: $('diagnostic'), diagnosticText: $('diagnostic-text'), diagnosticList: $('diagnostic-list'), saveMarket: $('save-market'), saveMarketNote: $('save-market-note')
  };
  var meta = null; // client.metadata(): installation id and saved settings
  var demo = false; // demo_mode setting on: every request goes to the fake account in demo.js
  var demoApi = null;
  var effectiveMarket = null; // country used for tickets without a detected one
  var segs = Array.prototype.slice.call(document.querySelectorAll('.seg'));
  var period = '30';
  var stopRequested = false;
  var showAllOutliers = false;
  var last = null; // { result, range }
  var base = null; // last complete result: what an update run extends, even after a cancelled or failed run replaced `last`
  var channelsDirty = false; // the channels field was edited here, so a save may carry it
  var marketDirty = false; // the default country was chosen here
  var view = null; // { costs, dist, weeks, heat } for re-drawing charts on resize and for the CSV
  var filters = {}; // dimension id -> key, e.g. { form: '360002' }
  var dimension = 'form';
  var showAllBreakdown = false;
  var attentionOf = new Map(); // ticket id -> 'bot' | 'mixed' | 'agent', from the unfiltered analysis
  var billing = {}; // 'YYYY-MM' -> US$ billed by Meta, as edited here (saved in the meta_billing setting)
  var share = null; // shared results in a custom object (share.js)
  var shareState = 'unknown'; // unknown | unavailable | missing | ready | busy
  var shareInfo = null; // { savedAt } of the shared copy
  var shareError = '';
  var running = false;
  var profileLocale = null; // the agent's Zendesk language, used when no language is chosen here
  var counting = false; // asking Zendesk how many tickets a full run has (before the plan card)
  var pending = null; // run waiting for the choice between a sample and every ticket: { range, inputs, plan, channels, count }

  function isoDate(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  // Zendesk's API, or the simulated one in demo mode. Nothing reaches the real account in demo mode.
  function api(opts) { return demo ? demoApi.request(opts) : client.request(opts); }
  function cacheKey() { return CACHE_KEY + (demo ? DEMO_SUFFIX : ''); }
  function commonMarketKey() { return COMMON_MARKET_KEY + (demo ? DEMO_SUFFIX : ''); }
  function dayMonth(unix) { return new Date(unix * 1000).toLocaleDateString(i18n.locale(), { day: '2-digit', month: '2-digit' }); }
  function shortDate(s) { var p = s.split('-'); return dayMonth(new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getTime() / 1000); }
  function clock(d) { return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }

  function node(tag, text, cls) {
    var c = document.createElement(tag);
    if (text != null) c.textContent = text;
    if (cls) c.className = cls;
    return c;
  }

  // 'always' so 1000 reads 1.000 (Spanish skips the separator for 4 digits by default).
  function fmt(n) { return Math.round(n).toLocaleString(i18n.locale(), { useGrouping: 'always' }); }
  function dec(n, d) { return n.toLocaleString(i18n.locale(), { minimumFractionDigits: d, maximumFractionDigits: d }); }
  // Ticket costs are often a few cents: keep 3 decimals under 10 cents so they don't all read as US$ 0,0x.
  function money(n) { return 'US$ ' + dec(n, n > 0 && n < 0.1 ? 3 : 2); }
  function rate(n) { return '$' + n.toLocaleString(i18n.locale(), { maximumFractionDigits: 4 }); }
  function moneyAxis(n) { return '$' + (n === 0 ? '0' : n < 1 ? dec(n, n < 0.1 ? 3 : 2) : dec(n, n % 1 ? 1 : 0)); }
  function marketName(m) { return rates.name(m, i18n.locale()); }
  function duration(min) {
    if (min < 1) return t('menos de 1 min');
    if (min < 60) return t('{n} min', { n: fmt(Math.ceil(min)) });
    var h = Math.floor(min / 60);
    var m = Math.round(min - h * 60);
    return m ? t('{h} h {m} min', { h: fmt(h), m: fmt(m) }) : t('{h} h', { h: fmt(h) });
  }
  // Tickets each ticket read stands for (sampled results), so counts are shown for the whole period.
  function weight(summary) { return summary && summary.sample ? summary.sample.w : 1; }
  // Margin of a sampled period's cost, as a monthly amount.
  function monthlyMargin(summary) { return summary && summary.sample && summary.sample.margin ? summary.sample.margin / last.range.days * 30 : 0; }
  // "1 ticket" / "3 tickets": both forms are Spanish texts, translated here.
  function plural(n, one, many) { return fmt(n) + ' ' + t(n === 1 ? one : many); }

  function setHeadline(parts) {
    els.headline.replaceChildren();
    parts.forEach(function (p) { els.headline.appendChild(typeof p === 'string' ? document.createTextNode(p) : node('strong', p.b)); });
  }

  // "▲ 12% vs. período anterior". higherIsWorse paints increases orange and decreases green.
  function setDelta(el, now, before, higherIsWorse) {
    el.className = 'delta';
    el.hidden = false;
    // Nothing to compare with: no pill at all, instead of the same note on every card.
    if (!before) { el.textContent = before === 0 && now === 0 ? t('= igual que el período anterior') : ''; el.hidden = !el.textContent; return; }
    var pct = (now - before) / before * 100;
    if (Math.abs(pct) < 0.5) { el.textContent = t('= igual que el período anterior'); return; }
    el.textContent = (pct > 0 ? '▲ ' : '▼ ') + t('{pct}% vs. período anterior', { pct: fmt(Math.abs(pct)) });
    if (higherIsWorse) el.className += pct > 0 ? ' up' : ' down';
  }

  // One row of a ranked list: name, value, proportional bar and a detail line.
  function barRow(list, name, value, share, meta, pill) {
    var li = node('li', null, 'bar-row');
    var n = node('span', name, 'bar-name');
    if (pill) n.appendChild(node('span', pill, 'pill'));
    li.appendChild(n);
    li.appendChild(node('span', value, 'bar-value'));
    var track = node('div', null, 'bar-track');
    var fill = node('div', null, 'bar-fill');
    fill.style.width = Math.max(2, share * 100) + '%';
    track.appendChild(fill);
    li.appendChild(track);
    li.appendChild(node('span', meta, 'bar-meta'));
    list.appendChild(li);
  }

  function settingNumbers() { return Math.max(1, parseInt(els.numbers.value, 10) || 1); }

  // Groups for the free tier: one per identified business number. Unidentified messages count as
  // the number of business numbers set in Ajustes when no number could be identified at all; when
  // some were identified, they belong to those numbers and get no free messages of their own.
  function freeTierGroups(summary) {
    var groups = Array.from(summary.byNumber.values());
    var identified = groups.filter(function (g) { return g.key; }).length;
    return groups.map(function (g) {
      return { key: g.key, outbound: g.outbound, cost: g.cost, tickets: g.tickets, numbers: g.key ? 1 : identified ? 0 : settingNumbers() };
    });
  }

  // useNumberCountry: without a default country chosen by an admin, tickets without a customer phone
  // use the country of their business number before the fallback.
  // Analyses of the current result, keyed by their inputs: a keystroke in Ajustes or a filter that was
  // already used re-renders without going through every message again.
  var memo = { result: null, range: null, map: new Map() };
  function memoized(key, make) {
    if (memo.result !== last.result || memo.range !== last.range) memo = { result: last.result, range: last.range, map: new Map() };
    if (!memo.map.has(key)) memo.map.set(key, make());
    return memo.map.get(key);
  }

  // filter: ticket id -> bool (see ticketFilter); withMonths: also the calendar months, for the Meta invoice card.
  // filterKey: what the filter selects, for the memo (filters are functions).
  function analyze(defaultMarket, useNumberCountry, filter, withMonths, filterKey) {
    return memoized([defaultMarket, useNumberCountry, filter ? filterKey || 'f' : '', withMonths ? 'm' : ''].join('|'), function () {
      return analyzeNow(defaultMarket, useNumberCountry, filter, withMonths);
    });
  }

  // While the previous period is still loading (current period complete), there is nothing to compare with yet.
  function previousPending() { return !!(last && last.result.status === 'partial' && last.result.currentComplete); }

  function analyzeNow(defaultMarket, useNumberCountry, filter, withMonths) {
    var r = last.range;
    return counter.analyze(last.result, {
      rates: rates.SERVICE_USD, defaultMarket: defaultMarket, marketForPhone: rates.marketForPhone,
      useNumberCountry: useNumberCountry, from: r.start, to: r.end, prevFrom: previousPending() ? null : r.prevStart,
      ticketFilter: filter || null, months: !!withMonths
    });
  }

  // --- Dimensions and filters -------------------------------------------------------------------

  function infoOf(id) { return (last.result.info && last.result.info[id]) || null; }

  function fieldDims() {
    var fields = (last && last.result.names && last.result.names.fields) || {};
    return Object.keys(fields).map(function (id) { return { id: 'field:' + id, label: t('Campo: {name}', { name: fields[id].title }), none: 'Sin valor' }; });
  }

  function dimensionOf(id) {
    return DIMENSIONS.concat(fieldDims()).filter(function (d) { return d.id === id; })[0] || null;
  }

  // Key(s) of a ticket (a summarize ticket) in a dimension; tags give one key per tag.
  function dimKey(dim, t) {
    var i = infoOf(t.id) || {};
    if (dim === 'attention') return t.attention;
    if (dim === 'sessions') return t.sessions >= 3 ? '3+' : String(t.sessions);
    if (dim === 'market') return t.market;
    if (dim === 'tag') return i.tags && i.tags.length ? i.tags : NONE;
    if (dim.indexOf('field:') === 0) {
      var f = i.fields && i.fields[dim.slice(6)];
      return f == null ? NONE : f;
    }
    return i[dim] == null ? NONE : String(i[dim]);
  }

  function dimLabel(dim, key) {
    var names = (last && last.result.names) || {};
    if (key === NONE) return t((dimensionOf(dim) || {}).none || 'Sin dato');
    if (dim === 'attention') return t(ATTENTION[key] || key);
    if (dim === 'sessions') return key === '1' ? t('1 conversación') : key === '3+' ? t('3 o más conversaciones') : t('{n} conversaciones', { n: key });
    if (dim === 'market') return marketName(key);
    if (dim === 'status') return STATUS[key] ? t(STATUS[key]) : key;
    if (dim === 'assignee') {
      var u = last.result.users.get(Number(key));
      return (u && u.name) || unnamed('Agente', key);
    }
    var lists = { form: ['forms', 'Formulario'], brand: ['brands', 'Marca'], group: ['groups', 'Grupo'], org: ['orgs', 'Organización'] };
    if (lists[dim]) return (names[lists[dim][0]] || {})[key] || unnamed(lists[dim][1], key);
    if (dim.indexOf('field:') === 0) {
      var field = (names.fields || {})[dim.slice(6)];
      return (field && field.options && field.options[key]) || key;
    }
    return key;
  }

  // An item Zendesk gave no name for (deleted, or not visible to this user): its kind and the end of its id.
  function unnamed(kind, id) {
    return t('{kind} sin nombre (ID …{id})', { kind: t(kind), id: String(id).slice(-6) });
  }

  // Results read before a name could be found (an older version, a failed list): ask Zendesk again, once per
  // result, and redraw. Never in demo mode.
  var namesAsked = null;
  function completeNames() {
    var r = last && last.result;
    if (!r || demo || r.status !== 'done' || namesAsked === r || !counter.missingNames(r.info, r.names)) return;
    namesAsked = r;
    counter.fetchNames(api, r.info, r.names).then(function (names) {
      if (!last || last.result !== r) return;
      r.names = names;
      if (base && base.result === r) saveCache();
      render();
    }, function () { /* names are optional */ });
  }

  function activeFilters() { return Object.keys(filters).filter(function (k) { return filters[k] != null && filters[k] !== ''; }); }

  // Ticket test for the active filters (except `skip`), or null without filters.
  function ticketFilter(skip) {
    var dims = activeFilters().filter(function (d) { return d !== skip; });
    if (!dims.length) return null;
    return function (id) {
      return dims.every(function (dim) {
        var want = filters[dim];
        if (dim === 'attention') return attentionOf.get(id) === want;
        var i = infoOf(id) || {};
        if (dim === 'tag') return want === NONE ? !(i.tags && i.tags.length) : !!(i.tags && i.tags.indexOf(want) >= 0);
        return (i[dim] == null ? NONE : String(i[dim])) === want;
      });
    };
  }

  function filterKeyOf(skip) {
    return activeFilters().filter(function (d) { return d !== skip; }).sort().map(function (d) { return d + '=' + filters[d]; }).join('&');
  }

  function setFilter(dim, key) {
    if (filters[dim] === key) delete filters[dim]; else filters[dim] = key;
    store(filtersKey(), JSON.stringify(filters));
    render();
  }

  function filtersKey() { return FILTERS_KEY + (demo ? DEMO_SUFFIX : ''); }

  // Options of each filter from the unfiltered tickets of the period, with their ticket counts.
  function renderFilters(fullCur) {
    var any = false;
    Array.prototype.forEach.call(els.filters.querySelectorAll('.filter'), function (label) {
      var dim = label.dataset.dim;
      var select = label.querySelector('select');
      var rows = counter.breakdown(fullCur, null, function (t) { return dimKey(dim, t); });
      var current = filters[dim] || '';
      label.hidden = rows.length < 2 && !current;
      label.classList.toggle('active', !!current);
      if (!label.hidden) any = true;
      select.replaceChildren(new Option(t('Todos'), ''));
      rows.sort(function (a, b) { return b.tickets - a.tickets; }).forEach(function (r) {
        select.appendChild(new Option(dimLabel(dim, r.key) + ' (' + fmt(r.tickets) + ')', r.key));
      });
      if (current && !rows.some(function (r) { return r.key === current; })) select.appendChild(new Option(dimLabel(dim, current) + ' (0)', current));
      select.value = current;
    });
    els.filters.hidden = !any;
    els.clearFilters.hidden = !activeFilters().length;
  }

  function filterText() {
    return activeFilters().map(function (dim) { return t(dimensionOf(dim).label) + ': ' + dimLabel(dim, filters[dim]); }).join(' · ');
  }

  // monthly, prevMonthly: after the free tier (with filters, the filtered tickets' share of the total).
  function renderSummary(cur, prev, costs, dist, monthly, prevMonthly, filtered) {
    var days = last.range.days;
    var prevCosts = prev ? Array.from(prev.tickets.values()) : [];
    var prevAvg = prevCosts.length ? prev.cost / (prevCosts.length * weight(prev)) : 0;
    var count = costs.length * weight(cur);
    var prevCount = prev ? prevCosts.length * weight(prev) : null;
    var margin = monthlyMargin(cur);
    // Monthly cost before Meta's free messages: shown when they cover everything, so a US$ 0,00 next to
    // tickets that do cost something is explained.
    var covered = monthly === 0 && cur.outbound > 0;
    // The margin is on the cost before free messages: next to US$ 0,00 it would read as a margin on nothing.
    if (covered) margin = 0;
    var gross = cur.cost / days * 30;
    var budget = budgetValue();

    els.kpiTicket.textContent = money(dist.mean);
    els.kpiTicketSub.textContent = t('En promedio. La mitad cuesta menos de {x}.', { x: money(dist.median) });
    setDelta(els.kpiTicketDelta, dist.mean, prevAvg, true);

    els.kpiMonth.textContent = money(monthly);
    els.kpiMonthSub.textContent = covered
      ? t('Cubierto por los mensajes gratis de Meta. Sin ellos: {x}.', { x: money(gross) })
      : filtered ? t('Parte del costo mensual total que generan estos tickets.')
      : t('Estimado, ya restados los mensajes gratis.') + (budget ? ' ' + t('Usa el {pct}% del presupuesto.', { pct: fmt(monthly / budget * 100) }) : '');
    if (margin) els.kpiMonthSub.textContent = t('± {x} (muestra).', { x: money(margin) }) + ' ' + els.kpiMonthSub.textContent;
    setDelta(els.kpiMonthDelta, monthly, prevMonthly, true);

    els.kpiTickets.textContent = (cur.sample ? '≈ ' : '') + fmt(count);
    els.kpiTicketsSub.textContent = t('{n} mensajes enviados por ticket.', { n: count ? dec(cur.outbound / count, 1) : '0' });
    setDelta(els.kpiTicketsDelta, count, prevCount, false);

    renderStats(cur, costs, monthly);

    // "{period}: <b>N tickets</b> de WhatsApp, <b>US$ x</b> por ticket y <b>US$ y</b> por mes." with bold parts.
    var parts = t('{period}: [N tickets] de WhatsApp, [por ticket] por ticket y [por mes] por mes.').split(/(\{period\}|\[[^\]]+\])/);
    var bold = { '[N tickets]': (cur.sample ? '≈ ' : '') + plural(count, 'ticket', 'tickets'), '[por ticket]': money(dist.mean),
      '[por mes]': money(monthly) + (margin ? ' ± ' + money(margin) : '') };
    var headline = parts.filter(Boolean).map(function (p) {
      if (p === '{period}') return rangeLabel(last.range) + (filtered ? ' ' + t('(con filtros)') : '');
      return bold[p] ? { b: bold[p] } : p;
    });
    if (cur.sample) headline.push(' ' + t('Estimado con una muestra.'));
    setHeadline(headline);
  }

  function isBot(key) {
    var u = last.result.users.get(key);
    return !u || u.role === 'bot' || u.role === 'system';
  }

  // --- Breakdown table --------------------------------------------------------------------------

  function renderDimensionSelect() {
    var dims = DIMENSIONS.concat(fieldDims());
    var sig = i18n.locale() + '|' + dims.map(function (d) { return d.id; }).join('|');
    if (els.dimension.dataset.sig !== sig) {
      els.dimension.replaceChildren();
      dims.forEach(function (d) { els.dimension.appendChild(new Option(t(d.label), d.id)); });
      els.dimension.dataset.sig = sig;
    }
    if (!dimensionOf(dimension)) dimension = 'form';
    els.dimension.value = dimension;
  }

  function renderBreakdown(cur, prev) {
    renderDimensionSelect();
    var dim = dimension;
    var d = dimensionOf(dim);
    var rows = counter.breakdown(cur, prev, function (t) { return dimKey(dim, t); });
    els.breakdown.replaceChildren();
    rows.slice(0, showAllBreakdown ? rows.length : BREAKDOWN_SHORT).forEach(function (r) {
      var tr = node('tr');
      var selected = filters[dim] === r.key;
      if (d.filter) {
        tr.className = 'pick' + (selected ? ' selected' : '');
        tr.tabIndex = 0;
        tr.setAttribute('aria-pressed', String(selected));
        tr.title = selected ? t('Quitar este filtro') : t('Filtrar por {name}', { name: dimLabel(dim, r.key) });
        var pick = function () { setFilter(dim, r.key); };
        tr.addEventListener('click', pick);
        tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
      }
      var th = node('th', dimLabel(dim, r.key));
      th.scope = 'row';
      tr.appendChild(th);
      var portion = cur.cost ? r.cost / cur.cost : 0;
      var pctCell = node('td', fmt(portion * 100) + '%', 'num');
      var bar = node('span', null, 'share-bar');
      var fill = node('i');
      fill.style.width = Math.min(100, portion * 100) + '%';
      bar.appendChild(fill);
      pctCell.appendChild(bar);
      var per = r.cost / r.tickets;
      var prevPer = r.prev.tickets ? r.prev.cost / r.prev.tickets : null;
      var delta = node('td', '—', 'num');
      if (prevPer) {
        var pct = (per - prevPer) / prevPer * 100;
        delta.textContent = Math.abs(pct) < 0.5 ? '=' : (pct > 0 ? '▲ ' : '▼ ') + fmt(Math.abs(pct)) + '%';
        if (Math.abs(pct) >= 0.5) delta.className += pct > 0 ? ' up' : ' down';
      }
      var costCell = node('td', money(r.cost), 'num');
      if (r.margin != null) costCell.appendChild(node('span', '± ' + money(r.margin), 'pm'));
      [node('td', (cur.sample ? '≈ ' : '') + fmt(r.tickets), 'num'), costCell, pctCell, node('td', money(per), 'num'),
        node('td', dec(r.outbound / r.tickets, 1), 'num'), delta].forEach(function (c) { tr.appendChild(c); });
      els.breakdown.appendChild(tr);
    });
    if (!rows.length) {
      var empty = node('tr');
      var td = node('td', t('Sin tickets en el período.'), 'muted');
      td.colSpan = 7;
      empty.appendChild(td);
      els.breakdown.appendChild(empty);
    }
    els.breakdownMore.hidden = rows.length <= BREAKDOWN_SHORT;
    els.breakdownMore.textContent = showAllBreakdown ? t('Ver menos') : t('Ver las {n} filas', { n: fmt(rows.length) });
    var notes = [];
    if (dim === 'tag') notes.push('Un ticket con varias etiquetas cuenta en cada una, así que los porcentajes suman más de 100%.');
    if (dim === 'assignee') notes.push('Agente al que está asignado el ticket hoy. Para quién envió los mensajes, mira "¿Quién envía más mensajes?".');
    if (dim === 'attention') notes.push('Los tickets que resuelve solo la IA cuestan menos en WhatsApp y además no ocupan tiempo de agentes.');
    if (dim === 'sessions') notes.push('Cada vez que el cliente vuelve a escribir después de 24 horas empieza otra conversación.');
    if (cur.tickets.size && !Object.keys(last.result.info || {}).length) notes.push('Este cálculo es de una versión anterior de la app: haz clic en "Ver costo" para traer formularios, grupos y etiquetas.');
    els.breakdownNote.textContent = notes.map(function (n) { return t(n); }).join(' ');
  }

  // --- Heatmap ----------------------------------------------------------------------------------

  function heatOf(cur) {
    var cost = [];
    var sent = [];
    for (var d = 0; d < 7; d++) {
      cost.push([]);
      sent.push([]);
      for (var h = 0; h < 24; h++) {
        var c = cur.byHour.get(d * 24 + h);
        cost[d].push(c ? c.cost : 0);
        sent[d].push(c ? c.outbound : 0);
      }
    }
    return { cost: cost, sent: sent };
  }

  // --- Budget and Meta invoices -----------------------------------------------------------------

  function numberOf(input) {
    var v = parseFloat(String(input.value || '').replace(',', '.'));
    return v > 0 ? v : 0;
  }
  function budgetValue() { return numberOf(els.budget); }
  function autoRefreshHours() { return Math.floor(numberOf(els.autoRefresh)); }

  function renderBudget(fullMonthly) {
    var budget = budgetValue();
    var partial = last.result.status === 'partial';
    var show = !!budget && !partial && fullMonthly >= budget * 0.9;
    els.budgetAlert.hidden = !show;
    if (!show) return;
    var over = fullMonthly > budget;
    els.budgetAlert.className = 'notice warn' + (over ? ' over' : '');
    els.budgetAlertText.textContent = over
      ? t('El costo estimado por mes ({x}) supera tu presupuesto de {b} en un {pct}%.', { x: money(fullMonthly), b: money(budget), pct: fmt((fullMonthly / budget - 1) * 100) })
      : t('El costo estimado por mes ({x}) ya usa el {pct}% de tu presupuesto de {b}.', { x: money(fullMonthly), b: money(budget), pct: fmt(fullMonthly / budget * 100) });
  }

  function monthLabel(key) {
    var p = key.split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, 1).toLocaleDateString(i18n.locale(), { month: 'long', year: 'numeric' });
  }

  // Calendar months fully inside the loaded data (both periods): estimate after the free tier vs. what Meta billed.
  function renderBilling(monthsList) {
    els.billing.replaceChildren();
    if (last.result.status === 'partial') {
      var wait = node('tr');
      var cell = node('td', t('Se completa cuando termine el cálculo.'), 'muted');
      cell.colSpan = 5;
      wait.appendChild(cell);
      els.billing.appendChild(wait);
      els.billingNote.textContent = '';
      return;
    }
    var rows = (monthsList || []).filter(function (mo) { return mo.complete; }).reverse();
    rows.forEach(function (mo) {
      var est = counter.monthlyCost(freeTierGroups(mo.summary), 30, FREE);
      var tr = node('tr');
      var th = node('th', monthLabel(mo.key));
      th.scope = 'row';
      tr.appendChild(th);
      tr.appendChild(node('td', fmt(mo.summary.outbound), 'num'));
      tr.appendChild(node('td', money(est), 'num'));
      var inputCell = node('td', null, 'num');
      var input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'decimal';
      input.placeholder = dec(0, 2);
      input.setAttribute('aria-label', t('Facturado por Meta en {month} (US$)', { month: monthLabel(mo.key) }));
      input.value = billing[mo.key] != null ? dec(billing[mo.key], 2) : '';
      inputCell.appendChild(input);
      tr.appendChild(inputCell);
      var diff = node('td', '—', 'num');
      tr.appendChild(diff);
      function showDiff() {
        var billed = billing[mo.key];
        diff.className = 'num';
        if (!billed) { diff.textContent = '—'; return; }
        var pct = (est - billed) / billed * 100;
        diff.textContent = Math.abs(pct) < 0.5 ? t('Igual') : t(pct > 0 ? 'Estimado {pct}% más alto' : 'Estimado {pct}% más bajo', { pct: fmt(Math.abs(pct)) });
        diff.className += Math.abs(pct) <= 10 ? ' diff-ok' : ' diff-off';
      }
      input.addEventListener('input', function () {
        var v = counter.parseBilling(mo.key + '=' + input.value.trim())[mo.key];
        if (v) billing[mo.key] = v; else delete billing[mo.key];
        showDiff();
        renderSaveMarket();
      });
      showDiff();
      els.billing.appendChild(tr);
    });
    if (!rows.length) {
      var empty = node('tr');
      var td = node('td', t('No hay un mes calendario completo en los datos. Elige 90 días, o un rango que cubra un mes entero.'), 'muted');
      td.colSpan = 5;
      empty.appendChild(td);
      els.billing.appendChild(empty);
    }
    els.billingNote.textContent = rows.length
      ? t('Diferencias de más de 10% suelen venir de plantillas de marketing o autenticación, conversaciones gratis desde anuncios o mensajes no entregados, que Zendesk no informa.')
      : '';
  }

  // --- Shared results ---------------------------------------------------------------------------

  function snapshot() {
    var inputs = last.inputs || { period: period, from: els.from.value, to: els.to.value };
    return {
      savedAt: last.savedAt || Date.now(), period: inputs.period, from: inputs.from, to: inputs.to, channels: last.channels || '',
      // Without customer phones or names: only their market is needed again.
      range: last.range, result: counter.packResult(last.result, { marketForPhone: rates.marketForPhone })
    };
  }

  // Averages for the ticket panel, with the names it shows.
  function currentBenchmarks() {
    if (!last || last.result.status !== 'done') return null;
    var a = analyze(effectiveMarket || 'Other', !rates.findMarket(els.defaultMarket.value), null, true);
    var b = counter.benchmarks(a.current, last.result.info);
    var names = last.result.names || {};
    b.names = { form: {}, group: {}, brand: {} };
    [['form', 'forms'], ['group', 'groups'], ['brand', 'brands']].forEach(function (p) {
      Object.keys(b[p[0]]).forEach(function (id) { if ((names[p[1]] || {})[id]) b.names[p[0]][id] = names[p[1]][id]; });
    });
    b.savedAt = last.savedAt;
    return b;
  }

  function renderShare() {
    var btn = els.shareBtn;
    btn.hidden = true;
    btn.disabled = false;
    var text;
    if (shareState === 'unknown') text = t('Revisando si se pueden compartir los resultados…');
    else if (shareState === 'busy') { text = t('Compartiendo con el equipo…'); }
    else if (shareState === 'unavailable') {
      text = t('No disponible en esta cuenta: hace falta Zendesk Suite Team o superior (objetos personalizados) y ser administrador.') + ' ' +
        t('Mientras tanto, cada administrador ve su último cálculo en su navegador.');
    } else if (shareState === 'missing') {
      text = t('Guarda el último cálculo en Zendesk para que lo vean los demás administradores sin esperar, y para que el panel de cada ticket lo compare con el promedio.') + ' ' +
        t('Crea el objeto personalizado "WhatsApp Cost (app data)" (usa 1 de los objetos de tu plan).');
      btn.hidden = false;
      btn.textContent = t('Activar y compartir');
      btn.disabled = !(last && last.result.status === 'done');
    } else {
      text = t('Activado: cada cálculo completo se comparte con el equipo y con el panel de los tickets.') + ' ' +
        (shareInfo && shareInfo.savedAt ? t('Último compartido: {when}.', { when: whenText(shareInfo.savedAt) }) : t('Todavía no se compartió ningún cálculo.'));
      btn.hidden = false;
      btn.textContent = t('Compartir ahora');
      btn.disabled = !(last && last.result.status === 'done' && !last.result.sample) || !!(shareInfo && last.savedAt && shareInfo.savedAt >= last.savedAt);
    }
    // Only complete calculations are shared: a sample's numbers are estimates.
    if (last && last.result.sample && (shareState === 'ready' || shareState === 'missing')) text += ' ' + t('Las estimaciones con muestra no se comparten: solo los cálculos completos.');
    els.shareStatus.textContent = text + (shareError ? ' ' + shareError : '');
  }

  function whenText(ms) {
    return t('{date} a las {time}', { date: dayMonth(ms / 1000), time: clock(new Date(ms)) });
  }

  function publish() {
    if (!share || !last || last.result.status !== 'done' || last.result.sample) return Promise.resolve();
    var before = shareState;
    shareState = 'busy';
    shareError = '';
    renderShare();
    var snap = snapshot();
    var bench = currentBenchmarks();
    return share.publish(snap, bench).then(function (r) {
      shareInfo = { savedAt: r.savedAt };
      shareState = 'ready';
    }).catch(function (err) {
      if (window.console) console.error('WhatsApp cost (share):', err && (err.status || err.message));
      shareState = before === 'missing' ? 'missing' : 'ready';
      shareError = err && err.status === 403 ? t('No tienes permiso para escribir los datos compartidos.') : t('No pudimos compartir el cálculo{code}. Intenta de nuevo.', { code: err && err.status ? ' (error ' + err.status + ')' : '' });
    }).then(renderShare);
  }

  function onShareClick() {
    if (shareState === 'missing') {
      shareState = 'busy';
      shareError = '';
      renderShare();
      share.setup().then(function () {
        shareState = 'ready';
        return publish();
      }).catch(function (err) {
        if (window.console) console.error('WhatsApp cost (share setup):', err && (err.status || err.message));
        shareState = err && (err.status === 403 || err.status === 422) ? 'unavailable' : 'missing';
        shareError = err && err.status === 422 ? t('Zendesk no dejó crear el objeto (puede que tu plan llegó al límite de objetos personalizados).') : t('No pudimos activarlo{code}.', { code: err && err.status ? ' (error ' + err.status + ')' : '' });
        renderShare();
      });
      return;
    }
    publish();
  }

  // Checks the shared copy and opens it when it is newer than this browser's. Never fails the dashboard.
  function initShare() {
    if (!shareLib) return Promise.resolve();
    share = shareLib.create(api);
    return share.status().then(function (status) {
      shareState = status;
      if (status !== 'ready') return null;
      return share.peek().then(function (meta) {
        shareInfo = meta;
        // A newer complete result (or a newer sample shown here) wins over the shared copy.
        if (!meta || !meta.savedAt || running || (base && base.savedAt >= meta.savedAt) || (last && last.savedAt >= meta.savedAt)) return null;
        return share.load().then(function (snap) {
          if (!snap || running) return;
          applyCached(snap);
          packCache(snap).then(function (data) { store(cacheKey(), data); });
          render();
          els.freshness.textContent += ' ' + t('Abierto desde los datos compartidos por el equipo.');
        });
      });
    }).catch(function (err) {
      if (window.console) console.error('WhatsApp cost (shared data):', err && (err.status || err.message));
      if (shareState === 'unknown') shareState = 'unavailable';
    }).then(renderShare);
  }

  // Opening the dashboard with old data: read what is new since then (as "Ver costo" would).
  function maybeAutoRefresh() {
    var hours = autoRefreshHours();
    if (!hours || running || !base || !base.savedAt || Date.now() - base.savedAt < hours * 3600 * 1000) return;
    els.freshness.textContent = t('Los datos tienen más de {h}: actualizando…', { h: plural(hours, 'hora', 'horas') });
    if (els.form.requestSubmit) els.form.requestSubmit(); else els.form.dispatchEvent(new Event('submit', { cancelable: true }));
  }

  // Secondary figures that need no extra API calls.
  function renderStats(cur, costs, monthly) {
    els.statSent.textContent = fmt(cur.outbound);
    els.statSentSub.textContent = cur.inbound
      ? t('{n} recibidos de clientes (gratis).', { n: fmt(cur.inbound) })
      : t('Sin mensajes recibidos de clientes.');
    var bots = 0;
    cur.byAuthor.forEach(function (g) { if (isBot(g.key)) bots += g.outbound; });
    els.statBots.textContent = cur.outbound ? fmt(bots / cur.outbound * 100) + '%' : '—';
    var botOnly = costs.filter(function (t) { return t.attention === 'bot'; }).length;
    els.statBotsSub.textContent = cur.outbound
      ? t('{n} de bots o IA (también se cobran).', { n: plural(bots, 'mensaje', 'mensajes') }) +
        (costs.length ? ' ' + t('{pct}% de los tickets los resolvió solo la IA.', { pct: fmt(botOnly / costs.length * 100) }) : '')
      : t('Sin mensajes enviados.');
    // Profile phones are read at the end of a run, so partial results would show too few countries.
    var partial = last.result.status === 'partial';
    var detected = costs.filter(function (t) { return t.detected; }).length;
    els.statDetected.textContent = costs.length && !partial ? fmt(detected / costs.length * 100) + '%' : '—';
    els.statDetectedSub.textContent = partial ? t('Se calcula al terminar.')
      : costs.length ? t('de los tickets con país conocido.') + (detected < costs.length ? ' ' + t('El resto usa el país por defecto.') : '')
      : t('Sin tickets.');
    els.statYear.textContent = money(monthly * 12);
    els.statYearSub.textContent = t(monthly === 0 && cur.outbound ? 'Dentro de los mensajes gratis de Meta.' : 'Si sigue este ritmo.');
  }

  function renderMarkets(cur) {
    els.markets.replaceChildren();
    var groups = Array.from(cur.byMarket.values()).sort(function (a, b) { return b.cost - a.cost; });
    var max = groups.length ? groups[0].cost : 0;
    groups.forEach(function (g) {
      var share = cur.cost ? Math.round(g.cost / cur.cost * 100) : 0;
      barRow(els.markets, marketName(g.key), money(g.cost), max ? g.cost / max : 0,
        t('{pct}% del total', { pct: share }) + ' · ' + plural(g.tickets.size * weight(cur), 'ticket', 'tickets') + ' · ' + t('{rate} por mensaje', { rate: rate(rates.SERVICE_USD[g.key] || rates.SERVICE_USD.Other) }));
    });
    if (!groups.length) els.markets.appendChild(node('li', t('Sin mensajes enviados en el período.'), 'muted'));
  }

  function renderNumbers(cur) {
    els.numbersList.replaceChildren();
    var days = last.range.days;
    var groups = freeTierGroups(cur).map(function (g) {
      g.monthly = counter.monthlyCost([g], days, rates.FREE_SERVICE_PER_NUMBER_PER_MONTH);
      return g;
    }).sort(function (a, b) { return b.cost - a.cost; });
    var identified = groups.some(function (g) { return g.key; });
    var max = groups.length ? Math.max.apply(null, groups.map(function (g) { return g.monthly; })) : 0;
    groups.forEach(function (g) {
      var perMonth = g.outbound / days * 30;
      var free = rates.FREE_SERVICE_PER_NUMBER_PER_MONTH * g.numbers;
      var name = !g.key ? (identified ? t('Número sin identificar') : (g.numbers > 1 ? t('{n} números', { n: g.numbers }) : t('Tu número de WhatsApp')))
        : g.key.indexOf('wa:') === 0 ? t('Número de WhatsApp (integración …{id})', { id: g.key.slice(-6) }) : g.key;
      barRow(els.numbersList, name, money(g.monthly) + ' / ' + t('mes'), max ? g.monthly / max : 0,
        t('≈ {sent} enviados por mes, {free} gratis', { sent: fmt(perMonth), free: fmt(Math.min(perMonth, free)) }) + ' · ' + plural(g.tickets.size * weight(cur), 'ticket', 'tickets'));
    });
    els.numbersNote.textContent = identified
      ? t('Meta regala 1.000 mensajes por mes a cada número. Ya están restados.')
      : t('Zendesk no indica el número en los mensajes. Calculamos con {n} (cámbialo en Ajustes). Meta regala 1.000 mensajes por mes a cada uno.', { n: plural(settingNumbers(), 'número', 'números') });
    if (activeFilters().length) els.numbersNote.textContent += ' ' + t('Muestra todos los tickets: los filtros no se aplican aquí.');
    if (!groups.length) els.numbersList.appendChild(node('li', t('Sin mensajes enviados en el período.'), 'muted'));
  }

  function renderAuthors(cur) {
    els.authors.replaceChildren();
    var users = last.result.users;
    var groups = Array.from(cur.byAuthor.values()).sort(function (a, b) { return b.cost - a.cost; });
    var max = groups.length ? groups[0].cost : 0;
    groups.slice(0, TOP_AUTHORS).forEach(function (g) {
      var u = users.get(g.key);
      var share = cur.cost ? Math.round(g.cost / cur.cost * 100) : 0;
      var bot = isBot(g.key);
      barRow(els.authors, (u && u.name) || t('Bot o automatización'), money(g.cost), max ? g.cost / max : 0,
        t('{pct}% del total', { pct: share }) + ' · ' + t('{m} en {k}', { m: plural(g.outbound, 'mensaje', 'mensajes'), k: plural(g.tickets.size * weight(cur), 'ticket', 'tickets') }) +
          ' · ' + t('{x} por ticket', { x: money(g.cost / (g.tickets.size * weight(cur))) }),
        t(bot ? 'Bot' : 'Agente'));
    });
    if (groups.length > TOP_AUTHORS) els.authors.appendChild(node('li', t('Y {n}.', { n: plural(groups.length - TOP_AUTHORS, 'remitente más', 'remitentes más') }), 'muted small'));
    if (!groups.length) els.authors.appendChild(node('li', t('Sin mensajes enviados en el período.'), 'muted'));
  }

  function weeksOf(cur) {
    var r = last.range;
    return counter.weeks(r.start, r.end).map(function (wk) {
      var w = cur.byWeek.get(wk.start) || { outbound: 0, cost: 0 };
      return { start: wk.start, label: dayMonth(wk.start), value: w.cost, outbound: w.outbound, partial: wk.start < r.start || wk.end > r.end };
    });
  }

  function renderOutliers(costs, dist) {
    var outliers = costs.filter(function (t) { return t.cost > dist.threshold; }).sort(function (a, b) { return b.cost - a.cost; });
    els.outliers.replaceChildren();
    els.outlierCount.textContent = plural(outliers.length, 'ticket', 'tickets');
    els.outlierCount.hidden = !outliers.length;
    els.outlierNote.textContent = !isFinite(dist.threshold)
      ? t('Hacen falta más tickets para detectar casos fuera de lo normal.')
      : outliers.length
        ? t('Cuestan más de {x}. Conviene revisar por qué tienen tantos mensajes.', { x: money(dist.threshold) })
        : t('Ningún ticket se sale de lo normal.');

    outliers.slice(0, showAllOutliers ? OUTLIERS_LONG : OUTLIERS_SHORT).forEach(function (t) {
      var li = document.createElement('li');
      var link = node('button', 'Ticket #' + t.id, 'ticket-link');
      link.type = 'button';
      link.addEventListener('click', function () {
        if (!demo) { client.invoke('routeTo', 'ticket', t.id); return; }
        // Demo tickets do not exist in Zendesk: opening one would show a "ticket not found" page.
        els.demoNote.hidden = false;
        els.demoNote.textContent = i18n.t('Modo de prueba: el ticket #{id} es de ejemplo y no existe en Zendesk. Con datos reales, esto abre el ticket.', { id: t.id });
      });
      li.appendChild(link);
      var i = infoOf(t.id);
      li.appendChild(node('span', plural(t.outbound, 'mensaje enviado', 'mensajes enviados') + ' · ' + marketName(t.market) +
        (t.sessions > 1 ? ' · ' + plural(t.sessions, 'conversación', 'conversaciones') : '') +
        (i && i.form ? ' · ' + dimLabel('form', String(i.form)) : ''), 'ticket-desc'));
      var cost = node('span', null, 'ticket-cost');
      cost.appendChild(node('strong', money(t.cost)));
      if (dist.mean > 0) cost.appendChild(node('span', i18n.t('{x}× el promedio', { x: dec(t.cost / dist.mean, 1) }), 'times'));
      li.appendChild(cost);
      els.outliers.appendChild(li);
    });

    var more = Math.min(outliers.length, OUTLIERS_LONG) - OUTLIERS_SHORT;
    els.outliersMore.hidden = more <= 0;
    els.outliersMore.textContent = showAllOutliers ? t('Ver menos') : t('Ver {n} más', { n: more });
  }

  function renderSettingsNote(costs, defaultMarket, chosen) {
    var unknown = costs.filter(function (t) { return !t.detected; }).length;
    els.unknownNote.hidden = !unknown;
    els.unknownNote.lastElementChild.textContent = t(chosen
      ? 'No sabemos el país de {n} de {total}. Para esos usamos la tarifa de {market}.'
      : 'No sabemos el país de {n} de {total}. Para esos usamos el país de tu número de WhatsApp o, si no se conoce, {market}, el país más común.',
    { n: fmt(unknown), total: plural(costs.length, 'ticket', 'tickets'), market: marketName(defaultMarket) });
  }

  function positionTooltip(tip, container, x, y) {
    var svg = container.querySelector('svg');
    var scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
    var left = container.offsetLeft + x * scale;
    var maxLeft = container.offsetLeft + container.clientWidth - tip.offsetWidth;
    tip.style.left = Math.max(8, Math.min(left - tip.offsetWidth / 2, maxLeft)) + 'px';
    tip.style.top = (container.offsetTop + y * scale - 40) + 'px';
  }

  function drawCharts() {
    if (!view) return;
    if (!view.costs.length) {
      els.chart.replaceChildren(node('p', t('No hubo tickets de WhatsApp en este período.'), 'muted'));
    } else {
      chart.render(els.chart, view.costs.map(function (t) { return t.cost; }), view.dist, {
        money: moneyAxis,
        onHover: function (h) {
          if (!h) { els.tooltip.hidden = true; return; }
          els.tooltip.textContent = t('{n} entre {a} y {b}', { n: plural(h.bin.count, 'ticket', 'tickets'), a: moneyAxis(h.bin.from), b: moneyAxis(h.bin.to) }) +
            (h.outlier ? ' · ' + t('fuera de lo normal') : '');
          els.tooltip.hidden = false;
          positionTooltip(els.tooltip, els.chart, h.x, h.y);
        },
        label: t('Cantidad de tickets por costo. Promedio {x}.', { x: money(view.dist.mean) }) +
          (isFinite(view.dist.threshold) ? ' ' + t('Fuera de lo normal desde {x}.', { x: money(view.dist.threshold) }) : ''),
        texts: { tickets: t('tickets'), mean: t('Promedio {x}'), limit: t('Fuera de lo normal desde {x}') }
      });
    }
    chart.renderHeatmap(els.heatmap, view.heat.cost, {
      days: [0, 1, 2, 3, 4, 5, 6].map(function (i) { return weekday(i, 'short'); }),
      label: t('Costo por día de la semana y hora'),
      onHover: function (h) {
        if (!h) { els.heatmapTooltip.hidden = true; return; }
        els.heatmapTooltip.textContent = t('{day} de {from} a {to} h: {x}', { day: weekday(h.day, 'long'), from: h.hour, to: h.hour + 1, x: money(h.value) }) + ' · ' +
          plural(view.heat.sent[h.day][h.hour], 'mensaje', 'mensajes');
        els.heatmapTooltip.hidden = false;
        positionTooltip(els.heatmapTooltip, els.heatmap, h.x, h.y);
      }
    });
    chart.renderWeekly(els.weekly, view.weeks, {
      money: moneyAxis,
      label: t('Costo por semana') + ': ' + view.weeks.map(function (w) { return w.label + ' ' + money(w.value); }).join(', '),
      onHover: function (h) {
        if (!h) { els.weeklyTooltip.hidden = true; return; }
        els.weeklyTooltip.textContent = t('Semana del {date}', { date: h.week.label }) + ': ' + money(h.week.value) + ' · ' +
          plural(h.week.outbound, 'mensaje', 'mensajes') + (h.week.partial ? ' ' + t('(semana incompleta)') : '');
        els.weeklyTooltip.hidden = false;
        positionTooltip(els.weeklyTooltip, els.weekly, h.x, h.y);
      }
    });
  }

  function render() {
    if (!last) return;
    var chosen = rates.findMarket(els.defaultMarket.value);
    var defaultMarket = chosen || memoized('common', function () {
      return counter.commonMarket(last.result, rates.marketForPhone, last.range.start, last.range.end);
    }) || 'Other';
    // Calendar months need both periods: only for complete results.
    var full = analyze(defaultMarket, !chosen, null, last.result.status !== 'partial');
    attentionOf = new Map();
    [full.previous, full.current].forEach(function (sum) { if (sum) sum.tickets.forEach(function (t) { attentionOf.set(t.id, t.attention); }); });
    var filter = ticketFilter();
    var shown = filter ? analyze(defaultMarket, !chosen, filter, false, filterKeyOf()) : full;
    var cur = shown.current;
    var costs = Array.from(cur.tickets.values());
    var dist = counter.distribution(costs.map(function (t) { return t.cost; }));
    view = { costs: costs, dist: dist, weeks: weeksOf(cur), heat: heatOf(cur) };

    // Meta's free messages are per business number: with filters, the monthly cost is the filtered
    // tickets' share of the total, not a free tier of their own.
    var days = last.range.days;
    var fullMonthly = counter.monthlyCost(freeTierGroups(full.current), days, FREE);
    var fullPrevMonthly = full.previous ? counter.monthlyCost(freeTierGroups(full.previous), days, FREE) : 0;
    var part = function (s, total) { return total && total.cost ? s.cost / total.cost : 0; };
    var monthly = filter ? fullMonthly * part(cur, full.current) : fullMonthly;
    var prevMonthly = !full.previous ? null : filter ? fullPrevMonthly * part(shown.previous, full.previous) : fullPrevMonthly;

    renderFilters(full.current);
    els.filterNote.hidden = !filter;
    if (filter) {
      els.filterNote.textContent = t('Mostrando {n} de {total} ({filters}). Costo por mes de todo WhatsApp: {x}.',
        { n: fmt(costs.length * weight(cur)), total: plural(full.current.tickets.size * weight(full.current), 'ticket', 'tickets'), filters: filterText(), x: money(fullMonthly) });
    }
    renderSummary(cur, shown.previous, costs, dist, monthly, prevMonthly, !!filter);
    renderMarkets(cur);
    renderNumbers(full.current);
    renderAuthors(cur);
    renderOutliers(costs, dist);
    // Breaking down by a filtered dimension shows all its rows (the others filters still apply), the chosen one highlighted.
    var byOwn = filters[dimension] ? ticketFilter(dimension) : null;
    var src = !filters[dimension] ? shown : byOwn ? analyze(defaultMarket, !chosen, byOwn, false, filterKeyOf(dimension)) : full;
    renderBreakdown(src.current, src.previous);
    renderBilling(full.months);
    renderBudget(fullMonthly);
    renderSettingsNote(costs, defaultMarket, !!chosen);
    effectiveMarket = defaultMarket;
    if (!chosen) store(commonMarketKey(), defaultMarket);
    renderSaveMarket();
    renderFreshness();
    renderSample(full.current);
    if (share) renderShare();
    renderDiagnostic(cur);
    completeNames();
    els.empty.hidden = true;
    els.dashboard.hidden = false;
    drawCharts();
  }

  // Browser storage can be full or blocked; the dashboard works without it.
  function store(key, value) {
    try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, value); return true; } catch (e) { return false; }
  }
  function recall(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function savedMarket() { return rates.findMarket(meta && meta.settings && meta.settings.default_market); }

  // Settings edited here that differ from the installation's: the country in use, the channels (only when
  // edited here: a cached value must not overwrite what another admin saved since), budget, Meta invoices
  // and auto refresh.
  function pendingSettings() {
    var s = (meta && meta.settings) || {};
    var patch = {};
    // The country in use is offered for saving only when chosen here, not because the most common one changed.
    if (marketDirty && effectiveMarket && effectiveMarket !== savedMarket()) patch.default_market = effectiveMarket;
    var channels = counter.parseChannels(els.channels.value).join(', ');
    if (channelsDirty && channels !== savedChannels()) patch.whatsapp_channels = channels;
    if (budgetValue() !== (parseFloat(s.monthly_budget) || 0)) patch.monthly_budget = budgetValue();
    var bill = counter.formatBilling(billing);
    if (bill !== counter.formatBilling(counter.parseBilling(s.meta_billing))) patch.meta_billing = bill;
    if (autoRefreshHours() !== (parseInt(s.auto_refresh_hours, 10) || 0)) patch.auto_refresh_hours = autoRefreshHours();
    return patch;
  }

  // Offers to save the settings in use as the app's defaults, so every admin and every agent's ticket panel uses them too.
  function renderSaveMarket() {
    var show = !!(meta && meta.installationId && Object.keys(pendingSettings()).length);
    els.saveMarket.hidden = !show;
    if (show) els.saveMarket.textContent = t('Guardar ajustes para todo el equipo');
  }

  // Updates the installation settings that changed here. Reads the current settings first and sends them all
  // back, since the API docs don't say whether a partial settings object is merged or replaces the rest.
  function saveDefaultMarket() {
    var patch = pendingSettings();
    var url = '/api/v2/apps/installations/' + meta.installationId + '.json';
    els.saveMarket.disabled = true;
    els.saveMarketNote.textContent = t('Guardando…');
    api({ url: url, type: 'GET' }).then(function (res) {
      var inst = (res && res.installation) || res || {};
      var settings = Object.assign({}, inst.settings || {}, patch);
      return api({ url: url, type: 'PUT', contentType: 'application/json', data: JSON.stringify({ settings: settings }) });
    }).then(function () {
      meta.settings = Object.assign({}, meta.settings, patch);
      channelsDirty = false;
      marketDirty = false;
      if (patch.default_market) els.defaultMarket.value = patch.default_market;
      var said = [];
      if (patch.default_market) said.push(t('el panel de los tickets usará {market}', { market: marketName(patch.default_market) }));
      if (patch.whatsapp_channels != null) said.push(t('cuenta como WhatsApp: {list}', { list: patch.whatsapp_channels || t('solo lo detectado') }));
      if (patch.monthly_budget != null) said.push(patch.monthly_budget ? t('presupuesto de {x} por mes', { x: money(patch.monthly_budget) }) : t('sin presupuesto'));
      if (patch.meta_billing != null) said.push(t('facturas de Meta guardadas'));
      if (patch.auto_refresh_hours != null) said.push(patch.auto_refresh_hours ? t('se actualiza al abrir si pasaron {h}', { h: plural(patch.auto_refresh_hours, 'hora', 'horas') }) : t('sin actualización automática'));
      els.saveMarketNote.textContent = t('Guardado: {list}.', { list: said.join('; ') });
      render();
    }).catch(function (err) {
      els.saveMarketNote.textContent = err && err.status === 403
        ? t('Solo un administrador puede guardar los ajustes.')
        : t('No pudimos guardar los ajustes. Intenta de nuevo.');
    }).then(function () { els.saveMarket.disabled = false; });
  }

  // Browser storage holds about 5 MB: the cache is gzipped (about a quarter of the size), so large accounts keep it.
  function packCache(snap) {
    var text = JSON.stringify(snap);
    return shareLib ? shareLib.compress(text) : Promise.resolve(text);
  }

  function readCache(raw) {
    if (!raw) return Promise.resolve(null);
    if (raw.charAt(0) === '{') return Promise.resolve(JSON.parse(raw)); // 0.15 and earlier: plain JSON
    return shareLib.decompress(raw).then(JSON.parse);
  }

  // A sample lives in its own key: the last complete result (what update runs build on) is kept beside it.
  function sampleKey() { return cacheKey() + ':sample'; }
  function saveCache() {
    if (!last || last.result.status !== 'done') return;
    var sampled = !!last.result.sample;
    var key = sampled ? sampleKey() : cacheKey();
    if (!sampled) store(sampleKey(), null);
    // The inputs of the run, not what is selected now (see snapshot): the user may have clicked another period meanwhile.
    packCache(snapshot()).then(function (data) {
      // Too big for browser storage: drop any older copy so it isn't shown as current.
      if (!store(key, data)) store(key, null);
    }).catch(function () { store(key, null); });
    // The ticket panel compares with complete calculations only.
    var bench = sampled ? null : currentBenchmarks();
    if (bench) store(BENCHMARKS_KEY + (demo ? DEMO_SUFFIX : ''), JSON.stringify(bench));
  }

  // A saved calculation (this browser's cache or the shared copy) becomes the current one.
  function applyCached(c) {
    if (c.period === 'custom') { els.from.value = c.from; els.to.value = c.to; }
    selectPeriod(c.period);
    els.channels.value = c.channels || '';
    last = { result: counter.unpackResult(c.result), range: c.range, channels: c.channels || '', savedAt: c.savedAt,
      inputs: { period: c.period, from: c.from, to: c.to } };
    // A sample is shown, but never extended by an update run.
    if (!last.result.sample) base = last;
  }

  function loadCache() {
    var key = cacheKey();
    return readCache(recall(key)).then(function (c) {
      if (c && c.result && c.range) applyCached(c);
    }).catch(function () { store(key, null); }).then(function () {
      // A sample newer than the last complete result is shown; the complete one stays the base.
      return readCache(recall(sampleKey())).then(function (c) {
        if (!c || !c.result || !c.range || (base && base.savedAt >= c.savedAt)) return;
        var keep = base;
        applyCached(c);
        base = keep;
      }).catch(function () { store(sampleKey(), null); });
    });
  }

  // With no WhatsApp messages found, lists the channels the public comments did come from, so a
  // mismatch between real data and the WhatsApp detection is visible instead of a silent zero.
  function renderDiagnostic(cur) {
    var r = last.result;
    var missing = r.logMissing || 0;
    // Partial results come oldest first, so the current period can still be empty while it loads.
    var empty = !cur.tickets.size && r.status !== 'partial';
    var show = empty || missing > 0;
    els.diagnostic.hidden = !show;
    els.diagnosticList.replaceChildren();
    if (!show) return;
    var missingText = missing
      ? t('Zendesk no encontró el historial de conversación de {n} (pasa con tickets archivados o borrados). Para esos usamos sus comentarios públicos, que pueden no incluir los mensajes.',
        { n: plural(missing, 'ticket de WhatsApp', 'tickets de WhatsApp') })
      : '';
    if (!empty) { els.diagnosticText.textContent = missingText; return; }
    var top = Object.keys(r.channels || {}).map(function (k) { return [k, r.channels[k]]; })
      .sort(function (a, b) { return b[1] - a[1]; }).slice(0, 10);
    els.diagnosticText.textContent = r.scanned
      ? t('Revisamos {n} (este período y el anterior) y ninguno se reconoce como WhatsApp. Canales de esos tickets (canal / origen):', { n: plural(r.scanned, 'ticket actualizado', 'tickets actualizados') })
      : t('Zendesk no devolvió tickets actualizados en este período ni en el anterior.');
    // WhatsApp tickets were found but their logs could not be read: the channel list would mislead.
    if (missingText) { els.diagnosticText.textContent = missingText; return; }
    var listed = counter.parseChannels(els.channels.value);
    top.forEach(function (e) {
      var li = node('li', e[0] + ': ' + fmt(e[1]) + ' ');
      if (listed.indexOf(e[0].toLowerCase()) < 0) {
        var b = node('button', t('Contar como WhatsApp'), 'btn ghost small-btn');
        b.type = 'button';
        b.addEventListener('click', function () { addChannel(e[0]); });
        li.appendChild(b);
      } else {
        li.appendChild(node('span', t('agregado: haz clic en "Ver costo"'), 'pill'));
      }
      els.diagnosticList.appendChild(li);
    });
  }

  function addChannel(label) {
    var list = counter.parseChannels(els.channels.value);
    if (list.indexOf(label.toLowerCase()) < 0) els.channels.value = list.concat([label]).join(', ');
    channelsDirty = true;
    render();
  }

  function savedChannels() { return counter.parseChannels(meta && meta.settings && meta.settings.whatsapp_channels).join(', '); }

  function renderFreshness() {
    if (last && last.result.status === 'partial') {
      els.freshness.hidden = false;
      els.freshness.textContent = last.result.currentComplete
        ? t('El período elegido ya está completo. Falta el período anterior: las comparaciones aparecen al terminar.')
        : t('Resultados parciales: se completan mientras termina de cargar.');
      return;
    }
    var at = last && last.savedAt;
    els.freshness.hidden = !at;
    if (!at) return;
    els.freshness.textContent = last.result.sample ? t('Estimación con muestra del {when}.', { when: whenText(at) })
      : t('Datos calculados el {when}. Haz clic en "Ver costo" para actualizarlos.', { when: whenText(at) });
    // Zendesk refused the ticket export (closed to third-party apps from December 2026): the tickets came from the ticket list.
    if (last.result.source === 'list') els.freshness.textContent += ' ' + t('Tickets leídos con la lista de tickets de Zendesk: los tickets archivados no se incluyen.');
  }

  function exportCsv() {
    if (!view) return;
    // Spreadsheets in Spanish and Portuguese use a decimal comma and ";" between columns; in English, "." and ",".
    var num = function (n, d) { return n.toLocaleString(i18n.locale(), { useGrouping: false, maximumFractionDigits: d }); };
    var sep = i18n.locale() === 'en' ? ',' : ';';
    var fields = Object.keys((last.result.names && last.result.names.fields) || {});
    var stamp = function (unix) {
      if (!unix) return '';
      var d = new Date(unix * 1000);
      return isoDate(d) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    };
    var label = function (dim, t) {
      var k = dimKey(dim, t);
      return Array.isArray(k) ? k.join(', ') : k === NONE ? '' : dimLabel(dim, k);
    };
    var rows = view.costs.slice().sort(function (a, b) { return b.cost - a.cost; }).map(function (t) {
      return [t.id, marketName(t.market), i18n.t(t.detected ? 'sí' : 'no (supuesto)'), t.number || '', t.outbound, t.inbound, num(t.rate, 4), num(t.cost, 4),
        label('form', t), label('brand', t), label('group', t), label('assignee', t), label('org', t), label('status', t), label('tag', t),
        ATTENTION[t.attention] ? i18n.t(ATTENTION[t.attention]) : '', t.sessions, stamp(t.first), stamp(t.last)
      ].concat(fields.map(function (f) { return label('field:' + f, t); }));
    });
    var header = ['Ticket', 'País', 'País detectado', 'Número de WhatsApp', 'Enviados', 'Recibidos', 'Tarifa (USD)', 'Costo (USD)',
      'Formulario', 'Marca', 'Grupo', 'Agente asignado', 'Organización', 'Estado', 'Etiquetas', 'Atendido por', 'Conversaciones',
      'Primer mensaje', 'Último mensaje'].map(function (h) { return t(h); }).concat(fields.map(function (f) { return last.result.names.fields[f].title; }));
    var csv = counter.toCsv(header, rows, sep);
    var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = t('costo-whatsapp') + '-' + isoDate(new Date()) + (activeFilters().length ? '-' + t('filtrado') : '') + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function friendlyError(err) {
    var code = err && err.status;
    if (err && err.code === 'log_unavailable') {
      return t('Zendesk no devuelve el historial de conversaciones en esta cuenta (error 404 en {path}). Sin eso no podemos leer los mensajes de WhatsApp. Avísale a Zenital.', { path: err.path });
    }
    if (code === 403) return t('Solo un administrador de Zendesk puede ver este reporte.');
    if (code === 429) return t('Zendesk pidió una pausa. Intenta de nuevo en un minuto.');
    if (code === 422 || code === 400) return t('Ese período no es válido. Prueba con otras fechas.');
    // Technical detail for whoever reports the problem.
    var detail = code ? ' (error ' + code + (err.path ? ' — ' + err.path : '') + ')' : '';
    return t('No pudimos calcular el costo. Intenta de nuevo en unos minutos.') + detail;
  }

  // Overall pct: 0-40 finding tickets, 40-100 reading conversations (as reported by countMessages).
  function setProgress(pct) {
    var step = pct < 40 ? 0 : 1;
    els.progressBars[0].style.width = Math.min(100, pct / 40 * 100) + '%';
    els.progressBars[1].style.width = Math.max(0, (pct - 40) / 60 * 100) + '%';
    els.steps.forEach(function (s, i) { s.className = 'step' + (i < step ? ' done' : i === step ? ' active' : ''); });
    els.loadingPct.textContent = pct + '%';
    els.progress.setAttribute('aria-valuenow', String(pct));
  }

  // Rough time left while reading conversations, from the pace so far.
  var pace = null;
  function eta(p) {
    if (p.step !== 'messages' || !p.tickets) { pace = null; return ''; }
    var now = Date.now();
    if (!pace) pace = { at: now, done: p.done };
    var done = p.done - pace.done;
    var secs = now - pace.at > 4000 && done > 0 ? (p.toRead - p.done) * (now - pace.at) / done / 1000 : null;
    if (secs == null) return '';
    if (secs < 60) return t('Falta menos de un minuto');
    var mins = Math.ceil(secs / 60);
    return t('Faltan unos {n} min', { n: mins });
  }

  function setRunning(on) {
    running = on;
    els.run.disabled = on;
    els.stop.hidden = !on;
    els.loading.hidden = !on;
    if (on) els.empty.hidden = true;
    else if (!last) els.empty.hidden = false; // a first run that failed: back to the start screen, not a blank page
  }

  function selectPeriod(value) {
    period = value;
    segs.forEach(function (s) { s.setAttribute('aria-pressed', String(s.dataset.days === value)); });
    els.customRange.hidden = value !== 'custom';
  }

  // { start, end, prevStart, days, label } in unix seconds, or { error } when the custom range is invalid.
  function readRange() {
    // The API only serves data older than one minute.
    var r = counter.buildRange(period, els.from.value, els.to.value, Math.floor(Date.now() / 1000) - 120);
    if (r.error) return r;
    return r;
  }

  // Shown in the headline, in the current language (a range is saved without its label).
  function rangeLabel(r) {
    return r.from ? t('Entre el {from} y el {to}', { from: shortDate(r.from), to: shortDate(r.to) }) : t('En los últimos {n} días', { n: fmt(r.days) });
  }

  // A preset period that the last calculation already holds is shown at once (no API calls); any other one
  // waits for "Ver costo", and the freshness line says so.
  function periodChosen(label) {
    clearPlan();
    if (!last || running || period === 'custom') return;
    var range = readRange();
    if (range.error) return;
    if (counter.planRun(base, range, els.channels.value, PERIOD_SWITCH_TOLERANCE).mode === 'cached') {
      last = { result: base.result, range: range, channels: els.channels.value, savedAt: base.savedAt,
        inputs: { period: period, from: els.from.value, to: els.to.value } };
      els.error.hidden = true;
      render();
      return;
    }
    els.freshness.hidden = false;
    els.freshness.textContent = t('Elegiste {period}: haz clic en "Ver costo" para calcularlo.', { period: label });
  }
  segs.forEach(function (s) { s.addEventListener('click', function () { selectPeriod(s.dataset.days); periodChosen(s.textContent.trim()); }); });
  // Texts that depend on the language and are not redrawn by render().
  function renderFixedTexts() {
    i18n.translatePage(document.body);
    var keep = els.defaultMarket.value;
    while (els.defaultMarket.options.length > 1) els.defaultMarket.remove(1);
    rates.markets().forEach(function (m) {
      els.defaultMarket.appendChild(new Option(t('{market} ({rate} por mensaje)', { market: marketName(m), rate: rate(rates.SERVICE_USD[m]) }), m));
    });
    els.defaultMarket.value = keep;
    els.ratesDate.textContent = t('vigentes desde el {date}', { date: new Date(2026, 9, 1).toLocaleDateString(i18n.locale(), { day: 'numeric', month: 'long', year: 'numeric' }) });
    els.lang.value = i18n.chosen();
  }
  els.lang.addEventListener('change', function () {
    i18n.choose(els.lang.value);
    i18n.set(els.lang.value || i18n.fromLocale(profileLocale));
    renderFixedTexts();
    if (last) render();
    if (share) renderShare();
    demoNames();
  });
  // The demo account names its forms, groups and brands in the interface language: ask again in the current one.
  function demoNames() {
    if (!demo || !last || !last.result.info) return;
    var r = last.result;
    counter.fetchNames(api, r.info, null).then(function (names) {
      if (!last || last.result !== r) return;
      r.names = names;
      render();
      // The ticket panel's averages carry the names too.
      if (r.status === 'done') saveCache();
    }, function () {});
  }
  els.defaultMarket.addEventListener('change', function () { marketDirty = true; render(); });
  els.numbers.addEventListener('input', render);
  els.channels.addEventListener('input', function () { channelsDirty = true; clearPlan(); if (last) renderSaveMarket(); });
  [els.from, els.to].forEach(function (input) { input.addEventListener('input', clearPlan); });
  els.channels.addEventListener('change', render);
  els.exportBtn.addEventListener('click', exportCsv);
  els.budget.addEventListener('input', function () { if (last) render(); else renderSaveMarket(); });
  els.autoRefresh.addEventListener('input', renderSaveMarket);
  els.dimension.addEventListener('change', function () {
    dimension = els.dimension.value;
    showAllBreakdown = false;
    store(DIMENSION_KEY, dimension);
    render();
  });
  els.breakdownMore.addEventListener('click', function () { showAllBreakdown = !showAllBreakdown; render(); });
  Array.prototype.forEach.call(els.filters.querySelectorAll('.filter select'), function (select) {
    select.addEventListener('change', function () {
      var dim = select.parentNode.dataset.dim;
      if (select.value) filters[dim] = select.value; else delete filters[dim];
      store(filtersKey(), JSON.stringify(filters));
      render();
    });
  });
  els.clearFilters.addEventListener('click', function () { filters = {}; store(filtersKey(), null); render(); });
  els.shareBtn.addEventListener('click', onShareClick);
  els.outliersMore.addEventListener('click', function () {
    showAllOutliers = !showAllOutliers;
    if (view) renderOutliers(view.costs, view.dist);
  });
  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(drawCharts, 150);
  });
  // Defaults an admin set once in the app's installation settings.
  els.saveMarket.addEventListener('click', saveDefaultMarket);
  // Settings first: demo mode decides which API and which cache the rest of the dashboard uses.
  function init(md) {
    meta = md || null;
    var s = (meta && meta.settings) || {};
    demo = demoMode.isOn(s);
    if (demo) {
      // Settings saved from the dashboard in demo mode live in this browser, never in the installation.
      s = Object.assign({}, s, demoMode.storedSettings());
      meta.settings = s;
      demoApi = demoMode.createApi({
        settings: s, installationId: meta.installationId, onSettings: demoMode.saveSettings
      });
      els.demoBadge.hidden = false;
    }
    var today = new Date();
    els.to.value = isoDate(today);
    els.from.value = isoDate(new Date(today.getTime() - 30 * DAY * 1000));
    // Show the last calculation right away.
    store(OLD_CACHE_KEY, null);
    loadCache().then(function () { initRest(s); });
  }

  function initRest(s) {
    var market = rates.findMarket(s.default_market);
    if (market) els.defaultMarket.value = market;
    var n = parseInt(s.business_numbers, 10);
    if (n > 0) els.numbers.value = n;
    if (parseFloat(s.monthly_budget) > 0) els.budget.value = parseFloat(s.monthly_budget);
    if (parseInt(s.auto_refresh_hours, 10) > 0) els.autoRefresh.value = parseInt(s.auto_refresh_hours, 10);
    billing = counter.parseBilling(s.meta_billing);
    try { filters = JSON.parse(recall(filtersKey())) || {}; } catch (e) { filters = {}; }
    dimension = recall(DIMENSION_KEY) || 'form';
    // A cached run keeps the channels it used; otherwise start from the saved ones.
    if (!(last && last.channels != null)) els.channels.value = savedChannels();
    render();
    demoNames();
    els.run.disabled = false;
    // The shared copy may be newer than this browser's; then old data refreshes itself if an admin asked for it.
    initShare().then(maybeAutoRefresh);
  }
  // Nothing can run before the settings are known: with demo mode on, a click would reach the real account.
  els.run.disabled = true;
  // Language first (it labels everything), then settings.
  client.get('currentUser.locale').then(function (d) { profileLocale = d && d['currentUser.locale']; }, function () {}).then(function () {
    i18n.set(i18n.chosen() || i18n.fromLocale(profileLocale || navigator.language));
    renderFixedTexts();
    return client.metadata().then(init, function () { init(null); });
  }).catch(function (err) {
    if (window.console) console.error('WhatsApp cost:', err && err.message);
    els.error.textContent = t('No pudimos iniciar el dashboard. Recarga la página.');
    els.error.hidden = false;
  });

  // --- Help ---------------------------------------------------------------------------------------

  // What the support team needs to look into a problem; nothing about the account's customers or tickets.
  function techDetails() {
    var r = last && last.result;
    var lines = [
      'App: WhatsApp Cost ' + ((meta && meta.version) || ''),
      'Zendesk: ' + (account || '?'),
      'Language: ' + i18n.locale() + (demo ? ' · demo mode' : ''),
      'Last calculation: ' + (r ? r.status + (last.savedAt ? ' · ' + new Date(last.savedAt).toISOString() : '') + ' · ' + (r.source || 'export') +
        ' · ' + Object.keys(r.info || {}).length + ' WhatsApp tickets' : 'none'),
      'Shared results: ' + shareState,
      'Browser: ' + navigator.userAgent
    ];
    return lines.join('\n');
  }

  function helpText() {
    return els.helpMessage.value.trim() + (els.helpTech.checked ? '\n\n---\n' + techDetails() : '');
  }

  function openHelp() {
    els.helpForm.hidden = false;
    els.helpOpen.hidden = true;
    els.helpStatus.textContent = '';
    (els.helpName.value ? els.helpMessage : els.helpName).focus();
  }

  function sendHelp(e) {
    e.preventDefault();
    var missing = [els.helpName, els.helpEmail, els.helpMessage].filter(function (f) {
      var bad = !f.value.trim() || (f === els.helpEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.value.trim()));
      f.setAttribute('aria-invalid', String(bad));
      return bad;
    });
    if (missing.length) { els.helpStatus.textContent = t('Completa tu nombre, un correo válido y el mensaje.'); missing[0].focus(); return; }
    var subject = '[WhatsApp Cost] ' + t('Pedido de ayuda') + (account ? ' — ' + account : '');
    if (!SUPPORT.zendesk) {
      // No automatic channel: the agent's mail app opens with everything filled in.
      var link = document.createElement('a');
      link.href = 'mailto:' + SUPPORT.email + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(helpText());
      link.target = '_blank';
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
      els.helpStatus.textContent = t('Se abrió tu programa de correo con el mensaje listo. Si no se abrió, escríbenos a {email}.', { email: SUPPORT.email });
      return;
    }
    els.helpSend.disabled = true;
    els.helpStatus.textContent = t('Enviando…');
    // A request in Zenital's Zendesk: Zendesk confirms it to the sender and emails the team.
    client.request({
      url: 'https://' + SUPPORT.zendesk + '.zendesk.com/api/v2/requests.json', type: 'POST', contentType: 'application/json',
      data: JSON.stringify({ request: {
        requester: { name: els.helpName.value.trim(), email: els.helpEmail.value.trim() },
        subject: subject, comment: { body: helpText() }
      } })
    }).then(function () {
      els.helpMessage.value = '';
      els.helpStatus.textContent = t('Listo: te vamos a responder a {email}.', { email: els.helpEmail.value.trim() });
    }, function () {
      els.helpStatus.textContent = t('No pudimos enviarlo. Escríbenos a {email}.', { email: SUPPORT.email });
    }).then(function () { els.helpSend.disabled = false; });
  }

  els.helpOpen.addEventListener('click', openHelp);
  els.helpCancel.addEventListener('click', function () { els.helpForm.hidden = true; els.helpOpen.hidden = false; els.helpOpen.focus(); });
  els.helpForm.addEventListener('submit', sendHelp);
  // The person's name and email, so they only write the message.
  client.get(['currentUser.name', 'currentUser.email']).then(function (d) {
    if (d && d['currentUser.name'] && !els.helpName.value) els.helpName.value = d['currentUser.name'];
    if (d && d['currentUser.email'] && !els.helpEmail.value) els.helpEmail.value = d['currentUser.email'];
  }, function () {});
  var account = null; // the Zendesk subdomain, for the support team
  if (client.context) client.context().then(function (c) { account = c && c.account && c.account.subdomain; }, function () {});

  // Leaving the app stops a run in progress instead of letting it keep calling the API.
  client.on('app.willDestroy', function () { stopRequested = true; clearTimeout(resizeTimer); });

  els.stop.addEventListener('click', function () {
    stopRequested = true;
    els.loadingTitle.textContent = t('Cancelando…');
  });

  els.form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (running || counting) return;
    var range = readRange();
    els.error.hidden = true;
    els.demoNote.hidden = true;
    clearPlan();
    if (range.error) {
      els.error.textContent = t(RANGE_ERRORS[range.error]);
      els.error.hidden = false;
      return;
    }

    var channelsUsed = els.channels.value;
    var inputs = { period: period, from: els.from.value, to: els.to.value };
    // The last complete result may already hold the range (no reading at all), or most of it.
    var plan = counter.planRun(base, range, channelsUsed);
    if (plan.mode === 'cached') {
      last = { result: base.result, range: range, channels: channelsUsed, savedAt: base.savedAt, inputs: inputs };
      render();
      els.freshness.textContent += ' ' + t('Este período ya estaba en el último cálculo: no hizo falta leer nada.');
      return;
    }
    var run = { range: range, inputs: inputs, plan: plan, channels: channelsUsed };
    if (plan.mode !== 'full') { startRun(run, 0); return; }
    // A full read: count the tickets first (one request) and offer a sample when reading them all takes long.
    counting = true;
    els.run.disabled = true;
    if (last) render();
    counter.countTickets(api, range.prevStart).then(function (n) {
      counting = false;
      els.run.disabled = running;
      if (last) render();
      if (running) return;
      if (n == null || counter.readMinutes(n) < SAMPLE_OFFER_MINUTES) { startRun(run, 0); return; }
      run.count = n;
      showPlan(run);
    });
  });

  // --- Sample or every ticket -------------------------------------------------------------------

  function sizeText(n, total, minutes) {
    return t('{n} tickets ({pct}% del total) · unos {time}', { n: fmt(n), pct: fmt(Math.max(1, n / total * 100)), time: duration(minutes) });
  }

  function clearPlan() {
    pending = null;
    els.plan.hidden = true;
  }

  function showPlan(run) {
    pending = run;
    var n = run.count;
    els.planText.textContent = t('Hay unos {n} tickets de WhatsApp entre este período y el anterior. Leer todas sus conversaciones tarda unos {time}, por el límite de Zendesk. Con una muestra al azar tienes una estimación antes y la puedes ampliar después.', { n: fmt(n), time: duration(counter.readMinutes(n)) }) +
      (counter.parseChannels(run.channels).length ? ' ' + t('Este conteo no incluye las integraciones de la lista de canales.') : '');
    els.planSize.max = String(n);
    els.planSize.value = String(Math.min(n, SAMPLE_DEFAULT));
    els.planFull.textContent = t('Calcular todo ({time})', { time: duration(counter.readMinutes(n)) });
    renderPlanSize();
    els.plan.hidden = false;
    els.empty.hidden = true;
    els.planSample.focus();
  }

  function renderPlanSize() {
    if (!pending) return;
    var n = Number(els.planSize.value);
    els.planSizeText.textContent = sizeText(n, pending.count, counter.readMinutes(n));
  }

  els.planSize.addEventListener('input', renderPlanSize);
  els.planSample.addEventListener('click', function () { var run = pending; if (run) startRun(run, Number(els.planSize.value)); });
  els.planFull.addEventListener('click', function () { var run = pending; if (run) startRun(run, 0); });
  els.planCancel.addEventListener('click', function () {
    pending = null;
    els.plan.hidden = true;
    if (!last) els.empty.hidden = false;
    els.run.focus();
  });

  // The sample card: how much was read, the margin and how to read more.
  var sampleEst = null; // the current period's sample figures, for the slider
  function renderSample(cur) {
    var r = last.result;
    var est = cur && cur.sample;
    sampleEst = est || null;
    els.sample.hidden = !r.sample || !est;
    if (els.sample.hidden) return;
    var left = r.sample.rows.length - r.sample.read;
    els.sampleText.textContent = t('Leímos {n} de {total} tickets del período ({pct}%), elegidos al azar. Los totales, el desglose y los gráficos semanales se proyectan a todos los tickets; con un 95% de confianza el costo real está dentro del margen.', { n: fmt(est.n), total: fmt(est.N), pct: fmt(est.N ? est.n / est.N * 100 : 0) });
    els.sampleMargin.textContent = est.margin == null ? '—' : '± ' + money(monthlyMargin(cur)) + ' ' + t('por mes');
    if (est.margin == null) els.sampleText.textContent += ' ' + t('Se leyeron muy pocos tickets de este período para calcular el margen: extiende la muestra.');
    var max = Math.max(50, left);
    els.sampleSize.max = String(max);
    if (!els.sampleSize.dataset.touched || Number(els.sampleSize.value) > max) els.sampleSize.value = String(Math.min(left, Math.max(50, r.sample.read)));
    els.sampleAll.textContent = t('Calcular todo ({time})', { time: duration(counter.readMinutes(left)) });
    var busy = running || counting || r.status === 'partial';
    els.sampleExtend.disabled = busy;
    els.sampleAll.disabled = busy;
    els.sampleSize.disabled = busy;
    renderSampleSize();
  }

  function renderSampleSize() {
    var r = last && last.result;
    var est = sampleEst;
    if (!r || !r.sample || !est) return;
    var add = Math.min(Number(els.sampleSize.value), r.sample.rows.length - r.sample.read);
    // The period's share of the new tickets is about the same as in the sample so far.
    var nextN = est.n * (r.sample.read + add) / r.sample.read;
    els.sampleSizeText.textContent = t('+{n} tickets · unos {time} · margen esperado ± {x} por mes', {
      n: fmt(add), time: duration(counter.readMinutes(add)), x: money(counter.projectMargin(est, nextN) / last.range.days * 30) });
  }

  els.sampleSize.addEventListener('input', function () {
    els.sampleSize.dataset.touched = '1';
    renderSampleSize();
  });
  els.sampleExtend.addEventListener('click', function () { extendRun(Number(els.sampleSize.value)); });
  els.sampleAll.addEventListener('click', function () { if (last && last.result.sample) extendRun(last.result.sample.rows.length); });

  // --- Running ----------------------------------------------------------------------------------

  var currentReady = false;
  function onRunProgress(p) {
    var pct = Math.max(0, Math.min(99, Math.round(p.pct)));
    setProgress(pct);
    els.loadingEta.textContent = eta(p);
    if (p.step === 'tickets') {
      els.loadingTitle.textContent = t('Buscando tickets de WhatsApp…');
      els.stepMeta[0].textContent = t('{found} de {seen}', { found: plural(p.tickets, 'ticket de WhatsApp encontrado', 'tickets de WhatsApp encontrados'),
        seen: plural(p.scanned, 'revisado', 'revisados') });
    } else {
      els.loadingTitle.textContent = t(currentReady ? 'Leyendo el período anterior para comparar…' : 'Leyendo conversaciones…');
      els.stepMeta[0].textContent = plural(p.tickets, 'ticket de WhatsApp', 'tickets de WhatsApp');
    }
    // Conversations are read while tickets are still being found.
    if (p.done || p.step !== 'tickets') {
      els.stepMeta[1].textContent = t(p.step === 'tickets' ? '{done} de {total} encontrados hasta ahora' : '{done} de {total} tickets', { done: fmt(p.done), total: fmt(p.toRead) }) + ' · ' +
        plural(p.messages, 'mensaje', 'mensajes') + (p.skipped ? ' · ' + t('{n} ya guardados', { n: fmt(p.skipped) }) : '');
    }
  }

  function beginRun(title, text) {
    stopRequested = false;
    showAllOutliers = false;
    currentReady = false;
    pending = null;
    els.plan.hidden = true;
    els.error.hidden = true;
    pace = null;
    setProgress(0);
    setRunning(true);
    if (last) renderSample(null);
    els.loadingEta.textContent = '';
    els.stepMeta[0].textContent = t('Revisa los tickets actualizados del período');
    els.stepMeta[1].textContent = t('Cuenta los mensajes de cada ticket');
    els.loadingTitle.textContent = title;
    els.loadingText.textContent = text;
  }

  // A finished run (complete, sampled, stopped or cut short).
  // ctx.savedAt: when the data was read (an extended sample keeps the time its tickets were listed).
  function finishRun(result, ctx, stoppedText) {
    last = { result: result, range: ctx.range, channels: ctx.channels, savedAt: result.status === 'done' ? ctx.savedAt || Date.now() : null, inputs: ctx.inputs };
    if (result.status === 'done' && !result.sample) base = last;
    saveCache();
    render();
    if (result.status === 'done' && !result.sample && shareState === 'ready') publish();
    if (stopRequested && result.status === 'done' && result.sample) {
      els.error.textContent = stoppedText;
      els.error.hidden = false;
    } else if (result.status !== 'done') {
      els.error.textContent = result.status === 'stopped'
        ? t('Cálculo cancelado: los números son parciales.')
        : t('El cálculo se cortó antes de terminar: los números son parciales.');
      els.error.hidden = false;
    }
  }

  function runFailed(err) {
    if (window.console) console.error('WhatsApp cost:', err && (err.status || err.message));
    els.error.textContent = friendlyError(err);
    els.error.hidden = false;
  }

  // sampleSize: read only this many tickets, at random (0: every ticket).
  function startRun(ctx, sampleSize) {
    if (running) return;
    var plan = ctx.plan;
    var range = ctx.range;
    var sampling = sampleSize > 0 && (!ctx.count || sampleSize < ctx.count);
    var reuse = plan.mode === 'update';
    beginRun(t(sampling ? 'Estimando con una muestra…' : reuse ? 'Actualizando desde el último cálculo…'
        : plan.mode === 'extend' ? 'Sumando los días anteriores al último cálculo…' : 'Calculando este período y el anterior…'),
      sampling ? t('Primero se buscan todos los tickets; después se leen {n} al azar.', { n: fmt(sampleSize) })
        : t(reuse ? 'Solo se leen los tickets nuevos o actualizados.'
        : plan.mode === 'extend' ? 'Las conversaciones que ya estaban guardadas no se vuelven a leer.'
        : 'La primera vez puede tardar varios minutos. Puedes ver los resultados parciales mientras tanto.'));

    counter.runRange({
      request: api,
      range: range,
      plan: plan,
      sampleSize: sampling ? sampleSize : 0,
      // Search finds native WhatsApp tickets without reading every ticket of the account; only when the last
      // complete run showed that all WhatsApp tickets are native (else the export, which sees every channel).
      search: plan.mode !== 'update' && !!(base && base.result.nativeOnly),
      channels: ctx.channels,
      pauseMs: demo ? demoMode.TIMING.pauseMs : undefined,
      logSpacingMs: demo ? demoMode.TIMING.logSpacingMs : undefined,
      shouldStop: function () { return stopRequested; },
      onPartial: function (partial) {
        last = { result: partial, range: range, channels: ctx.channels, savedAt: null };
        last.result.status = 'partial';
        render();
      },
      onCurrentReady: function (partial) {
        currentReady = true;
        last = { result: partial, range: range, channels: ctx.channels, savedAt: null };
        render();
      },
      onProgress: onRunProgress
    }).then(function (result) {
      finishRun(result, ctx, '');
    }).catch(runFailed).then(function () { setRunning(false); if (last) render(); });
  }

  // Reads `add` more tickets of the current sample (all of them: the exact result).
  function extendRun(add) {
    if (!last || !last.result.sample || running || counting) return;
    var ctx = { range: last.range, channels: last.channels, inputs: last.inputs, savedAt: last.savedAt };
    var from = last.result;
    var savedAt = last.savedAt;
    var left = from.sample.rows.length - from.sample.read;
    add = Math.min(add, left);
    beginRun(t(add >= left ? 'Leyendo los tickets que faltan…' : 'Extendiendo la muestra…'),
      t('Se leen {n} tickets más, elegidos al azar. Lo ya leído no se vuelve a leer.', { n: fmt(add) }));
    counter.extendSample({
      request: api,
      result: from,
      add: add,
      channels: ctx.channels,
      logSpacingMs: demo ? demoMode.TIMING.logSpacingMs : undefined,
      shouldStop: function () { return stopRequested; },
      onPartial: function (partial) {
        last = { result: partial, range: ctx.range, channels: ctx.channels, savedAt: null, inputs: ctx.inputs };
        render();
      },
      onProgress: onRunProgress
    }).then(function (result) {
      finishRun(result, ctx, t('Extensión cancelada: se sumaron {n} tickets a la muestra.', { n: fmt(result.sample ? result.sample.read - from.sample.read : 0) }));
    }).catch(function (err) {
      last = { result: from, range: ctx.range, channels: ctx.channels, savedAt: savedAt, inputs: ctx.inputs };
      runFailed(err);
    }).then(function () { setRunning(false); if (last) render(); });
  }

})();
