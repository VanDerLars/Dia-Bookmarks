// DiaSideBar — Side-Panel-App
// Rendert den Bookmark-Baum, hält ihn live (bookmarks.*-Events), markiert
// bereits offene Lesezeichen (tabs.*-Events) und bietet Suche, Drag & Drop,
// Kontextmenü, Inline-Rename und Add/Edit-Dialoge.
//
// Killerfeature: Klick auf ein bereits offenes Lesezeichen springt zum
// bestehenden Tab (auch über Fenster hinweg) statt einen neuen zu öffnen;
// offene Lesezeichen erscheinen zusätzlich oben unter "Open bookmarks".

'use strict';

const $ = (sel) => document.querySelector(sel);

// ---------------------------------------------------------------- State ----
const state = {
  roots: [], // Top-Level-Folder (Kinder der Wurzel "0")
  nodesById: new Map(), // id → Knoten (inkl. parentId/index)
  expanded: new Set(), // aufgeklappte Folder-IDs (persistiert)
  openMap: new Map(), // normalisierte URL → [{tabId, windowId}]
  openTabsById: new Map(), // tabId → {tabId, windowId}
  tabBindings: new Map(), // tabId → bookmarkId: aus einem Lesezeichen geöffnete
  // Tabs bleiben ihm zugeordnet, auch wenn die Seite redirected (Subroute o. Ä.)
  bookmarkUrls: new Set(), // normalisierte URLs aller Lesezeichen
  activeTab: null, // aktiver Tab des Panel-Fensters (fürs Schnell-Hinzufügen)
  query: '',
  lastFolderId: null, // zuletzt ANGEKLICKTER Folder = Ziel für Neues (persistiert)
  openCollapsed: false, // "Open bookmarks"-Sektion eingeklappt (persistiert)
  editing: false, // Inline-Rename aktiv → Re-Render aufschieben
  pendingRender: false,
  drag: null, // { id } des gezogenen Knotens
  prevOpenIds: null, // offene Bookmark-IDs des letzten Renders (für Animationen)
  justOpened: new Set(), // in DIESEM Render neu offen → kurz animieren
};

// ---------------------------------------------------------- Persistenz ----
async function loadUiState() {
  const { ui } = await chrome.storage.local.get('ui');
  if (!ui) return false;
  state.expanded = new Set(ui.expanded || []);
  state.lastFolderId = ui.lastFolderId || null;
  state.openCollapsed = !!ui.openCollapsed;
  return true;
}

function saveUiState() {
  chrome.storage.local.set({
    ui: {
      expanded: [...state.expanded],
      lastFolderId: state.lastFolderId,
      openCollapsed: state.openCollapsed,
    },
  });
}

// ---------------------------------------------------------------- Baum ----
async function loadTree() {
  const [root] = await chrome.bookmarks.getTree();
  state.roots = root.children || [];
  state.nodesById.clear();
  state.bookmarkUrls.clear();
  const walk = (n) => {
    state.nodesById.set(n.id, n);
    if (n.url) state.bookmarkUrls.add(normalizeUrl(n.url));
    (n.children || []).forEach(walk);
  };
  state.roots.forEach(walk);
}

function bookmarkCount(folder) {
  let c = 0;
  for (const ch of folder.children || []) c += ch.url ? 1 : bookmarkCount(ch);
  return c;
}

function totalCount() {
  return state.roots.reduce((s, r) => s + bookmarkCount(r), 0);
}

function isRoot(node) {
  return node.parentId === '0' || node.parentId == null;
}

// "Other Bookmarks" (bzw. der zweite Root-Folder) als Default-Ziel.
function defaultFolderId() {
  const other = state.roots.find((r) => r.folderType === 'other');
  if (other) return other.id;
  return (state.roots[1] || state.roots[0] || { id: '2' }).id;
}

function isDescendantOf(id, ancestorId) {
  let cur = state.nodesById.get(id);
  while (cur && cur.parentId != null) {
    if (cur.parentId === ancestorId) return true;
    cur = state.nodesById.get(cur.parentId);
  }
  return false;
}

// ---------------------------------------------------- URL-Normalisierung ----
// Für den Offen-Abgleich: nur http(s). Schema (http/https gleich), führendes
// "www.", Hash und Trailing-Slash werden ignoriert — Sites "redirecten" gern
// auf diese Varianten, ohne dass es ein inhaltlich anderes Ziel ist. Port
// bleibt erhalten (localhost:3000 ≠ localhost:8080).
function normalizeUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return raw;
    let s = u.host.replace(/^www\./, '') + u.pathname + u.search;
    if (s.endsWith('/')) s = s.slice(0, -1);
    return s;
  } catch (e) {
    return raw;
  }
}

// Dia bettet in Bookmark-URLs teils Userinfo ein (z. B. https://newtab@host/).
// chrome.tabs.create/windows.create VERWEIGERN URLs mit eingebetteten
// Credentials (Rejection!) — vor jedem Öffnen strippen. (normalizeUrl ist
// davon unabhängig immun: sie nutzt u.host, nie die Userinfo.)
function openableUrl(raw) {
  try {
    const u = new URL(raw);
    if ((u.protocol === 'http:' || u.protocol === 'https:') && (u.username || u.password)) {
      u.username = '';
      u.password = '';
      return u.href;
    }
  } catch (e) {
    /* unparsebar → unverändert lassen */
  }
  return raw;
}

// ------------------------------------------------------- Offene Tabs ----
// Tab-Bindings leben in chrome.storage.LOCAL (chrome.storage.session war in
// Dia unzuverlässig; der SW leert die Keys bei Browserstart/Reload — Tab-IDs
// gelten ohnehin nur pro Sitzung). Der SERVICE WORKER pflegt sie
// (onReplaced-Transfer bei Prerender-Redirects, onRemoved-Löschung) — das
// Panel legt sie nur an und liest sie. Deshalb: vor jedem Schreiben und bei
// jedem Refresh frisch aus dem Storage lesen, nie blind überschreiben.
// Binding-Format: tabId → {b: bookmarkId, u: normalisierte URL, t: Timestamp}.
// u/t braucht der SW für das Re-Attach nach Dias Tab-Swap (remove+create).
async function loadBindings() {
  try {
    const { tabBindings = {} } = await chrome.storage.local.get('tabBindings');
    state.tabBindings = new Map(
      Object.entries(tabBindings).map(([k, v]) => [
        Number(k),
        typeof v === 'string' ? { b: v, u: null, t: 0 } : v, // Altformat tolerieren
      ])
    );
  } catch (e) {
    state.tabBindings = new Map();
  }
}

async function bindTab(tabId, node) {
  await loadBindings(); // SW könnte zwischenzeitlich transferiert/gelöscht haben
  state.tabBindings.set(tabId, { b: node.id, u: normalizeUrl(node.url), t: Date.now() });
  const obj = {};
  for (const [k, v] of state.tabBindings) obj[k] = v;
  try {
    chrome.storage.local.set({ tabBindings: obj });
  } catch (e) {
    /* Storage nicht verfügbar */
  }
}

async function refreshOpenMap() {
  await loadBindings(); // Transfers/Löschungen des SW übernehmen
  const tabs = await chrome.tabs.query({});
  state.openMap.clear();
  state.openTabsById.clear();
  for (const t of tabs) {
    if (t.id == null) continue;
    state.openTabsById.set(t.id, { tabId: t.id, windowId: t.windowId });
    if (!t.url) continue;
    const k = normalizeUrl(t.url);
    if (!state.openMap.has(k)) state.openMap.set(k, []);
    state.openMap.get(k).push({ tabId: t.id, windowId: t.windowId });
  }
  // KEIN Aufräumen über tabs.query-Abgleich: transiente Lücken (Prerender-
  // Swap, Dia-Eigenheiten) löschten Bindings fälschlich → Marker "flackerte"
  // und die Verbindung ging verloren. Löschen macht nur noch der SW bei
  // tabs.onRemoved; Waisen sind harmlos (matchen nie eine lebende tabId).
  // Aktiven Tab merken (Quick-Add-Button an Foldern).
  try {
    let [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!active) [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    state.activeTab = active || null;
  } catch (e) {
    state.activeTab = null;
  }
}

// Offen = per URL gematcht ODER per Binding (Tab wurde aus diesem Lesezeichen
// geöffnet und darf seitdem redirected sein).
function openTabFor(node) {
  for (const [tabId, rec] of state.tabBindings) {
    if (rec && rec.b === node.id) {
      const t = state.openTabsById.get(tabId);
      if (t) return t;
    }
  }
  const hits = state.openMap.get(normalizeUrl(node.url));
  return hits && hits.length ? hits[0] : null;
}

function isOpenNode(node) {
  return !!openTabFor(node);
}

// Klick-Verhalten: offen → zum Tab springen; sonst neuer Tab (mit Binding).
async function openBookmark(node) {
  const hit = openTabFor(node);
  if (hit) {
    try {
      await chrome.tabs.update(hit.tabId, { active: true });
      await chrome.windows.update(hit.windowId, { focused: true });
      return;
    } catch (e) {
      /* Tab existiert nicht mehr → normal öffnen */
    }
  }
  await openInNewTab(node);
}

async function openInNewTab(node) {
  try {
    const tab = await chrome.tabs.create({ url: openableUrl(node.url) });
    if (tab && tab.id != null) await bindTab(tab.id, node);
  } catch (e) {
    dbg('create-err', { url: node.url, m: e && e.message });
    console.warn('[DiaSideBar] tabs.create fehlgeschlagen:', node.url, e);
  }
}

// ---------------------------------------------------------------- Peek ----
// Öffnet die URL im Peek-Fenster (wie DiaPeeks Window-Mode). Die Fenster-
// Lebensdauer verwaltet der Service Worker (Auto-Close bei Fokusverlust).
function openPeek(url) {
  try {
    chrome.runtime.sendMessage({ type: 'OPEN_PEEK', url: openableUrl(url) });
  } catch (e) {
    /* SW nicht erreichbar → nichts tun */
  }
}

// -------------------------------------------------------------- Icons ----
const I = {
  chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  peek: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="3.5" width="19" height="17" rx="2"/><rect x="8" y="8.5" width="10" height="8" rx="1.5" fill="currentColor" stroke="none" opacity="0.45"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
  openNew: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>',
  bookmarkPlus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/><line x1="12" y1="7" x2="12" y2="13"/><line x1="9" y1="10" x2="15" y2="10"/></svg>',
  folderPlus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>',
};

function svg(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstChild;
}

function iconBtn(title, iconHtml) {
  const b = document.createElement('button');
  b.className = 'iconbtn';
  b.title = title;
  b.append(svg(iconHtml));
  return b;
}

// ------------------------------------------------------------ Favicons ----
// Chromes interner _favicon-Endpoint (Permission "favicon"); bei Fehlern
// Letter-Avatar aus der Domain. Kein externer Dienst (Privacy).
function faviconEl(url) {
  const img = document.createElement('img');
  img.className = 'favicon';
  img.alt = '';
  img.src = chrome.runtime.getURL('/_favicon/?pageUrl=' + encodeURIComponent(url) + '&size=32');
  img.addEventListener('error', () => img.replaceWith(letterAvatar(url)), { once: true });
  return img;
}

function letterAvatar(url) {
  const span = document.createElement('span');
  span.className = 'favicon letter';
  let ch = '?';
  let hue = 220;
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    ch = (host[0] || '?').toUpperCase();
    let h = 0;
    for (const c of host) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    hue = h % 360;
  } catch (e) {
    /* kaputte URL → "?" */
  }
  span.textContent = ch;
  span.style.background = `hsl(${hue} 45% 45%)`;
  return span;
}

// ------------------------------------------------------------- Render ----
function render() {
  if (state.editing) {
    state.pendingRender = true;
    return;
  }
  // Nur NEU geöffnete Lesezeichen animieren — das Panel rendert bei jedem
  // Event komplett neu, sonst würde bei jedem Re-Render alles pulsieren.
  // Beim allerersten Render (prevOpenIds null) wird nichts animiert.
  const openNow = new Set(collectOpenBookmarks().map((n) => n.id));
  state.justOpened = state.prevOpenIds
    ? new Set([...openNow].filter((id) => !state.prevOpenIds.has(id)))
    : new Set();
  state.prevOpenIds = openNow;

  const scroller = $('#scroll');
  const st = scroller.scrollTop;
  renderOpenSection();
  renderTree();
  $('#count').textContent = `Bookmarks: ${totalCount()}`;
  scroller.scrollTop = st;

  // Nach dem synchronen Render leeren: In-Place-Aufklappen von Foldern
  // (toggleFolder) soll bereits offene Rows nicht nachträglich animieren.
  state.justOpened = new Set();
}

function collectOpenBookmarks() {
  const out = [];
  const seen = new Set();
  const walk = (n) => {
    if (n.url) {
      if (isOpenNode(n) && !seen.has(n.id)) {
        seen.add(n.id);
        out.push(n);
      }
    } else {
      (n.children || []).forEach(walk);
    }
  };
  state.roots.forEach(walk);
  return out;
}

function renderOpenSection() {
  const section = $('#open-section');
  const list = $('#open-list');
  const open = state.query ? [] : collectOpenBookmarks();
  section.classList.toggle('hidden', open.length === 0);
  section.classList.toggle('expanded', !state.openCollapsed);
  $('#open-count').textContent = String(open.length);
  list.classList.toggle('hidden', state.openCollapsed);
  list.textContent = '';
  if (state.openCollapsed) return;
  for (const n of open) list.append(bookmarkRow(n, 0, { noDrag: true, closeOnly: true }));
}

function renderTree() {
  const tree = $('#tree');
  tree.textContent = '';
  let empty = false;

  if (state.query) {
    const results = searchResults(state.query);
    for (const n of results) tree.append(bookmarkRow(n, 0, { noDrag: true }));
    empty = results.length === 0;
  } else {
    // Root-Folder (Bookmarks Bar, Other Bookmarks) sind feste Hauptsektionen —
    // immer aufgeklappt, nicht toggelbar.
    for (const r of state.roots) {
      tree.append(rootSection(r));
      const kids = r.children || [];
      if (kids.length === 0) {
        const e = document.createElement('div');
        e.className = 'empty';
        e.style.setProperty('--depth', 0);
        e.textContent = 'Empty folder';
        tree.append(e);
      } else {
        for (const ch of kids) tree.append(renderNode(ch, 0));
      }
    }
    empty = state.roots.every((r) => (r.children || []).length === 0);
  }
  $('#empty-state').classList.toggle('hidden', !empty);
}

function rootSection(node) {
  const h = document.createElement('div');
  h.className = 'section-header root-section';
  h.dataset.id = node.id;

  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = node.title || 'Bookmarks';

  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = String(bookmarkCount(node));

  const actions = document.createElement('span');
  actions.className = 'actions';
  const quickAdd = addCurrentTabBtn(node.id);
  if (quickAdd) actions.append(quickAdd);
  const more = iconBtn('More actions', I.more);
  more.addEventListener('click', (e) => {
    e.stopPropagation();
    openMenu(more, node);
  });
  actions.append(more);

  h.append(label, badge, actions);

  h.addEventListener('click', (e) => {
    if (e.target.closest('.iconbtn')) return;
    setLastFolder(node.id);
  });
  h.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openMenuAt(e.clientX, e.clientY, node);
  });
  addDndHandlers(h, node);
  return h;
}

function setLastFolder(id) {
  state.lastFolderId = id;
  saveUiState();
}

// Quick-Add: aktuellen Tab per Hover-Button direkt in diesen Folder legen —
// nur wenn die Seite noch nirgends gebookmarkt ist.
function addCurrentTabBtn(folderId) {
  const t = state.activeTab;
  if (!t || !t.url || !/^https?:/i.test(t.url)) return null;
  if (state.bookmarkUrls.has(normalizeUrl(t.url))) return null;
  const b = iconBtn('Bookmark current tab here', I.bookmarkPlus);
  b.classList.add('quick-add');
  b.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Frisch nachschlagen (Titel/URL können sich seit dem Render geändert haben).
    let tab = t;
    try {
      const [fresh] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (fresh && fresh.url && /^https?:/i.test(fresh.url)) tab = fresh;
    } catch (err) {
      /* Render-Stand verwenden */
    }
    setLastFolder(folderId);
    state.expanded.add(folderId);
    saveUiState();
    await chrome.bookmarks.create({
      parentId: folderId,
      title: tab.title || tab.url,
      url: tab.url,
    });
  });
  return b;
}

function searchResults(q) {
  const out = [];
  const walk = (n) => {
    if (n.url) {
      if (
        (n.title || '').toLowerCase().includes(q) ||
        n.url.toLowerCase().includes(q)
      ) {
        out.push(n);
      }
    } else {
      (n.children || []).forEach(walk);
    }
  };
  state.roots.forEach(walk);
  return out;
}

// Folder werden in einen Wrapper gerendert (Row + Children-Container), damit
// Auf-/Zuklappen die Row NICHT ersetzt — sonst bricht der Doppelklick (Rename).
function renderNode(node, depth) {
  if (node.url) return bookmarkRow(node, depth);

  const wrap = document.createElement('div');
  wrap.className = 'node';
  wrap.dataset.wrapId = node.id;
  wrap.append(folderRow(node, depth));
  if (state.expanded.has(node.id)) wrap.append(childrenEl(node, depth));
  return wrap;
}

function childrenEl(node, depth) {
  const box = document.createElement('div');
  box.className = 'children';
  const kids = node.children || [];
  if (kids.length === 0) {
    const e = document.createElement('div');
    e.className = 'empty';
    e.style.setProperty('--depth', depth);
    e.textContent = 'Empty folder';
    box.append(e);
  } else {
    for (const ch of kids) box.append(renderNode(ch, depth + 1));
  }
  return box;
}

function toggleFolder(node, wrap) {
  const row = wrap.querySelector(':scope > .row');
  const kids = wrap.querySelector(':scope > .children');
  if (state.expanded.has(node.id)) {
    state.expanded.delete(node.id);
    row.classList.remove('expanded');
    if (kids) kids.remove();
  } else {
    state.expanded.add(node.id);
    row.classList.add('expanded');
    const depth = parseInt(row.style.getPropertyValue('--depth'), 10) || 0;
    if (!kids) wrap.append(childrenEl(node, depth));
  }
  saveUiState();
}

function expandFolderInPlace(id) {
  if (state.expanded.has(id)) return;
  const node = state.nodesById.get(id);
  const wrap = $(`#tree [data-wrap-id="${CSS.escape(id)}"]`);
  if (node && wrap) toggleFolder(node, wrap);
}

function folderRow(node, depth) {
  const row = document.createElement('div');
  row.className = 'row folder';
  row.dataset.id = node.id;
  row.style.setProperty('--depth', depth);
  row.draggable = true; // Roots landen nie hier (rootSection)
  if (state.expanded.has(node.id)) row.classList.add('expanded');

  const chev = document.createElement('span');
  chev.className = 'chevron';
  chev.append(svg(I.chevron));
  const fic = document.createElement('span');
  fic.className = 'foldericon';
  fic.append(svg(I.folder));

  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = node.title || 'Untitled';

  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = String(bookmarkCount(node));

  const actions = document.createElement('span');
  actions.className = 'actions';
  const quickAdd = addCurrentTabBtn(node.id);
  if (quickAdd) actions.append(quickAdd);
  const more = iconBtn('More actions', I.more);
  more.addEventListener('click', (e) => {
    e.stopPropagation();
    openMenu(more, node);
  });
  actions.append(more);

  row.append(chev, fic, label, badge, actions);

  row.addEventListener('click', (e) => {
    if (e.target.closest('.iconbtn') || e.target.closest('.rename')) return;
    setLastFolder(node.id); // zuletzt angeklickter Folder = Ziel für Neues
    toggleFolder(node, row.parentElement);
  });
  row.addEventListener('dblclick', (e) => {
    if (e.target.closest('.iconbtn')) return;
    e.preventDefault();
    startRename(row, node);
  });
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openMenuAt(e.clientX, e.clientY, node);
  });
  addDndHandlers(row, node);
  return row;
}

function bookmarkRow(node, depth, opts = {}) {
  // Echtes <a>: Modifier-Klicks (⌘/⌃/⌥/Shift) laufen nativ durch — u. a. das
  // ⌥-Klick-Experiment für Dias nativen Split. Plain-Klick handeln wir selbst.
  const a = document.createElement('a');
  a.className = 'row bookmark';
  a.href = openableUrl(node.url); // native Modifier-Klicks scheitern sonst an Userinfo-URLs
  a.dataset.id = node.id;
  a.title = (node.title ? node.title + '\n' : '') + node.url;
  a.style.setProperty('--depth', depth);
  a.draggable = !state.query && !opts.noDrag;
  const openHit = openTabFor(node);
  if (openHit) {
    a.classList.add('open');
    // Aktiver Tab in der "Open bookmarks"-Sektion: stärker hervorheben.
    if (opts.closeOnly && state.activeTab && openHit.tabId === state.activeTab.id) {
      a.classList.add('active-tab');
    }
    // Neu offen: Open-Sektion-Row gleitet ein, Baum-Row pulst nur (die Row
    // selbst stand ja schon da — nur ihr Zustand ist neu).
    if (state.justOpened.has(node.id)) {
      a.classList.add(opts.closeOnly ? 'just-open-in' : 'just-open');
    }
  }

  a.append(faviconEl(node.url));

  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = node.title || node.url;
  a.append(label);

  const actions = document.createElement('span');
  actions.className = 'actions';
  if (opts.closeOnly) {
    // "Open bookmarks"-Sektion: on hover nur ein Close-Button (schließt den Tab).
    const close = iconBtn('Close tab', I.close);
    close.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const hit = openTabFor(node);
      if (hit) chrome.tabs.remove(hit.tabId).catch(() => {});
    });
    actions.append(close);
  } else {
    const peek = iconBtn('Open in peek window', I.peek);
    peek.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openPeek(node.url);
    });
    const more = iconBtn('More actions', I.more);
    more.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openMenu(more, node);
    });
    actions.append(peek, more);
  }
  a.append(actions);

  // Tab-Wechsel so früh wie möglich: In der Open-Sektion (nicht draggable)
  // schon bei mousedown springen. Baum-Rows nicht — dort feuert mousedown
  // auch beim Drag-Start.
  let downJumped = false;
  if (opts.closeOnly) {
    a.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.target.closest('.iconbtn') || e.target.closest('.rename')) return;
      if (openTabFor(node)) {
        downJumped = true;
        openBookmark(node);
      }
    });
  }

  // Klick: offene Lesezeichen springen SOFORT (kein Doppelklick-Delay nötig —
  // der Sprung ist idempotent, Rename per Doppelklick geht danach trotzdem).
  // Nicht-offene öffnen mit kurzer Verzögerung, damit ein Doppelklick (Rename)
  // den Einfachklick (neuen Tab) abfangen kann.
  let clickTimer = null;
  a.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return; // nativ lassen
    if (e.target.closest('.iconbtn') || e.target.closest('.rename')) {
      e.preventDefault();
      return;
    }
    e.preventDefault();
    if (downJumped) {
      downJumped = false; // mousedown hat schon gehandelt
      return;
    }
    if (e.detail !== 1) return;
    if (openTabFor(node)) {
      openBookmark(node);
      return;
    }
    clickTimer = setTimeout(() => {
      clickTimer = null;
      openBookmark(node);
    }, 250);
  });
  a.addEventListener('dblclick', (e) => {
    if (e.target.closest('.iconbtn') || e.target.closest('.rename')) return;
    e.preventDefault();
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
    }
    startRename(a, node);
  });
  a.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openMenuAt(e.clientX, e.clientY, node);
  });
  if (!opts.noDrag) addDndHandlers(a, node);
  return a;
}

// ------------------------------------------------------ Inline-Rename ----
function startRename(row, node) {
  if (state.editing) return;
  state.editing = true;
  const label = row.querySelector('.label');
  const input = document.createElement('input');
  input.className = 'rename';
  input.type = 'text';
  input.value = node.title || '';
  const wasDraggable = row.draggable;
  row.draggable = false;
  label.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    state.editing = false;
    const v = input.value.trim();
    if (save && v && v !== node.title) {
      // bookmarks.update löst onChanged aus → Baum lädt neu und rendert.
      chrome.bookmarks.update(node.id, { title: v });
    } else {
      row.draggable = wasDraggable;
      input.replaceWith(label);
      if (state.pendingRender) {
        state.pendingRender = false;
        render();
      }
    }
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
  ['click', 'dblclick', 'mousedown', 'pointerdown'].forEach((t) =>
    input.addEventListener(t, (e) => e.stopPropagation())
  );
}

function renameById(id) {
  const node = state.nodesById.get(id);
  const row = $(`#tree [data-id="${CSS.escape(id)}"]`) || $(`#open-list [data-id="${CSS.escape(id)}"]`);
  if (node && row) startRename(row, node);
}

// -------------------------------------------------------- Drag & Drop ----
let hoverExpand = { id: null, timer: null };

function resetHoverExpand() {
  if (hoverExpand.timer) clearTimeout(hoverExpand.timer);
  hoverExpand = { id: null, timer: null };
}

function clearDropMarkers() {
  document
    .querySelectorAll('.drop-before, .drop-after, .drop-into')
    .forEach((el) => el.classList.remove('drop-before', 'drop-after', 'drop-into'));
}

function dropZone(e, el, target) {
  const dragged = state.drag && state.nodesById.get(state.drag.id);
  if (!dragged || dragged.id === target.id) return null;
  // Folder nie in sich selbst / eigene Nachfahren ziehen.
  if (!dragged.url && (target.id === dragged.id || isDescendantOf(target.id, dragged.id))) return null;

  const rect = el.getBoundingClientRect();
  const rel = (e.clientY - rect.top) / rect.height;
  if (!target.url) {
    if (isRoot(target)) return 'into'; // vor/nach Roots geht nicht (Wurzel "0")
    if (rel < 0.25) return 'before';
    if (rel > 0.75) return 'after';
    return 'into';
  }
  return rel < 0.5 ? 'before' : 'after';
}

function addDndHandlers(el, node) {
  el.addEventListener('dragstart', (e) => {
    state.drag = { id: node.id };
    e.dataTransfer.setData('text/plain', node.id);
    e.dataTransfer.effectAllowed = 'move';
    el.classList.add('dragging');
  });
  el.addEventListener('dragend', () => {
    state.drag = null;
    resetHoverExpand();
    clearDropMarkers();
    el.classList.remove('dragging');
  });
  el.addEventListener('dragover', (e) => {
    const zone = dropZone(e, el, node);
    if (!zone) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    clearDropMarkers();
    el.classList.add(`drop-${zone}`);
    // Zugeklappte Folder nach kurzem Verweilen aufklappen.
    if (zone === 'into' && !node.url && !state.expanded.has(node.id)) {
      if (hoverExpand.id !== node.id) {
        resetHoverExpand();
        hoverExpand.id = node.id;
        hoverExpand.timer = setTimeout(() => expandFolderInPlace(node.id), 600);
      }
    } else if (hoverExpand.id === node.id) {
      resetHoverExpand();
    }
  });
  el.addEventListener('dragleave', () => {
    el.classList.remove('drop-before', 'drop-after', 'drop-into');
  });
  el.addEventListener('drop', async (e) => {
    const zone = dropZone(e, el, node);
    clearDropMarkers();
    resetHoverExpand();
    if (!zone) return;
    e.preventDefault();
    e.stopPropagation();
    const dragged = state.nodesById.get(state.drag.id);
    state.drag = null;
    await performDrop(dragged, node, zone);
  });
}

async function performDrop(dragged, target, zone) {
  if (!dragged) return;
  let parentId;
  let index;
  if (zone === 'into') {
    parentId = target.id;
    index = undefined; // ans Ende
  } else {
    parentId = target.parentId;
    index = target.index + (zone === 'after' ? 1 : 0);
    // HINWEIS zu bookmarks.move-Semantik: Chromes BookmarkModel interpretiert
    // den Index inkl. des noch vorhandenen Elements und korrigiert intern
    // (Move nach unten im selben Parent braucht KEIN -1; index === alt bzw.
    // alt+1 ist ein No-op). Falls Dia sich anders verhält (Drop landet eine
    // Position daneben), hier `index -= 1` für dragged.index < index ergänzen.
  }
  try {
    await chrome.bookmarks.move(dragged.id, {
      parentId,
      ...(index != null ? { index } : {}),
    });
    if (zone === 'into' && !state.expanded.has(parentId)) {
      state.expanded.add(parentId);
      saveUiState();
    }
    // onMoved-Event lädt den Baum neu und rendert.
  } catch (e) {
    console.warn('[DiaSideBar] move fehlgeschlagen:', e);
  }
}

// --------------------------------------------------------- Kontextmenü ----
let menuNode = null;

function menuItems(node) {
  if (!node.url) {
    const items = [
      { icon: I.bookmarkPlus, label: 'Add bookmark', fn: () => openDialog({ mode: 'add', folderId: node.id }) },
      { icon: I.folderPlus, label: 'New subfolder', fn: () => createFolder(node.id) },
    ];
    if (!isRoot(node)) {
      items.push(
        'sep',
        { icon: I.pencil, label: 'Rename', fn: () => renameById(node.id) },
        'sep',
        { icon: I.trash, label: 'Delete folder', fn: () => deleteFolder(node), danger: true }
      );
    }
    return items;
  }
  return [
    { icon: I.openNew, label: 'Open in new tab', fn: () => openInNewTab(node) },
    { icon: I.peek, label: 'Open in peek window', fn: () => openPeek(node.url) },
    { icon: I.copy, label: 'Copy URL', fn: () => navigator.clipboard.writeText(node.url) },
    'sep',
    { icon: I.pencil, label: 'Rename', fn: () => renameById(node.id) },
    { icon: I.link, label: 'Edit URL', fn: () => openDialog({ mode: 'edit', node }) },
    'sep',
    { icon: I.trash, label: 'Delete', fn: () => chrome.bookmarks.remove(node.id), danger: true },
  ];
}

function buildMenu(node) {
  const menu = $('#menu');
  menu.textContent = '';
  for (const item of menuItems(node)) {
    if (item === 'sep') {
      const s = document.createElement('div');
      s.className = 'menu-sep';
      menu.append(s);
      continue;
    }
    const b = document.createElement('button');
    b.className = 'menu-item' + (item.danger ? ' danger' : '');
    b.append(svg(item.icon));
    b.append(document.createTextNode(item.label));
    b.addEventListener('click', () => {
      closeMenu();
      item.fn();
    });
    menu.append(b);
  }
}

function openMenuAt(x, y, node) {
  menuNode = node;
  buildMenu(node);
  const menu = $('#menu');
  menu.classList.remove('hidden');
  // Erst anzeigen, dann messen und ggf. nach oben/links klappen.
  const r = menu.getBoundingClientRect();
  const px = Math.min(x, window.innerWidth - r.width - 6);
  const py = Math.min(y, window.innerHeight - r.height - 6);
  menu.style.left = `${Math.max(6, px)}px`;
  menu.style.top = `${Math.max(6, py)}px`;
}

function openMenu(anchorEl, node) {
  const r = anchorEl.getBoundingClientRect();
  openMenuAt(r.left, r.bottom + 4, node);
}

function closeMenu() {
  $('#menu').classList.add('hidden');
  menuNode = null;
}

// ------------------------------------------------------------- Dialoge ----
let dlgCtx = null;

function buildFolderSelect(selectedId) {
  const sel = $('#dlg-folder');
  sel.textContent = '';
  const addOpt = (node, depth) => {
    const o = document.createElement('option');
    o.value = node.id;
    o.textContent = `${' '.repeat(depth * 3)}${node.title || 'Untitled'}`;
    sel.append(o);
    for (const ch of node.children || []) {
      if (!ch.url) addOpt(ch, depth + 1);
    }
  };
  state.roots.forEach((r) => addOpt(r, 0));
  sel.value = selectedId;
  if (sel.selectedIndex === -1 && sel.options.length) sel.selectedIndex = 0;
}

async function openDialog(opts) {
  dlgCtx = opts;
  const isAdd = opts.mode === 'add';
  $('#dlg-title').textContent = isAdd ? 'Add bookmark' : 'Edit bookmark';
  $('#dlg-folder-row').classList.toggle('hidden', !isAdd);

  if (isAdd) {
    buildFolderSelect(opts.folderId || state.lastFolderId || defaultFolderId());
    let title = '';
    let url = '';
    try {
      // Aktiver Tab des Panel-Fensters als Vorbelegung.
      let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab) {
        title = tab.title || '';
        url = tab.url || '';
      }
    } catch (e) {
      /* kein Tab ermittelbar → leere Felder */
    }
    $('#dlg-name').value = title;
    $('#dlg-url').value = url;
  } else {
    $('#dlg-name').value = opts.node.title || '';
    $('#dlg-url').value = opts.node.url || '';
  }
  $('#dlg').showModal();
  $('#dlg-name').focus();
  $('#dlg-name').select();
}

async function saveDialog() {
  const title = $('#dlg-name').value.trim();
  let url = $('#dlg-url').value.trim();
  if (!url) return;
  // Schema ergänzen, wenn der User nur "example.com" eintippt.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = 'https://' + url;

  if (dlgCtx.mode === 'add') {
    const parentId = $('#dlg-folder').value || defaultFolderId();
    await chrome.bookmarks.create({ parentId, title: title || url, url });
    state.lastFolderId = parentId;
    state.expanded.add(parentId);
    saveUiState();
  } else {
    await chrome.bookmarks.update(dlgCtx.node.id, { title: title || url, url });
  }
  $('#dlg').close();
}

function confirmDialog(title, msg, okLabel) {
  return new Promise((resolve) => {
    $('#confirm-title').textContent = title;
    $('#confirm-msg').textContent = msg;
    $('#confirm-ok').textContent = okLabel;
    const dlg = $('#confirm-dlg');
    const okBtn = $('#confirm-ok');
    const cancelBtn = $('#confirm-cancel');
    let settled = false;
    // Auch Esc (natives close-Event) muss auflösen und die Listener abräumen,
    // sonst feuert ein hängengebliebener OK-Listener beim NÄCHSTEN Confirm mit.
    const done = (val) => {
      if (settled) return;
      settled = true;
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      dlg.removeEventListener('close', onClose);
      if (dlg.open) dlg.close();
      resolve(val);
    };
    const onOk = () => done(true);
    const onCancel = () => done(false);
    const onClose = () => done(false);
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    dlg.addEventListener('close', onClose);
    dlg.showModal();
  });
}

// ------------------------------------------------------------ Aktionen ----
async function createFolder(parentId) {
  state.expanded.add(parentId);
  saveUiState();
  const node = await chrome.bookmarks.create({ parentId, title: 'New folder' });
  setLastFolder(node.id); // frisch angelegter Folder wird Ziel für Neues
  // onCreated rendert (debounced) — für den sofortigen Rename selbst neu laden.
  await loadTree();
  render();
  renameById(node.id);
}

async function deleteFolder(node) {
  const n = bookmarkCount(node);
  const hasChildren = (node.children || []).length > 0;
  if (hasChildren) {
    const ok = await confirmDialog(
      'Delete folder',
      `Delete "${node.title}" and everything inside it (${n} bookmark${n === 1 ? '' : 's'})?`,
      'Delete'
    );
    if (!ok) return;
  }
  chrome.bookmarks.removeTree(node.id);
}

// ---------------------------------------------------------------- Init ----
function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

const refreshTreeSoon = debounce(async () => {
  await loadTree();
  render();
}, 60);

const refreshTabsSoon = debounce(async () => {
  await refreshOpenMap();
  render();
}, 120);

async function init() {
  await loadUiState();
  await loadBindings();
  await loadTree();
  await refreshOpenMap();
  render();

  // Kopfzeile
  $('#btn-add').addEventListener('click', () => openDialog({ mode: 'add' }));
  $('#btn-newfolder').addEventListener('click', () =>
    createFolder(state.lastFolderId || defaultFolderId())
  );

  // Suche
  const search = $('#search');
  const applySearch = () => {
    state.query = search.value.trim().toLowerCase();
    $('#search-clear').classList.toggle('hidden', !state.query);
    render();
  };
  search.addEventListener('input', applySearch);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && search.value) {
      search.value = '';
      applySearch();
      e.stopPropagation();
    }
  });
  $('#search-clear').addEventListener('click', () => {
    search.value = '';
    applySearch();
    search.focus();
  });

  // "Open bookmarks"-Sektion ein-/ausklappen
  $('#open-header').addEventListener('click', () => {
    state.openCollapsed = !state.openCollapsed;
    saveUiState();
    render();
  });

  // Dialog
  $('#dlg-form').addEventListener('submit', (e) => {
    e.preventDefault();
    saveDialog();
  });
  $('#dlg-cancel').addEventListener('click', () => $('#dlg').close());

  // Menü global schließen
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#menu')) closeMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });
  window.addEventListener('blur', closeMenu);
  $('#scroll').addEventListener('scroll', closeMenu, { passive: true });

  // Drops außerhalb der Rows: Navigation des Panels verhindern.
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => e.preventDefault());

  // Live-Updates
  chrome.bookmarks.onCreated.addListener(refreshTreeSoon);
  chrome.bookmarks.onRemoved.addListener(refreshTreeSoon);
  chrome.bookmarks.onChanged.addListener(refreshTreeSoon);
  chrome.bookmarks.onMoved.addListener(refreshTreeSoon);
  if (chrome.bookmarks.onChildrenReordered) {
    chrome.bookmarks.onChildrenReordered.addListener(refreshTreeSoon);
  }
  chrome.tabs.onCreated.addListener(refreshTabsSoon);
  chrome.tabs.onRemoved.addListener(refreshTabsSoon);
  chrome.tabs.onReplaced.addListener(refreshTabsSoon);
  chrome.tabs.onActivated.addListener(refreshTabsSoon); // Quick-Add-Sichtbarkeit
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url) refreshTabsSoon();
  });
}

init();

// ---------------------------------------------------------- Debug (Dia) ----
// Live-Diagnose im echten Dia: Seite als Tab öffnen mit #dbgenv/#dbgpeek/
// #dbgopen — Ergebnisse gehen als no-cors-GETs an localhost:8123 und landen
// im Log des Dev-Servers (der Pfad wird geloggt, Response ist egal).
// Ohne #dbg…-Hash ist dieser Block komplett inert (normaler Panel-Betrieb).
const DBG = location.hash.startsWith('#dbg');

function dbg(ev, data) {
  if (!DBG) return;
  try {
    const q = encodeURIComponent(JSON.stringify(data || {}));
    fetch(`http://localhost:8123/__dbg/${ev}?${q}`, { mode: 'no-cors', cache: 'no-store' }).catch(() => {});
  } catch (e) {
    /* egal */
  }
}

if (DBG) {
  (async () => {
    const scenario = location.hash.slice(1);
    dbg('load', {
      scenario,
      hasSession: !!(chrome.storage && chrome.storage.session),
      hasLocal: !!(chrome.storage && chrome.storage.local),
    });

    if (scenario === 'dbgenv') {
      // storage.session-Roundtrip mit Timeout (Verdacht: hängt in Dia)
      for (const [name, area] of [['session', chrome.storage.session], ['local', chrome.storage.local]]) {
        const t0 = Date.now();
        let rt;
        try {
          if (!area) {
            rt = 'undefined';
          } else {
            const p = area.set({ __dbg: 1 }).then(() => area.get('__dbg'));
            const res = await Promise.race([p, new Promise((r) => setTimeout(() => r('TIMEOUT'), 1500))]);
            rt = res === 'TIMEOUT' ? 'TIMEOUT' : JSON.stringify(res);
          }
        } catch (e) {
          rt = 'THROW:' + (e && e.message);
        }
        dbg('env-storage', { area: name, rt, ms: Date.now() - t0 });
      }
      const tabs = await chrome.tabs.query({});
      dbg('env-tabs', {
        count: tabs.length,
        sample: tabs.slice(0, 8).map((t) => ({ id: t.id, w: t.windowId, url: (t.url || 'NO-URL').slice(0, 50) })),
      });
      const wins = await chrome.windows.getAll();
      dbg('env-windows', { wins: wins.map((w) => ({ id: w.id, type: w.type, focused: w.focused })) });
      setTimeout(() => {
        dbg('env-state', {
          bmUrls: [...state.bookmarkUrls].slice(0, 8),
          openKeys: [...state.openMap.keys()].slice(0, 8),
          bindings: [...state.tabBindings],
        });
      }, 800);
    }

    if (scenario === 'dbgpeek') {
      const t = Date.now();
      chrome.windows.onCreated.addListener((w) =>
        dbg('win-created', { dt: Date.now() - t, id: w.id, type: w.type })
      );
      chrome.windows.onRemoved.addListener((id) => dbg('win-removed', { dt: Date.now() - t, id }));
      chrome.windows.onFocusChanged.addListener(async (windowId) => {
        let type = null;
        try {
          const w = await chrome.windows.get(windowId);
          type = w.type;
        } catch (e) {
          type = 'GET-ERR';
        }
        dbg('focus', { dt: Date.now() - t, windowId, type });
      });
      setTimeout(() => {
        dbg('send-open-peek', {});
        chrome.runtime
          .sendMessage({ type: 'OPEN_PEEK', url: 'https://example.com/' })
          .then((r) => dbg('open-peek-resp', r || { r: 'no-resp' }))
          .catch((e) => dbg('open-peek-err', { m: e && e.message }));
      }, 1500);
      for (const delay of [2500, 4500, 8000, 12000]) {
        setTimeout(async () => {
          const st = await chrome.storage.local.get(['peekWindowId', 'peekOpenedAt']);
          let peekWin = null;
          try {
            if (st.peekWindowId != null) {
              const w = await chrome.windows.get(st.peekWindowId);
              peekWin = { exists: true, focused: w.focused, type: w.type };
            } else {
              peekWin = 'no-id';
            }
          } catch (e) {
            peekWin = { exists: false };
          }
          dbg('peek-state', { dt: delay, st, peekWin });
        }, delay);
      }
    }

    if (scenario === 'dbgbind') {
      // End-to-End: temporäres Bookmark auf eine Seite, die per Meta-Refresh
      // (1,5 s) weiterleitet → prüft, ob das Binding Dias Tab-Swap UND den
      // Redirect überlebt (URL-Match allein kann /after.html nicht zuordnen).
      setTimeout(async () => {
        const bm = await chrome.bookmarks.create({
          parentId: defaultFolderId(),
          title: '__dbg redirect',
          url: 'http://localhost:8123/dev/harness/redir.html',
        });
        dbg('bind-bm', { id: bm.id, url: bm.url });
        const node = { id: bm.id, url: bm.url };
        await openBookmark(node);
        for (const delay of [800, 2500, 5000, 9000]) {
          setTimeout(async () => {
            await refreshOpenMap();
            const tabs = await chrome.tabs.query({});
            const after = tabs
              .filter((t) => t.url && t.url.includes('after.html'))
              .map((t) => t.id);
            dbg('bind-check', {
              dt: delay,
              bindings: [...state.tabBindings],
              isOpen: isOpenNode(node),
              afterTabs: after,
            });
          }, delay);
        }
        // Aufräumen: Test-Bookmark + Test-Tabs schließen.
        setTimeout(async () => {
          chrome.bookmarks.remove(bm.id).catch(() => {});
          const tabs = await chrome.tabs.query({});
          for (const t of tabs) {
            if (t.url && t.url.includes('/dev/harness/')) chrome.tabs.remove(t.id).catch(() => {});
          }
          dbg('bind-cleanup', {});
        }, 12000);
      }, 1200);
    }

    if (scenario === 'dbgopen') {
      setTimeout(async () => {
        const all = [...state.nodesById.values()].filter((n) => n.url);
        const target = all.find((n) => n.url.includes('lehmann')) || all[0];
        if (!target) {
          dbg('open-target', { none: true });
          return;
        }
        dbg('open-target', { id: target.id, url: target.url, norm: normalizeUrl(target.url) });
        dbg('open-before', { hit: openTabFor(target) || 'none' });
        await openBookmark(target);
        for (const delay of [600, 1500, 3000, 6000]) {
          setTimeout(async () => {
            const tabs = await chrome.tabs.query({});
            const matching = tabs
              .filter((tb) => tb.url && normalizeUrl(tb.url) === normalizeUrl(target.url))
              .map((tb) => ({ id: tb.id, url: tb.url.slice(0, 50) }));
            dbg('open-check', {
              dt: delay,
              isOpen: isOpenNode(target),
              bindings: [...state.tabBindings],
              matching,
            });
          }, delay);
        }
      }, 1200);
    }
  })();
}
