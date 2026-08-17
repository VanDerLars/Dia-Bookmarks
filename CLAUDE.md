# CLAUDE.md — DiaSideBar

Project context and operational notes for Claude Code. Read this first.
Sibling project of **DiaPeek** (../DiaPeek) — its CLAUDE.md has the shared
Dia-browser gotchas (NEVER launch the Dia/Arc binaries, rendering constraints,
claude-in-chrome MCP quirks). All of those apply here too.

## What it is
DiaSideBar is a Manifest V3 extension for the **Dia browser**: a bookmarks
sidebar using `chrome.sidePanel`.

- User-facing docs: [README.md](README.md)
- Privacy policy (DE/EN): [PRIVACY.md](PRIVACY.md)
- Store copy & promo-image prompts: [dist/store-listing.md](dist/store-listing.md)

NOTE: the manifest `name` is deliberately
**"Dia Bookmarks"** — Dia shows the extension NAME (not the page `<title>`)
as the side-panel header. No `short_name` (some surfaces prefer it over
`name`; leaving it out keeps the header text predictable). The project/repo
keeps the DiaSideBar identity. Tree view with folders, favicons, search,
drag & drop, add/edit dialogs, context menu, inline rename, peek window.

**Killer feature:** bookmarks that are already open in a tab are detected,
get a strong accent outline, appear in an "Open bookmarks" section pinned
above the tree, and a click **jumps to the existing tab** (across windows)
instead of opening a duplicate. Detection is twofold:
1. URL-normalized match against `chrome.tabs.query`, and
2. **tab bindings**: every tab opened FROM a bookmark (click, "Open in new
   tab") is remembered as `tabId → bookmarkId` in `chrome.storage.session` —
   so the connection survives **redirects/subroute navigation** (URL match
   alone would lose it). The SERVICE WORKER maintains them (works with the
   panel closed): `tabs.onReplaced` transfers a binding to the new tabId
   (prerender/instant-navigation swaps the tab on redirects — that's what
   kept killing the connection), `tabs.onRemoved` deletes it. The panel only
   creates bindings (read-merge-write in `bindTab`) and re-reads them on every
   refresh. **Never garbage-collect bindings by diffing against
   `tabs.query()`** — transient gaps deleted live bindings (flickering
   marker); orphans are harmless (tab IDs aren't reused within a session).

## Architecture
- `manifest.json` — MV3. permissions: `bookmarks`, `tabs`, `storage`,
  `sidePanel`, `favicon`. **No** host permissions / content scripts.
- `src/background.js` — three jobs: (1) `sidePanel.setPanelBehavior({openPanelOnActionClick:true})`
  so the toolbar icon toggles the panel (fallback popup window if Dia ever
  lacks the sidePanel API); (2) the **peek window** (like DiaPeek's window
  mode): centered popup ~70 % of the main window, reused if already open,
  auto-closes when focus moves to another window. Its `peekWindowId` lives in
  `chrome.storage.session`, NOT module globals (MV3 idle-kill gotcha, same as
  DiaPeek). Panel sends `{type:'OPEN_PEEK', url}` via `runtime.sendMessage`.
  ⚠️ Auto-close needs BOTH guards: a **grace period** (~1.5 s) after opening —
  Dia fires transient focus events during creation from the side panel that
  instantly closed the window — and a **window-type check** (only a focused
  `type === 'normal'` window closes the peek). (3) **tab-binding maintenance**
  (see killer feature above). Everything else lives in the panel page (full
  chrome.* access, lives while the panel is open).
- `src/sidepanel/sidepanel.{html,css,js}` — the whole app, vanilla JS, no deps.
- `icons/gen-icons.js` — pure-Node PNG encoder (adapted from DiaPeek); run
  `node icons/gen-icons.js` to regenerate 16/32/48/128.

### Key implementation points (sidepanel.js)
- In-memory tree from `bookmarks.getTree()` is the single source of truth;
  re-rendered (debounced) on all `bookmarks.*` / `tabs.*` events.
- **Root folders (Bookmarks Bar, Other Bookmarks) are fixed sections**
  (`rootSection()`, uppercase headers) — always expanded, not toggleable.
  Clicking one only sets it as the target folder.
- **Folders render as wrapper (`.node`) = row + `.children` container** so
  expand/collapse does NOT replace the row — otherwise dblclick-rename breaks.
- **`lastFolderId` = the folder clicked most recently** (folder row, section
  header, or a freshly created folder). It's the default target for the
  add-bookmark dialog and the header new-folder button. Persisted.
- **Quick-add on hover**: folder rows and section headers show a bookmark-plus
  button (`addCurrentTabBtn`) that files the CURRENT tab into that folder —
  only rendered while the active tab's URL is not bookmarked anywhere
  (`state.bookmarkUrls` set, rebuilt in `loadTree`).
- Bookmark single-click is delayed 250 ms so dblclick (rename) can cancel it.
- Inline rename sets `state.editing` → renders are deferred (`pendingRender`)
  until the editor closes, so live updates don't kill the input.
- URL normalization for the open-tab match: http(s) only, strip hash and
  trailing slash, per `normalizeUrl()`.
- Favicons: `chrome.runtime.getURL('/_favicon/?pageUrl=…&size=32')`
  (needs the `favicon` permission); `onerror` falls back to a letter avatar
  (hue hashed from hostname). No external favicon service (privacy).
- Expanded folders / last-clicked folder / open-section collapse state persist
  in `chrome.storage.local` under key `ui`.
- Drop indicators: insert line is a `::after` pseudo-element (straight edges);
  an inset box-shadow followed the row's border-radius and looked curved.

## Peek button + peek-window control bar
The peek hover button / "Open in peek window" menu item open the URL in
DiaSideBar's OWN peek window (see background.js). Inside the peek window,
`src/content-peekbar.js` (content script, `<all_urls>`, top frame) renders a
DiaPeek-style control bar: **Copy URL / Open as tab / Close**, plus **⌥⇧C**
to copy the URL. NOT ⌘⇧C — that is Dia's native "Copy URL" menu accelerator
and cannot be captured from a content script (same finding as in DiaPeek).
History: originally this sent `PEEK_URL` to DiaPeek via `onMessageExternal` +
`chrome.management` ID discovery — **external messaging did not work in Dia**
(user-tested), so DiaSideBar got its own peek window and the `management`
permission was dropped. DiaPeek ≥ 1.0.4 still ships the (unused) handler.

## 🔬 Dia platform findings (verified live on 2026-08-17)
Verified via the localhost-telemetry debug harness (see Build/dev below):
- **Dia embeds userinfo in bookmark URLs** (e.g. `https://newtab@lehmann.link/`,
  apparently created by Dia's own UI). `chrome.tabs.create`/`windows.create`
  REJECT URLs with embedded credentials → clicks silently did nothing.
  → `openableUrl()` strips userinfo before opening; `normalizeUrl()` matches on
  `u.host` and is immune.
- **Dia swaps freshly created tabs**: `tabs.create` returned id A, the page
  ended up in tab id B — with **NO `tabs.onReplaced`**, just remove+create.
  → SW re-attaches young bindings to the successor tab by normalized URL
  (`tryRebind`), and tracks URL changes of bound tabs via `onUpdated`.
- **`chrome.storage.session` is unreliable in Dia's SERVICE WORKER** (works in
  extension pages — verified roundtrip). The peek window's instant self-close
  was caused by grace-period state silently not persisting in the SW.
  → All session-scoped state uses `storage.local`, cleared on
  `runtime.onStartup`/`onInstalled` (`resetSessionState`).
- **`chrome.sidePanel` works in Dia**, `tabs.query` sees all tabs + URLs, the
  side panel is NOT a separate window (windows.getAll → one `normal` window).
- Peek auto-close-on-blur works (verified: popup stayed open >20 s, closed on
  main-window focus). Keep BOTH guards: grace period + window-type check.
- **`bookmarks.move` index semantics:** code passes the visual insertion index
  (counting the dragged item still in place) — Chromium's BookmarkModel
  self-adjusts for same-parent downward moves. Verified in the mock; if a drop
  ever lands one position off in Dia, see the note in `performDrop()`.
- **⌥-click experiment** (Dia native split on `<a>` rows): still unverified.
- **`_favicon` endpoint in Dia:** not explicitly verified; letter-avatar
  fallback covers failure.

## Build / dev
- Load unpacked in Dia: Extensions page → Developer mode → Load unpacked →
  this folder. After code changes: Reload (↻) the extension; the panel page
  must be closed/reopened to pick up JS changes.
- Dev loop without Dia: the panel page can be opened as a normal tab
  (`chrome-extension://<id>/src/sidepanel/sidepanel.html`) — or via the mock
  harness in [dev/harness/](dev/harness/): serve the repo root
  (`python3 -m http.server 8123`) and open
  `http://localhost:8123/dev/harness/test.html`. It loads the REAL
  sidepanel.css/js with stubbed `chrome.*` APIs (sample tree, fake open tabs,
  Chromium `bookmarks.move` semantics). `test.html`'s markup is a copy of
  sidepanel.html's body — keep in sync. Note: `dev/` must be excluded from any
  store zip.
- **Live debugging in real Dia** (claude-in-chrome MCP cannot attach to
  extension pages; this works around it):
  1. Unpacked extension IDs are deterministic:
     sha256 of the absolute path, first 32 hex chars mapped 0→a…f→p. This
     repo path → `knidhokbfmhofemedjahimnanjdlhlgm`.
  2. `sidepanel.html` is in `web_accessible_resources` (initiator-restricted
     to `http://localhost/*`): navigate an MCP tab to `http://localhost:8123/…`,
     then `location.href = 'chrome-extension://<id>/src/sidepanel/sidepanel.html#dbg…'`.
  3. The debug block at the bottom of sidepanel.js (inert without a `#dbg…`
     hash) streams findings as no-cors GETs to `http://localhost:8123/__dbg/…`
     — read them from the dev server's request log. Scenarios: `#dbgenv`
     (environment), `#dbgpeek` (focus events + peek state), `#dbgopen`
     (open/jump flow), `#dbgbind` (redirect binding, self-cleaning).
  4. sidepanel.js/css are re-read from disk on every page load — only
     manifest/background/content-script changes need an extension reload.
  Background-tab timers are heavily throttled in Dia — debug probes can
  arrive batched and late; the event listeners themselves fire on time.

## Publishing (Chrome Web Store)
Complete English store copy (listing, permissions/data form answers, exact
image-asset sizes, ChatGPT prompts for the promo tiles incl. sips crop/resize
commands, packaging notes) lives in [dist/store-listing.md](dist/store-listing.md).
Store name: **Dia Bookmarks**. Package with `bash dist/build.sh` — it stages a
copy, strips the `#dbg…` debug block (no-op `dbg()` stub stays, openInNewTab
calls it) and the `web_accessible_resources` manifest entry, syntax-checks, and
zips to `dist/dia-bookmarks-<version>.zip`. Latest build: 0.1.0 (unpublished).

## Status
V1 feature-complete and live-verified in Dia (killer feature incl. redirects,
peek window + control bar, DnD, search, rename, quick-add). Not yet published;
promo images pending (prompts ready in dist/store-listing.md).
