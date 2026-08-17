# Dia Bookmarks (DiaSideBar)

Chrome-/Chromium-Extension (Manifest V3) für den **Dia-Browser**: ein
vollwertiger Lesezeichen-Manager im **Side Panel** — mit einem Killerfeature:

> **Die Sidebar weiß, welche Lesezeichen schon offen sind.**
> Offene Lesezeichen werden dezent hervorgehoben und oben unter
> „Open bookmarks" angepinnt. Ein Klick springt zum vorhandenen Tab
> (auch über Fenster und Redirects hinweg), statt ein Duplikat zu öffnen.

Schwester-Projekt: [DiaPeek](../DiaPeek) (Link-Peeks statt neuer Tabs).

## Features

- **Baum-Ansicht** mit Ordnern und Zählern; „Bookmarks Bar" und
  „Other Bookmarks" als feste Hauptsektionen
- **Open bookmarks**: offene Lesezeichen oben angepinnt, aktiver Tab extra
  hervorgehoben, Tab-Wechsel schon bei `mousedown`, ✕ schließt den Tab direkt
- **Suche** über Titel und URLs (Esc leert)
- **Drag & Drop**: umsortieren, in Ordner verschieben, Auto-Aufklappen beim
  Ziehen
- **Quick-Add**: Ordner hovern → aktuelle Seite mit einem Klick dort ablegen
  (Button erscheint nur, solange die Seite noch nicht gebookmarkt ist)
- **Add-Dialog** mit Titel/URL des aktiven Tabs vorausgefüllt; neue Lesezeichen
  und Ordner landen im zuletzt angeklickten Ordner
- **Inline-Rename** per Doppelklick, Kontextmenü (Rechtsklick oder ⋯) für
  alles Weitere: Open in new tab, Peek, Copy URL, Edit URL, Delete, …
- **Peek-Fenster**: Lesezeichen in einem schwebenden Fenster ansehen (~70 % des
  Hauptfensters, schließt beim Rausklicken). Steuerleiste mit
  **URL kopieren (auch ⌥⇧C) / Als Tab öffnen / Schließen**
- Favicons über den browserinternen Cache, Letter-Avatar-Fallback
- Light & Dark Mode; Vanilla JS, kein Build-Step, keine Abhängigkeiten,
  kein Tracking ([PRIVACY.md](PRIVACY.md))

## Installation in Dia (Entwicklermodus)

1. In Dia die Erweiterungsseite öffnen (`chrome://extensions` bzw. über das Menü).
2. **Entwicklermodus** oben rechts aktivieren.
3. **„Entpackt laden"** klicken und diesen Ordner (`DiaSideBar/`) auswählen.
4. Nach Code-Änderungen: bei der Extension auf **Neu laden** (↻) klicken; das
   Panel einmal schließen und öffnen.

> Icons liegen unter `icons/` (16/32/48/128 px). Neu generieren:
> `node icons/gen-icons.js` (reines Node, keine Abhängigkeiten).

## Bedienung

| Aktion | Verhalten |
|---|---|
| Klick auf Lesezeichen | offen → zum Tab springen; sonst neuer Tab |
| Doppelklick | umbenennen (inline) |
| ⌘/⌃/⌥/⇧ + Klick | nativ (nicht abgefangen) |
| Hover | Peek-Button, ⋯-Menü, Quick-Add (Ordner) |
| Rechtsklick | Kontextmenü |
| ⌥⇧C (im Peek-Fenster) | URL kopieren |

## Architektur (Kurzform)

- `src/sidepanel/` — die gesamte App (eine Seite): Baum, Suche, DnD, Menüs,
  Dialoge, Open-Tab-Erkennung (URL-normalisierter Abgleich **plus**
  Tab-Bindings, damit Redirects die Zuordnung nicht zerreißen)
- `src/background.js` — Service Worker: Panel-Verhalten, Peek-Fenster
  (Auto-Close bei Fokusverlust), Pflege der Tab-Bindings (überlebt
  Prerender-/Tab-Swaps, auch bei geschlossenem Panel)
- `src/content-peekbar.js` — Steuerleiste im eigenen Peek-Fenster (auf allen
  anderen Seiten inaktiv)

Dia-spezifische Erkenntnisse (Userinfo in Bookmark-URLs, Tab-Swap ohne
`onReplaced`, `storage.session`-Eigenheiten u. a.) sind in
[CLAUDE.md](CLAUDE.md) dokumentiert — lesenswert vor Änderungen.

## Entwicklung & Build

- **Mock-Harness** (Panel ohne Dia testen): `python3 -m http.server 8123` im
  Repo-Root, dann <http://localhost:8123/dev/harness/test.html> — echtes
  CSS/JS mit gestubbten `chrome.*`-APIs.
- **Store-Paket bauen**: `bash dist/build.sh` → `dist/dia-bookmarks-<version>.zip`
  (entfernt automatisch die Dev-Bestandteile).
- Store-Texte, Formular-Antworten und Prompts für die Promo-Grafiken:
  [dist/store-listing.md](dist/store-listing.md).
