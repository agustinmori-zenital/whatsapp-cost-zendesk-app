#!/bin/sh
# Builds the app zip. Usage: sh dev/package.sh            -> dist/zd-message-counter.zip (private app, manual upload)
#                            sh dev/package.sh marketplace -> dist/zd-message-counter-marketplace.zip ("private": false)
# Both also leave a versioned copy in releases/.
set -e
cd "$(dirname "$0")/.."
TMP=$(mktemp -d)
cp -R manifest.json assets translations "$TMP/"
NAME=zd-message-counter
if [ "$1" = "marketplace" ]; then
  # The Marketplace lists public apps only; the same code, with "private" set to false.
  python3 -c "import json,sys; p=sys.argv[1]; m=json.load(open(p)); m['private']=False; json.dump(m, open(p,'w'), indent=2, ensure_ascii=False)" "$TMP/manifest.json"
  NAME=zd-message-counter-marketplace
fi
mkdir -p dist
rm -f "dist/$NAME.zip"
(cd "$TMP" && zip -rq "$OLDPWD/dist/$NAME.zip" manifest.json assets translations -x '.*')
rm -rf "$TMP"
# Versioned copy kept in releases/ (e.g. releases/zd-message-counter-v1.0.0-marketplace.zip).
VERSION=$(python3 -c "import json; print(json.load(open('manifest.json'))['version'])")
mkdir -p releases
cp "dist/$NAME.zip" "releases/$(echo "$NAME" | sed "s/^zd-message-counter/zd-message-counter-v$VERSION/").zip"
echo "dist/$NAME.zip"
