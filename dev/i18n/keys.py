# Lists the Spanish UI texts: string literals of app.js/ticket.js that look like text, and the fixed texts of the HTML pages.
import re, json, sys, html
from html.parser import HTMLParser
root = sys.argv[1]
keys = []
def add(k):
    k = k.strip()
    if k and k not in keys: keys.append(k)
TECH = re.compile(r"^[a-z0-9_:\-./#\[\]{}@=&?*+|]*$")
for f in ['assets/app.js', 'assets/ticket.js']:
    src = open(root + '/' + f).read()
    # drop comments
    src = re.sub(r'^\s*//.*$', '', src, flags=re.M)
    for m in re.finditer(r"'((?:[^'\\\n]|\\.)*)'", src):
        v = m.group(1).replace("\\'", "'")
        if TECH.match(v) or len(v) < 2: continue
        if re.match(r'^[A-Za-z]+$', v) and v in ('GET','PUT','Enter','Other','Ticket','Bot','WhatsApp','US$ ','click','input','change','submit','resize','keydown','true','false','application/json','currentUser.locale'): 
            if v not in ('Ticket','Bot'): continue
        if v.startswith(('wa-cost', '/api', 'text/', 'step', 'ticket.', 'field:', 'btn ', 'notice', 'delta', 'bar-', 'currentUser')): continue
        if v in ('US$ ', ' · ', ': ', ' / ', '—', '=', '% ', '0', '(error ', ' (error ', ' — ', '; ', 'es'): continue
        add(v)
class P(HTMLParser):
    def __init__(s): super().__init__(); s.skip = 0
    def handle_starttag(s, tag, attrs):
        if tag in ('script', 'style'): s.skip += 1
        for a, v in attrs:
            if a in ('title', 'placeholder', 'aria-label') and v: add(v)
    def handle_endtag(s, tag):
        if tag in ('script', 'style'): s.skip -= 1
    def handle_data(s, d):
        if not s.skip and d.strip(): add(' '.join(d.split()))
for f in ['assets/iframe.html', 'assets/ticket.html']:
    P().feed(open(root + '/' + f).read())
json.dump(keys, open(sys.argv[2], 'w'), ensure_ascii=False, indent=0)
print(len(keys))
