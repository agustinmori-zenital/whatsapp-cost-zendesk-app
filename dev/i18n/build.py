# Builds assets/i18n-dict.js from rows.py and reports texts of the code and pages that have no row.
# Usage (from the project folder): python3 dev/i18n/build.py
import json, os, subprocess, sys
here = os.path.dirname(os.path.abspath(__file__))
root = os.path.dirname(os.path.dirname(here))
sys.path.insert(0, here)
from rows import ROWS
keys_file = os.path.join(here, 'keys.json')
subprocess.run([sys.executable, os.path.join(here, 'keys.py'), root, keys_file], check=True)
keys = json.load(open(keys_file))
os.remove(keys_file)
seen = {}
for es, en, pt in ROWS: seen[es] = (en, pt)
IGNORE = {'use strict','YYYY-MM','▲','▼','up','down','#','(','(0)','[N tickets]','[por ticket]','[por mes]','selected','over','diff-ok','diff-off',
 'WhatsApp cost (share):','WhatsApp cost (share setup):','WhatsApp cost (shared data):','WhatsApp cost:','muted small','routeTo',',','done','active','.filter select','100%','low','0%','—',').','app.willDestroy',
 # Technical details for the support team: always in English.
 'App: WhatsApp Cost','Zendesk:','Language:','· demo mode','Last calculation:','WhatsApp tickets','Shared results:','Browser:','\\n','\\n\\n---\\n','[WhatsApp Cost]','POST'}
missing = [k for k in keys if k not in seen and k not in IGNORE]
print('missing', missing)
en = {k: v[0] for k, v in seen.items()}
pt = {k: v[1] for k, v in seen.items()}
js = """(function (root) {
  'use strict';

  // Translations of the interface texts. Keys are the Spanish texts used in the code and pages (see i18n.js);
  // {name} placeholders must be kept. Generated from one table of es / en / pt-BR rows: keep both languages in step.
  var dict = """ + json.dumps({'en': en, 'pt-BR': pt}, ensure_ascii=False, indent=2).replace('\n', '\n  ') + """;
  if (typeof module !== 'undefined' && module.exports) module.exports = dict;
  root.WaDict = dict;
})(typeof globalThis !== 'undefined' ? globalThis : this);
"""
open(os.path.join(root, 'assets', 'i18n-dict.js'), 'w').write(js)
print(len(en))
