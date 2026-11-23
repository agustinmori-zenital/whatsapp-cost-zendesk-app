(function (root) {
  'use strict';

  // Interface language: Spanish (source texts), English and Brazilian Portuguese. Texts in the code are the
  // Spanish ones; t() looks them up in the dictionary of the current language (assets/i18n-dict.js) and falls
  // back to Spanish. {name} placeholders are filled from `params`.
  //
  // Language: the viewer's choice in Ajustes (stored in this browser), else the Zendesk profile language
  // (client.get('currentUser.locale'), e.g. "es-419", "pt-BR", "en-US"), else the browser's.

  var LANGS = ['es', 'en', 'pt-BR'];
  var STORAGE = 'wa-cost:lang';
  var current = 'es';

  function dict() { return (root.WaDict && root.WaDict[current]) || null; }

  // Language for a locale code: Spanish and Portuguese variants map to ours, anything else to English.
  function fromLocale(locale) {
    var l = String(locale || '').toLowerCase();
    if (l.indexOf('es') === 0) return 'es';
    if (l.indexOf('pt') === 0) return 'pt-BR';
    return 'en';
  }

  function chosen() {
    try {
      var v = root.localStorage.getItem(STORAGE);
      return LANGS.indexOf(v) >= 0 ? v : '';
    } catch (e) { return ''; }
  }

  function choose(lang) {
    try {
      if (LANGS.indexOf(lang) >= 0) root.localStorage.setItem(STORAGE, lang); else root.localStorage.removeItem(STORAGE);
    } catch (e) { /* storage blocked: the choice lasts until the page closes */ }
  }

  function set(lang) {
    current = LANGS.indexOf(lang) >= 0 ? lang : 'en';
    if (root.document) root.document.documentElement.lang = current;
    return current;
  }

  // The language to use: the stored choice, else the Zendesk profile locale (asked through the ZAF client),
  // else the browser's. Resolves to the language set.
  function init(client) {
    var pick = chosen();
    if (pick) return Promise.resolve(set(pick));
    var nav = root.navigator && root.navigator.language;
    if (!client || !client.get) return Promise.resolve(set(fromLocale(nav)));
    return client.get('currentUser.locale').then(function (data) {
      return set(fromLocale((data && data['currentUser.locale']) || nav));
    }, function () { return set(fromLocale(nav)); });
  }

  function t(text, params) {
    var d = current === 'es' ? null : dict();
    var out = (d && d[text]) || text;
    if (params) out = out.replace(/\{(\w+)\}/g, function (m, k) { return params[k] != null ? String(params[k]) : m; });
    return out;
  }

  // Locale for numbers and dates.
  function locale() { return current; }

  // Translates the page's fixed texts (text nodes and title/placeholder/aria-label attributes) whose Spanish
  // text is in the dictionary. The Spanish original is kept on the node, so the page can switch language again.
  var ATTRS = ['title', 'placeholder', 'aria-label'];
  function translatePage(scope) {
    var doc = root.document;
    var base = root.WaDict && root.WaDict.en;
    if (!doc || !base) return;
    var walker = doc.createTreeWalker(scope || doc.body, 4 /* NodeFilter.SHOW_TEXT */);
    for (var n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.__src == null) {
        var key = n.nodeValue.trim();
        if (!key || !base[key]) continue;
        n.__src = key;
        n.__pad = n.nodeValue.match(/^\s*/)[0] + '|' + n.nodeValue.match(/\s*$/)[0];
      }
      var pad = n.__pad.split('|');
      n.nodeValue = pad[0] + t(n.__src) + pad[1];
    }
    Array.prototype.forEach.call((scope || doc.body).querySelectorAll('[title],[placeholder],[aria-label]'), function (el) {
      el.__srcAttrs = el.__srcAttrs || {};
      ATTRS.forEach(function (a) {
        if (!el.hasAttribute(a)) return;
        if (el.__srcAttrs[a] == null) {
          var v = el.getAttribute(a);
          if (!base[v]) return;
          el.__srcAttrs[a] = v;
        }
        el.setAttribute(a, t(el.__srcAttrs[a]));
      });
    });
    var title = doc.querySelector('title');
    if (title) {
      title.__src = title.__src || title.textContent;
      title.textContent = t(title.__src);
    }
  }

  var api = { LANGS: LANGS, init: init, set: set, t: t, locale: locale, choose: choose, chosen: chosen, fromLocale: fromLocale, translatePage: translatePage };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.WaI18n = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
