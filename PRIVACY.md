# Dia Bookmarks — Datenschutzerklärung / Privacy Policy

_Stand / Last updated: 2026-08-17_

## Deutsch

**Dia Bookmarks erhebt, speichert, überträgt und verkauft keine personenbezogenen Daten.**

Dia Bookmarks zeigt deine Lesezeichen als Seitenleiste (Side Panel) im Browser
an: mit Ordnern, Suche, Drag & Drop und einer Vorschau („Peek") in einem
eigenen Fenster. Lesezeichen, die bereits in einem Tab geöffnet sind, werden
hervorgehoben — ein Klick wechselt zum vorhandenen Tab, statt einen neuen zu
öffnen.

**Datenverarbeitung**
- Deine Lesezeichen werden über die Lesezeichen-API des Browsers gelesen und
  bearbeitet (anlegen, umbenennen, verschieben, löschen). Das geschieht
  ausschließlich lokal im Browser; die Erweiterung überträgt keine Lesezeichen
  an Dritte.
- Um geöffnete Lesezeichen zu erkennen, vergleicht die Erweiterung die URLs
  deiner offenen Tabs lokal mit deinen Lesezeichen. Diese URLs werden weder
  protokolliert noch versendet.
- Favicons werden über den internen Favicon-Speicher des Browsers angezeigt;
  es wird kein externer Favicon-Dienst kontaktiert.
- Gespeichert wird nur der Oberflächen-Zustand (z. B. aufgeklappte Ordner,
  zuletzt genutzter Ordner, die Zuordnung „Lesezeichen ↔ geöffneter Tab")
  über die Chrome-Speicher-API — lokal auf deinem Gerät. Diese Daten
  verlassen deinen Browser nicht.
- Dia Bookmarks enthält keine Analyse, kein Tracking und keine Server von
  Drittanbietern.

**Berechtigungen**
- `bookmarks`: um deine Lesezeichen anzuzeigen und zu verwalten.
- `tabs`: um geöffnete Lesezeichen zu erkennen, zum vorhandenen Tab zu wechseln
  und Lesezeichen in Tabs zu öffnen.
- `storage`: um den Oberflächen-Zustand lokal zu speichern.
- `sidePanel`: um die Seitenleiste darzustellen.
- `favicon`: um Seitensymbole aus dem browserinternen Speicher anzuzeigen.
- Host-Zugriff (`<all_urls>`): ausschließlich, um im **eigenen Peek-Fenster**
  der Erweiterung eine kleine Steuerleiste (URL kopieren / als Tab öffnen /
  schließen) anzuzeigen. Auf allen anderen Seiten tut das zugehörige Skript
  nichts; Seiteninhalte werden nicht gelesen, gespeichert oder übertragen.

Dia Bookmarks verwendet keinen Remote-Code; der gesamte Code ist im
Erweiterungspaket enthalten.

**Kontakt:** ll@stadtlandnetz.de

---

## English

**Dia Bookmarks does not collect, store, transmit, or sell any personal data.**

Dia Bookmarks shows your bookmarks in the browser's side panel — with folders,
search, drag & drop, and a preview ("Peek") in its own window. Bookmarks that
are already open in a tab are highlighted; clicking them switches to the
existing tab instead of opening a duplicate.

**Data handling**
- Your bookmarks are read and edited through the browser's bookmarks API
  (create, rename, move, delete). This happens entirely locally in your
  browser; the extension never transmits bookmarks to anyone.
- To detect open bookmarks, the extension compares the URLs of your open tabs
  with your bookmarks — locally. These URLs are never logged or transmitted.
- Favicons are displayed via the browser's internal favicon cache; no external
  favicon service is contacted.
- The extension only stores UI state (e.g. expanded folders, last-used folder,
  the association "bookmark ↔ open tab") using Chrome's storage API — locally
  on your device. This data never leaves your browser.
- Dia Bookmarks contains no analytics, tracking, or third-party servers.

**Permissions**
- `bookmarks`: to display and manage your bookmarks.
- `tabs`: to detect open bookmarks, switch to the existing tab, and open
  bookmarks in tabs.
- `storage`: to save UI state locally.
- `sidePanel`: to render the side panel.
- `favicon`: to show site icons from the browser's internal cache.
- Host access (`<all_urls>`): used exclusively to render a small control bar
  (copy URL / open as tab / close) inside the extension's **own peek window**.
  On every other page the corresponding script does nothing; no page content
  is read, stored, or transmitted.

Dia Bookmarks uses no remote code; all code ships inside the extension package.

**Contact:** ll@stadtlandnetz.de
