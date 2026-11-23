(function (root) {
  'use strict';

  // Meta WhatsApp Business Platform, USD per delivered service message, effective 2026-10-01.
  // Source: "USD list rates" CSV and country calling code table at
  // https://developers.facebook.com/docs/whatsapp/pricing (read 2026-11-09).
  var EFFECTIVE = '2026-10-01';
  var FREE_SERVICE_PER_NUMBER_PER_MONTH = 1000;

  var SERVICE_USD = {
    'Argentina': 0.026, 'Bangladesh': 0.0037, 'Brazil': 0.0068, 'Chile': 0.02, 'Colombia': 0.0008,
    'Egypt': 0.0036, 'France': 0.03, 'Germany': 0.055, 'Hong Kong': 0.026, 'Hungary': 0.035,
    'India': 0.0014, 'Indonesia': 0.025, 'Iraq': 0.0079, 'Israel': 0.0053, 'Italy': 0.03,
    'Kazakhstan': 0.018, 'Kuwait': 0.044, 'Malaysia': 0.014, 'Mexico': 0.0085, 'Morocco': 0.023,
    'Netherlands': 0.05, 'Nepal': 0.0034, 'Nigeria': 0.0067, 'Oman': 0.0247, 'Pakistan': 0.015,
    'Peru': 0.03, 'Poland': 0.0122, 'Qatar': 0.012, 'Romania': 0.029, 'Russia': 0.04,
    'Saudi Arabia': 0.0107, 'Singapore': 0.016, 'South Africa': 0.0095, 'Spain': 0.02, 'Sri Lanka': 0.002,
    'Turkey': 0.0009, 'Ukraine': 0.0298, 'United Arab Emirates': 0.0157, 'United Kingdom': 0.022,
    'North America': 0.0034, 'Rest of Africa': 0.004, 'Rest of Asia Pacific': 0.0113,
    'Rest of Central & Eastern Europe': 0.0212, 'Rest of Latin America': 0.0113,
    'Rest of Middle East': 0.0091, 'Rest of Western Europe': 0.0171, 'Other': 0.0077
  };

  // Country calling code -> market. Codes not listed map to "Other".
  var CODES = {
    '54': 'Argentina', '880': 'Bangladesh', '55': 'Brazil', '56': 'Chile', '57': 'Colombia', '20': 'Egypt',
    '33': 'France', '49': 'Germany', '852': 'Hong Kong', '36': 'Hungary', '91': 'India', '62': 'Indonesia',
    '972': 'Israel', '964': 'Iraq', '39': 'Italy', '965': 'Kuwait', '60': 'Malaysia', '52': 'Mexico',
    '212': 'Morocco', '977': 'Nepal', '31': 'Netherlands', '234': 'Nigeria', '968': 'Oman', '92': 'Pakistan',
    '51': 'Peru', '48': 'Poland', '974': 'Qatar', '40': 'Romania', '966': 'Saudi Arabia', '65': 'Singapore',
    '94': 'Sri Lanka', '27': 'South Africa', '34': 'Spain', '90': 'Turkey', '380': 'Ukraine',
    '971': 'United Arab Emirates', '44': 'United Kingdom'
  };
  var REGIONS = {
    'Rest of Africa': '213 244 229 267 226 257 237 235 242 291 251 241 220 233 245 225 254 266 231 218 261 265 223 222 258 264 227 250 221 232 252 211 249 268 255 228 216 256 260 263',
    'Rest of Asia Pacific': '93 61 855 86 81 856 976 64 675 63 886 992 66 993 998 84',
    'Rest of Central & Eastern Europe': '355 374 994 375 359 385 420 995 30 371 370 373 389 381 421 386',
    'Rest of Western Europe': '43 32 45 358 353 47 351 46 41',
    'Rest of Latin America': '591 506 593 503 502 509 504 505 507 595 598 58',
    'Rest of Middle East': '973 962 961 967'
  };
  Object.keys(REGIONS).forEach(function (region) {
    REGIONS[region].split(' ').forEach(function (code) { CODES[code] = region; });
  });
  // +1 area codes that Meta prices as Rest of Latin America (Dominican Republic, Jamaica, Puerto Rico).
  var NANP_LATAM = ['809', '829', '849', '658', '876', '787', '939'];

  // Digits of an international number, or null when the format is not clearly international.
  function normalize(phone) {
    if (typeof phone !== 'string' && typeof phone !== 'number') return null;
    var s = String(phone).trim();
    var digits = s.replace(/\D/g, '');
    if (/^\+/.test(s)) return digits;
    if (/^00/.test(digits)) return digits.slice(2);
    // A single leading 0 is a national trunk prefix (011 5555 6666), not a country code.
    if (/^0/.test(digits)) return null;
    // WhatsApp ids are E.164 without "+"; shorter strings are likely local numbers.
    return digits.length >= 11 ? digits : null;
  }

  // A stored result keeps the customer's market ("m:Chile"), not the phone itself (see counter.packResult).
  var MASK = /^m:(.*)$/;

  function marketForPhone(phone) {
    var masked = MASK.exec(String(phone == null ? '' : phone));
    if (masked) return SERVICE_USD[masked[1]] != null ? masked[1] : null;
    var d = normalize(phone);
    if (!d || d.length < 8) return null;
    if (d[0] === '1') return NANP_LATAM.indexOf(d.slice(1, 4)) >= 0 ? 'Rest of Latin America' : 'North America';
    // Kazakhstan numbers are +7 6xx / +7 7xx; the rest of +7 is Russia.
    if (d[0] === '7') return /^7[67]/.test(d) ? 'Kazakhstan' : 'Russia';
    for (var len = 3; len >= 1; len--) {
      var m = CODES[d.slice(0, len)];
      if (m) return m;
    }
    return 'Other';
  }

  var NAMES_ES = {
    'Argentina': 'Argentina', 'Brazil': 'Brasil', 'Chile': 'Chile', 'Colombia': 'Colombia', 'Mexico': 'México',
    'Peru': 'Perú', 'Spain': 'España', 'North America': 'Estados Unidos y Canadá',
    'Rest of Latin America': 'Resto de Latinoamérica', 'Rest of Western Europe': 'Resto de Europa occidental',
    'Rest of Central & Eastern Europe': 'Resto de Europa central y del este', 'Rest of Asia Pacific': 'Resto de Asia Pacífico',
    'Rest of Middle East': 'Resto de Medio Oriente', 'Rest of Africa': 'Resto de África', 'Other': 'Otros países',
    'France': 'Francia', 'Germany': 'Alemania', 'Italy': 'Italia', 'United Kingdom': 'Reino Unido', 'Netherlands': 'Países Bajos'
  };

  var NAMES_PT = {
    'Argentina': 'Argentina', 'Brazil': 'Brasil', 'Chile': 'Chile', 'Colombia': 'Colômbia', 'Mexico': 'México',
    'Peru': 'Peru', 'Spain': 'Espanha', 'North America': 'Estados Unidos e Canadá',
    'Rest of Latin America': 'Resto da América Latina', 'Rest of Western Europe': 'Resto da Europa Ocidental',
    'Rest of Central & Eastern Europe': 'Resto da Europa Central e Oriental', 'Rest of Asia Pacific': 'Resto da Ásia-Pacífico',
    'Rest of Middle East': 'Resto do Oriente Médio', 'Rest of Africa': 'Resto da África', 'Other': 'Outros países',
    'France': 'França', 'Germany': 'Alemanha', 'Italy': 'Itália', 'United Kingdom': 'Reino Unido', 'Netherlands': 'Países Baixos'
  };
  var NAMES_EN = { 'North America': 'United States and Canada', 'Other': 'Other countries' };

  function nameEs(market) { return NAMES_ES[market] || market; }

  // Market name in the interface language ('es', 'en' or 'pt-BR'); markets without one keep Meta's English name.
  function name(market, lang) {
    var table = lang === 'pt-BR' ? NAMES_PT : lang === 'en' ? NAMES_EN : NAMES_ES;
    return table[market] || market;
  }

  // Market from free text typed by an admin ("Argentina", "México", "Rest of Latin America"...), or null.
  function findMarket(text) {
    var t = String(text || '').trim().toLowerCase();
    if (!t) return null;
    var found = null;
    Object.keys(SERVICE_USD).forEach(function (m) {
      if (!found && [m, nameEs(m), name(m, 'pt-BR'), name(m, 'en')].some(function (x) { return x.toLowerCase() === t; })) found = m;
    });
    return found;
  }

  var api = {
    EFFECTIVE: EFFECTIVE,
    nameEs: nameEs,
    name: name,
    findMarket: findMarket,
    FREE_SERVICE_PER_NUMBER_PER_MONTH: FREE_SERVICE_PER_NUMBER_PER_MONTH,
    SERVICE_USD: SERVICE_USD,
    markets: function () { return Object.keys(SERVICE_USD); },
    marketForPhone: marketForPhone
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MetaRates = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
