# Dia Bookmarks — Chrome Web Store Listing

All copy in English. Fill-in source for the CWS developer dashboard.

---

## 1. Store listing

**Name:** Dia Bookmarks

**Short description** (≤132 chars):
> Bookmarks sidebar for Dia: search, drag & drop, peek windows — and jump to already-open tabs instead of opening duplicates.

**Category:** Productivity → Tools

**Detailed description:**

> **Your bookmarks, one peek away.**
>
> Dia Bookmarks puts a full bookmarks manager into Dia's side panel — with one killer feature: it always knows which of your bookmarks are already open.
>
> **Already open? Jump there.**
> Bookmarks that are open in a tab are highlighted and pinned to an "Open bookmarks" section at the top of the panel. Clicking them switches to the existing tab — even across windows, even after the page redirected — instead of opening yet another duplicate. The currently active tab is emphasized, and you can close tabs right from the panel.
>
> **A real bookmarks manager.**
> • Full folder tree with item counts; Bookmarks Bar and Other Bookmarks as fixed sections
> • Instant search across titles and URLs
> • Drag & drop to reorder or move bookmarks and folders (folders auto-expand while dragging)
> • Double-click to rename inline, context menu for everything else (edit URL, copy URL, delete, …)
> • Quick add: hover any folder and file the current page there with one click — the button only appears while the page isn't bookmarked yet
> • Add dialog pre-filled with the current tab's title and URL
>
> **Peek before you commit.**
> Open any bookmark in a Peek — a floating window that closes by itself when you click back into your browser. A small control bar lets you copy the URL (also ⌥⇧C), promote the page to a real tab, or close it.
>
> **Fast and private.**
> No build, no frameworks, no accounts, no tracking. Everything runs locally in your browser; the extension never reads, stores, or transmits page content or browsing data. Light and dark mode included.
>
> Built for The Browser Company's Dia browser. Works best together with its sibling extension DiaPeek.

---

## 2. Store data & permissions form (English answers)

**Single purpose:** A bookmarks manager in the browser side panel that also detects which bookmarks are already open in tabs. All permissions serve only this purpose.

**Permission justifications:**
- `bookmarks` — read and edit the bookmark tree that the panel displays and manages (create, rename, move, delete).
- `tabs` — detect which bookmarks are already open, switch to the existing tab instead of opening a duplicate, and open bookmarks in new tabs.
- `storage` — persist UI state (expanded folders, last-used folder, open-tab associations) locally on the device.
- `sidePanel` — render the bookmarks manager in the browser's side panel.
- `favicon` — display site icons via the browser's internal favicon cache; no external favicon service is contacted.
- Host permission `<all_urls>` (content script) — used exclusively to render a small control bar (copy URL / open as tab / close) inside the extension's OWN peek window and to provide the ⌥⇧C copy shortcut there. The content script does nothing on any other page. No page content is read, stored, or transmitted.

**Remote code:** No (all JavaScript is bundled; no eval, no external scripts).

**Data collected:** None (locally stored settings are not collected user data). Confirm all three data-use certifications.

**Privacy policy:** done — [../PRIVACY.md](../PRIVACY.md) (DE/EN). Host it at a public URL (e.g. the GitHub repo's PRIVACY.md) and paste that URL into the data form.

---

## 3. Required image assets (exact sizes)

| Asset | Exact size | Required? |
|---|---|---|
| Store icon | 128×128 px | Yes — already done: `icons/icon128.png` |
| Screenshots (1–5) | 1280×800 px (or 640×400) | Yes, at least 1 |
| Small promo tile | 440×280 px | Strongly recommended (featuring) |
| Marquee promo tile | 1400×560 px | Optional (large featuring) |

Screenshots should be REAL panel screenshots (framed at 1280×800), not AI renders —
use the DiaPeek pipeline: HTML mock → chrome-headless-shell → exact-size PNG.

---

## 4. ChatGPT prompts for the promo images

⚠️ Image models cannot output exact pixel sizes. Recipe per asset: generate at the
closest ratio ChatGPT offers (landscape 1536×1024), then crop + resize locally
(commands below). Keep all important content in the center; leave generous
margins. Short text usually renders fine — still, check spelling and regenerate
if garbled, or ask for a version without text and set type afterwards.

### 4a. Small promo tile — final size 440×280 (ratio 11:7)

Paste into ChatGPT:

> Create a landscape promotional tile for a browser extension called "Dia Bookmarks".
> Style: flat, minimal, modern vector illustration. Background: deep violet (#7C5CE8) with a very subtle darker-violet radial gradient.
> Center-left: a large white bookmark ribbon icon (rounded corners, flat, no gloss) — a rectangle with a triangular notch cut into the bottom edge.
> Center-right: the text "Dia Bookmarks" in a clean white geometric sans-serif, and below it in smaller, semi-transparent white text: "Your bookmarks, one peek away."
> No other elements, no browser chrome, no drop shadows, no 3D. Generous empty margins on all sides — nothing may touch the edges.
> Landscape orientation, 3:2.

Post-process to exactly 440×280 (crop 1536×1024 → center band 1536×977, then scale):

```bash
cd ~/Downloads && cp <chatgpt-file>.png tile-raw.png && sips -c 977 1536 tile-raw.png --out tile-crop.png && sips -z 280 440 tile-crop.png --out promo-small-440x280.png
```

### 4b. Marquee promo tile — final size 1400×560 (ratio 2.5:1)

Paste into ChatGPT:

> Create a wide landscape marketing banner for a browser extension called "Dia Bookmarks".
> Style: flat, minimal, modern vector illustration. Background: deep violet (#7C5CE8), subtle gradient to a slightly darker violet at the edges.
> Left third: the headline "Dia Bookmarks" in bold white geometric sans-serif with the subline "Know what's open. Jump, don't duplicate." in smaller semi-transparent white.
> Right two thirds: a simplified dark-mode sidebar UI mockup (rounded rectangle, near-black #1d1d20): a narrow panel with 5–6 rows; each row = small colored square favicon + grey text bar. The top two rows are highlighted with a translucent violet tint, and one of them has a thin violet accent edge on its left side. Above those rows a tiny uppercase label bar reading "OPEN BOOKMARKS". A white bookmark ribbon icon sits in the panel's corner.
> Flat design, no 3D, no gloss, no drop shadows, no real browser chrome. All content well inside a central safe zone — the outer 10% on every side stays background only.
> Very wide landscape orientation.

Post-process to exactly 1400×560 (crop the 1536×1024 center band to 2.5:1, then scale):

```bash
cd ~/Downloads && cp <chatgpt-file>.png marquee-raw.png && sips -c 614 1536 marquee-raw.png --out marquee-crop.png && sips -z 560 1400 marquee-crop.png --out promo-marquee-1400x560.png
```

Tip for both: if the text comes out garbled, append — "Render the texts exactly as
written, letter by letter. If unsure, leave the text area empty." — and add the
type later on top of the clean background.

---

## 5. Packaging notes (before upload)

- Zip only: `manifest.json`, `src/`, `icons/*.png` — exclude `dev/`, `dist/`,
  `CLAUDE.md`, `icons/gen-icons.js`.
- Before the store build, strip the dev-only parts: the `#dbg…` debug block at
  the bottom of `src/sidepanel/sidepanel.js` and the `web_accessible_resources`
  entry in the manifest (both are localhost-only and inert, but they invite
  reviewer questions).
- `zip -rX dist/dia-bookmarks-<version>.zip manifest.json src icons -x 'icons/gen-icons.js'`
