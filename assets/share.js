(function (root) {
  'use strict';

  // Shared results: the last complete calculation, saved in a Zendesk custom object so every admin opens the
  // same numbers (browser storage is per person) and the ticket panel can compare a ticket with the averages.
  // Custom objects: Suite Team and above; only admins create the object and its field, agents read and write
  // records; each record is at most 32 KB. The result is gzipped, base64-encoded and split into records.
  //
  // Records (name -> data field):
  //   result-meta      { gen, parts, savedAt, bytes } (written last, so readers never see half a result)
  //   result-<gen>-<i> part i of the compressed result; gen alternates between "a" and "b"
  //   benchmarks       average cost per ticket overall and per form, group and brand (plain JSON, small)

  var OBJECT = 'wa_cost_snapshot';
  var FIELD = 'data';
  var PART_CHARS = 28000; // base64 characters per record, under the 32 KB record limit with room for the rest
  var BASE = '/api/v2/custom_objects/' + OBJECT;

  function toBase64(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  function fromBase64(text) {
    var s = atob(text);
    var bytes = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    return bytes;
  }

  async function pipe(bytes, stream) {
    var out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
    return new Uint8Array(await out.arrayBuffer());
  }

  // "gz:" + base64(gzip(text)), or "js:" + text where the browser has no CompressionStream.
  async function compress(text) {
    if (typeof CompressionStream === 'undefined') return 'js:' + text;
    return 'gz:' + toBase64(await pipe(new TextEncoder().encode(text), new CompressionStream('gzip')));
  }

  async function decompress(data) {
    if (data.slice(0, 3) === 'js:') return data.slice(3);
    if (data.slice(0, 3) !== 'gz:') throw new Error('Unknown shared data format');
    return new TextDecoder().decode(await pipe(fromBase64(data.slice(3)), new DecompressionStream('gzip')));
  }

  function split(text, size) {
    var parts = [];
    for (var i = 0; i < text.length; i += size) parts.push(text.slice(i, i + size));
    return parts.length ? parts : [''];
  }

  // request: client.request-like function (or the demo account's).
  function create(request) {
    // Listing returns every record with its data: peek and load right after it reuse the same listing
    // instead of downloading the shared result twice. Writes drop it.
    var listed = null;
    var REUSE_MS = 30000;
    function records() {
      if (listed && Date.now() - listed.at < REUSE_MS) return listed.promise;
      listed = { at: Date.now(), promise: list() };
      listed.promise.catch(function () { listed = null; });
      return listed.promise;
    }

    // Records by name (the newest one when a name repeats).
    async function list() {
      var byName = {};
      var url = BASE + '/records?page[size]=100';
      for (var n = 0; url && n < 50; n++) {
        var res = await request({ url: url, type: 'GET' });
        (res.custom_object_records || []).forEach(function (r) {
          var old = byName[r.name];
          if (!old || String(r.updated_at || '') >= String(old.updated_at || '')) byName[r.name] = r;
        });
        url = res.meta && res.meta.has_more && res.links && res.links.next ? new URL(res.links.next).pathname + new URL(res.links.next).search : null;
      }
      return byName;
    }

    // Records, or none when the object does not exist (yet) or cannot be read.
    async function recordsOrNone() {
      try { return await records(); } catch (err) { if (err && (err.status === 404 || err.status === 403)) return {}; throw err; }
    }

    function value(r) { return r && r.custom_object_fields ? r.custom_object_fields[FIELD] : null; }

    function write(existing, name, data) {
      listed = null;
      var body = { custom_object_record: { custom_object_fields: {} } };
      body.custom_object_record.custom_object_fields[FIELD] = data;
      if (existing[name]) {
        return request({ url: BASE + '/records/' + existing[name].id, type: 'PATCH', contentType: 'application/json', data: JSON.stringify(body) });
      }
      body.custom_object_record.name = name;
      return request({ url: BASE + '/records', type: 'POST', contentType: 'application/json', data: JSON.stringify(body) });
    }

    return {
      // 'ready' (object exists), 'missing' (an admin can create it) or 'unavailable' (plan or permission).
      status: async function () {
        try {
          await request({ url: BASE, type: 'GET' });
          return 'ready';
        } catch (err) {
          return err && err.status === 404 ? 'missing' : 'unavailable';
        }
      },

      // Creates the custom object and its text field (admins only).
      setup: async function () {
        await request({ url: '/api/v2/custom_objects', type: 'POST', contentType: 'application/json', data: JSON.stringify({
          custom_object: { key: OBJECT, title: 'WhatsApp Cost (app data)', title_pluralized: 'WhatsApp Cost (app data)',
            description: 'Used by the WhatsApp Cost app to share its last calculation. Do not edit by hand.' }
        }) });
        await request({ url: BASE + '/fields', type: 'POST', contentType: 'application/json', data: JSON.stringify({
          custom_object_field: { key: FIELD, title: 'Data', type: 'textarea' }
        }) });
      },

      // snapshot: what the dashboard caches (plain object); bench: counter.benchmarks output.
      publish: async function (snapshot, bench) {
        var existing = await records();
        var meta = null;
        try { meta = JSON.parse(value(existing['result-meta'])); } catch (e) { meta = null; }
        var gen = meta && meta.gen === 'a' ? 'b' : 'a';
        var parts = split(await compress(JSON.stringify(snapshot)), PART_CHARS);
        for (var i = 0; i < parts.length; i++) await write(existing, 'result-' + gen + '-' + i, parts[i]);
        await write(existing, 'result-meta', JSON.stringify({ gen: gen, parts: parts.length, savedAt: snapshot.savedAt, chars: parts.join('').length }));
        if (bench) await write(existing, 'benchmarks', JSON.stringify(Object.assign({ savedAt: snapshot.savedAt }, bench)));
        return { parts: parts.length, savedAt: snapshot.savedAt };
      },

      // { savedAt } of the shared result without downloading it, or null.
      peek: async function () {
        var existing = await recordsOrNone();
        try { return JSON.parse(value(existing['result-meta'])); } catch (e) { return null; }
      },

      // The shared snapshot, or null when none was published.
      load: async function () {
        var existing = await recordsOrNone();
        var meta;
        try { meta = JSON.parse(value(existing['result-meta'])); } catch (e) { return null; }
        if (!meta || !meta.parts) return null;
        var text = '';
        for (var i = 0; i < meta.parts; i++) {
          var part = value(existing['result-' + meta.gen + '-' + i]);
          if (part == null) return null; // a part is missing: better nothing than a broken result
          text += part;
        }
        return JSON.parse(await decompress(text));
      },

      benchmarks: async function () {
        var existing = await recordsOrNone();
        try { return JSON.parse(value(existing.benchmarks)); } catch (e) { return null; }
      }
    };
  }

  var api = { create: create, compress: compress, decompress: decompress, OBJECT: OBJECT, PART_CHARS: PART_CHARS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.WaShare = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
