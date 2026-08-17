#!/bin/bash
# Baut das Store-Zip für Dia Bookmarks.
# Entfernt dabei die Dev-Bestandteile: den #dbg…-Debug-Block in sidepanel.js
# (ersetzt durch einen no-op dbg()-Stub, weil openInNewTab dbg() aufruft) und
# den web_accessible_resources-Eintrag im Manifest (nur fürs Live-Debugging).
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -e "console.log(require('./manifest.json').version)")
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

mkdir -p "$STAGE/src" "$STAGE/icons"
cp -R src/. "$STAGE/src/"
cp icons/icon16.png icons/icon32.png icons/icon48.png icons/icon128.png "$STAGE/icons/"

node -e "
const fs = require('fs');
const m = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
delete m.web_accessible_resources;
fs.writeFileSync(process.argv[1] + '/manifest.json', JSON.stringify(m, null, 2) + '\n');
" "$STAGE"

node -e "
const fs = require('fs');
const p = process.argv[1] + '/src/sidepanel/sidepanel.js';
let s = fs.readFileSync(p, 'utf8');
const marker = '// ---------------------------------------------------------- Debug (Dia) ----';
const i = s.indexOf(marker);
if (i === -1) throw new Error('Debug-Marker nicht gefunden — sidepanel.js geändert?');
s = s.slice(0, i) + 'function dbg() {}\n';
fs.writeFileSync(p, s);
" "$STAGE"

node --check "$STAGE/src/sidepanel/sidepanel.js"
node --check "$STAGE/src/background.js"
node --check "$STAGE/src/content-peekbar.js"

OUT="$PWD/dist/dia-bookmarks-$VERSION.zip"
rm -f "$OUT"
(cd "$STAGE" && zip -rX "$OUT" manifest.json src icons >/dev/null)
echo "wrote $OUT"
unzip -l "$OUT"
