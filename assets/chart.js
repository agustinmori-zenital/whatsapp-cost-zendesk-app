(function (root) {
  'use strict';

  var SVG = 'http://www.w3.org/2000/svg';

  function el(name, attrs, parent) {
    var n = document.createElementNS(SVG, name);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(n);
    return n;
  }

  // "Nice" tick step for a range, e.g. 0.05, 0.1, 0.2, 0.5.
  function niceStep(range, count) {
    var raw = range / Math.max(1, count);
    var pow = Math.pow(10, Math.floor(Math.log10(raw)));
    var f = raw / pow;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
  }

  // Bins values into equal-width buckets from 0 to the top of the axis.
  function histogram(values, top, binCount) {
    var width = top / binCount;
    var bins = [];
    for (var i = 0; i < binCount; i++) bins.push({ from: i * width, to: (i + 1) * width, count: 0 });
    values.forEach(function (v) {
      var i = Math.min(binCount - 1, Math.max(0, Math.floor(v / width)));
      bins[i].count += 1;
    });
    return { bins: bins, width: width };
  }

  // Histogram of costs with the mean marker and the outlier limit (mean + 2 sd); outlier bars are orange.
  // opts: { money(n), onHover({bin, x, y} | null) }
  function render(container, values, dist, opts) {
    container.replaceChildren();
    var W = Math.max(320, container.clientWidth || 640);
    var H = 300;
    var m = { l: 48, r: 16, t: 30, b: 36 };
    var iw = W - m.l - m.r;
    var ih = H - m.t - m.b;

    var hasSpread = dist.n >= 3 && dist.sd > 0;
    var top = Math.max(dist.max, hasSpread ? dist.mean + 3 * dist.sd : 0) || 1;
    var step = niceStep(top, 5);
    top = Math.ceil(top / step) * step;
    var binCount = Math.min(30, Math.max(8, Math.round(Math.sqrt(values.length) * 2)));
    var h = histogram(values, top, binCount);
    var maxCount = Math.max.apply(null, h.bins.map(function (b) { return b.count; }));
    var yTop = maxCount * 1.1 || 1;
    var yStep = Math.max(1, niceStep(yTop, 4));
    yTop = Math.ceil(yTop / yStep) * yStep;

    var x = function (v) { return m.l + v / top * iw; };
    var y = function (c) { return m.t + ih - c / yTop * ih; };

    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': opts.label || 'Histograma del costo por ticket' });
    var axis = el('g', { class: 'axis' }, svg);

    // Gridlines and y labels (ticket counts).
    for (var c = 0; c <= yTop; c += yStep) {
      if (c > 0) el('line', { class: 'gridline', x1: m.l, x2: W - m.r, y1: y(c), y2: y(c) }, axis);
      var ty = el('text', { x: m.l - 8, y: y(c) + 4, 'text-anchor': 'end' }, axis);
      ty.textContent = c;
    }
    // X labels (cost).
    for (var v = 0; v <= top + 1e-9; v += step) {
      var tx = el('text', { x: x(v), y: H - m.b + 18, 'text-anchor': 'middle' }, axis);
      tx.textContent = opts.money(v);
    }
    var yTitle = el('text', { x: m.l - 8, y: m.t - 14, 'text-anchor': 'end' }, axis);
    var texts = opts.texts || {};
    yTitle.textContent = texts.tickets || 'tickets';

    // Bars: 2px gap between neighbors, rounded top only via a clip-free path.
    var bars = el('g', {}, svg);
    h.bins.forEach(function (bin) {
      var bx = x(bin.from) + 1;
      var bw = Math.max(1, x(bin.to) - x(bin.from) - 2);
      var isOut = bin.from >= dist.threshold || (bin.to > dist.threshold && (bin.from + bin.to) / 2 >= dist.threshold);
      if (bin.count > 0) {
        // At least 3px tall so single outlier tickets stay visible next to tall bins.
        var by = Math.min(y(bin.count), y(0) - 3);
        var r = Math.min(4, bw / 2, y(0) - by);
        var d = 'M' + bx + ',' + y(0) + 'V' + (by + r) + 'Q' + bx + ',' + by + ' ' + (bx + r) + ',' + by +
          'H' + (bx + bw - r) + 'Q' + (bx + bw) + ',' + by + ' ' + (bx + bw) + ',' + (by + r) + 'V' + y(0) + 'Z';
        var bar = el('path', { class: 'bar' + (isOut ? ' out' : ''), d: d }, bars);
        bin.node = bar;
      }
      // Hit target spans the full column height, bigger than the mark.
      var hit = el('rect', { class: 'hit', x: x(bin.from), y: m.t, width: x(bin.to) - x(bin.from), height: ih }, bars);
      hit.addEventListener('mouseenter', function () {
        if (bin.node) bin.node.classList.add('active');
        opts.onHover({ bin: bin, outlier: isOut, x: x((bin.from + bin.to) / 2), y: bin.count ? y(bin.count) : y(0) });
      });
      hit.addEventListener('mouseleave', function () {
        if (bin.node) bin.node.classList.remove('active');
        opts.onHover(null);
      });
    });
    el('line', { class: 'baseline', x1: m.l, x2: W - m.r, y1: y(0), y2: y(0) }, svg);

    if (hasSpread) {
      // Labels sit on two rows so close markers never collide.
      marker(svg, x(dist.mean), m.t, y(0), 'mean', (texts.mean || 'Promedio {x}').replace('{x}', opts.money(dist.mean)), 'start', m.t - 10);
      if (dist.threshold <= top) {
        var anchor = x(dist.threshold) > W - 180 ? 'end' : 'start';
        marker(svg, x(dist.threshold), m.t, y(0), 'limit', (texts.limit || 'Fuera de lo normal desde {x}').replace('{x}', opts.money(dist.threshold)), anchor, m.t + 8);
      }
    }

    container.appendChild(svg);
  }

  function marker(svg, xPos, yTop, yBottom, cls, text, anchor, labelY) {
    el('line', { class: 'marker ' + cls, x1: xPos, x2: xPos, y1: yTop - 6, y2: yBottom }, svg);
    var t = el('text', { class: 'marker-label ' + cls, x: xPos + (anchor === 'end' ? -4 : 4), y: labelY, 'text-anchor': anchor }, svg);
    t.textContent = text;
  }

  // Vertical bars, one per week. weeks: [{ label, value, partial }]; opts: { money(n), onHover({week, x, y} | null), label }
  function renderWeekly(container, weeks, opts) {
    container.replaceChildren();
    var W = Math.max(320, container.clientWidth || 640);
    var H = 220;
    var m = { l: 56, r: 12, t: 20, b: 30 };
    var iw = W - m.l - m.r;
    var ih = H - m.t - m.b;
    var max = Math.max.apply(null, weeks.map(function (w) { return w.value; }).concat([0]));
    var step = niceStep(max || 1, 4);
    var top = Math.ceil((max || 1) / step) * step;
    var y = function (v) { return m.t + ih - v / top * ih; };
    var slot = iw / Math.max(1, weeks.length);
    var bw = Math.max(1, Math.min(56, slot - 8)); // a long range gives thin bars, never negative widths

    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': opts.label || 'Costo por semana' });
    var axis = el('g', { class: 'axis' }, svg);
    for (var v = 0; v <= top + 1e-9; v += step) {
      if (v > 0) el('line', { class: 'gridline', x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }, axis);
      var t = el('text', { x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end' }, axis);
      t.textContent = opts.money(v);
    }
    // Label every bar only when they fit; otherwise every other week.
    var every = Math.max(1, Math.ceil(44 / slot));
    weeks.forEach(function (w, i) {
      var cx = m.l + slot * i + slot / 2;
      var by = Math.min(y(w.value), y(0) - (w.value > 0 ? 3 : 0));
      var r = Math.min(4, bw / 2, y(0) - by);
      var bx = cx - bw / 2;
      var bar = el('path', {
        class: 'wbar' + (w.partial ? ' partial' : ''),
        d: 'M' + bx + ',' + y(0) + 'V' + (by + r) + 'Q' + bx + ',' + by + ' ' + (bx + r) + ',' + by + 'H' + (bx + bw - r) +
          'Q' + (bx + bw) + ',' + by + ' ' + (bx + bw) + ',' + (by + r) + 'V' + y(0) + 'Z'
      }, svg);
      if (i % every === 0) {
        var lx = el('text', { x: cx, y: H - m.b + 18, 'text-anchor': 'middle' }, axis);
        lx.textContent = w.label;
      }
      var hit = el('rect', { class: 'hit', x: m.l + slot * i, y: m.t, width: slot, height: ih }, svg);
      hit.addEventListener('mouseenter', function () { bar.classList.add('active'); opts.onHover({ week: w, x: cx, y: by }); });
      hit.addEventListener('mouseleave', function () { bar.classList.remove('active'); opts.onHover(null); });
    });
    el('line', { class: 'baseline', x1: m.l, x2: W - m.r, y1: y(0), y2: y(0) }, svg);
    container.appendChild(svg);
  }

  // Day x hour grid; darker cells cost more. cells: 7 rows (Monday first) of 24 values.
  // opts: { days: ['Lun', ...], onHover({day, hour, value, x, y} | null), label }
  function renderHeatmap(container, cells, opts) {
    container.replaceChildren();
    var W = Math.max(320, container.clientWidth || 640);
    var m = { l: 40, r: 4, t: 4, b: 22 };
    var cw = (W - m.l - m.r) / 24;
    var ch = Math.max(18, Math.min(30, cw * 0.9));
    var H = m.t + ch * 7 + m.b;
    var max = 0;
    cells.forEach(function (row) { row.forEach(function (v) { if (v > max) max = v; }); });
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': opts.label || 'Costo por día y hora' });
    var axis = el('g', { class: 'axis' }, svg);
    cells.forEach(function (row, d) {
      var ty = el('text', { x: m.l - 8, y: m.t + ch * d + ch / 2 + 4, 'text-anchor': 'end' }, axis);
      ty.textContent = opts.days[d];
      row.forEach(function (v, h) {
        var x = m.l + cw * h;
        var y = m.t + ch * d;
        // Square root keeps quiet hours visible next to the busiest one.
        var cell = el('rect', { class: 'cell' + (v > 0 ? '' : ' empty'), x: x, y: y, width: Math.max(1, cw), height: ch,
          'fill-opacity': v > 0 ? (0.12 + 0.88 * Math.sqrt(v / max)).toFixed(3) : 1 }, svg);
        cell.addEventListener('mouseenter', function () { cell.classList.add('active'); opts.onHover({ day: d, hour: h, value: v, x: x + cw / 2, y: y }); });
        cell.addEventListener('mouseleave', function () { cell.classList.remove('active'); opts.onHover(null); });
      });
    });
    for (var h = 0; h < 24; h += 3) {
      var tx = el('text', { x: m.l + cw * h + cw / 2, y: H - 6, 'text-anchor': 'middle' }, axis);
      tx.textContent = h + 'h';
    }
    container.appendChild(svg);
  }

  root.BellChart = { render: render, renderWeekly: renderWeekly, renderHeatmap: renderHeatmap };
})(typeof globalThis !== 'undefined' ? globalThis : this);
