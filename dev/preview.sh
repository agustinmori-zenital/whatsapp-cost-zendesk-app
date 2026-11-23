#!/bin/sh
# Local preview of the dashboard with fake data (dev/stub.js instead of the ZAF SDK).
# Usage: sh dev/preview.sh [output dir], then open http://localhost:8765/index.html (dashboard) or
# ticket-preview.html (ticket panel). Add ?demo=1 to preview demo mode.
set -e
cd "$(dirname "$0")/.."
OUT=${1:-$(mktemp -d)}
mkdir -p "$OUT"
cp -R assets/. "$OUT/"
cp dev/stub.js "$OUT/stub.js"
SDK='https://static.zdassets.com/zendesk_app_framework_sdk/2.0/zaf_sdk.min.js'
sed "s#$SDK#stub.js#" assets/iframe.html > "$OUT/index.html"
sed "s#$SDK#stub.js#" assets/ticket.html > "$OUT/ticket-preview.html"
cp dev/marketplace-shot.html "$OUT/marketplace-shot.html"
# With an output dir the files are only prepared (a server of your own, e.g. the Browser pane, serves them).
if [ -n "$1" ]; then echo "Prepared $OUT"; exit 0; fi
echo "Serving $OUT on http://localhost:8765/index.html"
python3 -m http.server 8765 --bind 127.0.0.1 --directory "$OUT"
