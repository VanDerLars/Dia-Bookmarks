// DiaSideBar — Service Worker
// 1) Klick aufs Toolbar-Icon öffnet/schließt das Side Panel.
// 2) Peek-Fenster (wie DiaPeeks Window-Mode): zentriertes Popup ~70 % des
//    Hauptfensters, schließt automatisch, sobald der Fokus auf ein anderes
//    Fenster wechselt. Der Zustand (peekWindowId) liegt in
//    chrome.storage.session, NICHT in Modul-Variablen — MV3-Service-Worker
//    werden nach ~30 s Idle beendet und verlören ihn sonst (DiaPeek-Gotcha).
// Alle weitere App-Logik lebt in der Panel-Page (src/sidepanel/).

if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  // Bei jedem SW-Start setzen (idempotent), nicht nur bei onInstalled.
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((e) => console.warn('[DiaSideBar] setPanelBehavior fehlgeschlagen:', e));
} else {
  // Fallback, falls Dia die sidePanel-API nicht anbietet: Panel-Page als
  // schmales Popup-Fenster öffnen, damit die Extension trotzdem nutzbar ist.
  chrome.action.onClicked.addListener(async () => {
    let left;
    let top;
    let height = 700;
    try {
      const win = await chrome.windows.getLastFocused();
      height = Math.max(500, (win.height || 800) - 80);
      left = Math.round((win.left || 0) + (win.width || 1200) - 380);
      top = Math.round((win.top || 0) + 40);
    } catch (e) {
      /* Standardposition durch den Browser */
    }
    chrome.windows.create({
      url: chrome.runtime.getURL('src/sidepanel/sidepanel.html'),
      type: 'popup',
      width: 360,
      height,
      ...(left != null ? { left, top } : {}),
    });
  });
}

// ---- Sitzungs-Zustand (storage.local statt storage.session) -----------------
// WICHTIG: chrome.storage.session hat sich in Dia als unzuverlässig erwiesen
// (Verdacht: get() liefert nie / verhält sich anders als in Chrome). Deshalb
// liegen peek-Status und Tab-Bindings in storage.local und werden beim
// Browserstart bzw. Extension-Reload geleert (Tab-/Fenster-IDs gelten ohnehin
// nur pro Sitzung).
function resetSessionState() {
  chrome.storage.local.remove(['tabBindings', 'peekWindowId', 'peekOpenedAt']).catch(() => {});
}
chrome.runtime.onStartup.addListener(resetSessionState);
chrome.runtime.onInstalled.addListener(resetSessionState);

// ---- Peek-Fenster -----------------------------------------------------------
const PEEK_WINDOW_RATIO = 0.7;
// Gnadenfrist nach dem Öffnen: Beim Erstellen aus dem Side Panel feuert Dia
// transiente onFocusChanged-Events (u. a. kurz zurück aufs Hauptfenster) —
// ohne die Frist schloss sich das Peek-Fenster sofort wieder.
const PEEK_FOCUS_GRACE_MS = 1500;

async function getPeekState() {
  try {
    const { peekWindowId = null, peekOpenedAt = 0 } = await chrome.storage.local.get([
      'peekWindowId',
      'peekOpenedAt',
    ]);
    return { peekWindowId, peekOpenedAt };
  } catch (e) {
    return { peekWindowId: null, peekOpenedAt: 0 };
  }
}

async function setPeekState(id) {
  try {
    await chrome.storage.local.set({ peekWindowId: id, peekOpenedAt: Date.now() });
  } catch (e) {
    /* Storage nicht verfügbar */
  }
}

async function clearPeekState() {
  try {
    await chrome.storage.local.remove(['peekWindowId', 'peekOpenedAt']);
  } catch (e) {
    /* egal */
  }
}

chrome.windows.onRemoved.addListener(async (id) => {
  const { peekWindowId } = await getPeekState();
  if (id === peekWindowId) await clearPeekState();
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  const { peekWindowId, peekOpenedAt } = await getPeekState();
  if (peekWindowId == null) return;
  // Bei Fokus aufs Peek selbst oder Wechsel zu einer anderen App: offen lassen.
  if (windowId === peekWindowId || windowId === chrome.windows.WINDOW_ID_NONE) return;
  if (Date.now() - peekOpenedAt < PEEK_FOCUS_GRACE_MS) return;
  // Nur schließen, wenn ein NORMALES Browserfenster den Fokus bekommt —
  // Panel-/Popup-Fenster (falls Dia sie als eigene Fenster meldet) zählen nicht.
  try {
    const win = await chrome.windows.get(windowId);
    if (win && win.type && win.type !== 'normal') return;
  } catch (e) {
    /* unbekanntes Fenster → im Zweifel schließen */
  }
  await clearPeekState();
  chrome.windows.remove(peekWindowId).catch(() => {});
});

// Dia bettet in Bookmark-URLs teils Userinfo ein (https://newtab@host/ …) —
// windows.create/tabs.update verweigern URLs mit eingebetteten Credentials.
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

async function openPeekWindow(rawUrl) {
  const url = openableUrl(rawUrl);
  let width = 900;
  let height = 700;
  let left;
  let top;
  try {
    const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    const W = win.width || 1200;
    const H = win.height || 900;
    width = Math.round(W * PEEK_WINDOW_RATIO);
    height = Math.round(H * PEEK_WINDOW_RATIO);
    left = Math.round((win.left || 0) + (W - width) / 2);
    top = Math.round((win.top || 0) + (H - height) / 2);
  } catch (e) {
    /* Standardgröße/-position durch den Browser */
  }

  // Vorhandenes Peek-Fenster wiederverwenden (URL setzen + fokussieren).
  const { peekWindowId: existing } = await getPeekState();
  if (existing != null) {
    try {
      const tabs = await chrome.tabs.query({ windowId: existing });
      if (tabs[0]) await chrome.tabs.update(tabs[0].id, { url });
      await chrome.windows.update(existing, {
        focused: true,
        ...(left != null ? { left, top, width, height } : {}),
      });
      await setPeekState(existing); // Gnadenfrist neu starten
      return;
    } catch (e) {
      /* Fenster existiert nicht mehr → neu erstellen */
    }
  }

  const w = await chrome.windows.create({
    url,
    type: 'popup',
    width,
    height,
    ...(left != null ? { left, top } : {}),
    focused: true,
  });
  await setPeekState(w.id);
}

// ---- Tab-Bindings (Lesezeichen → geöffneter Tab) ----------------------------
// Das Panel legt Bindings an (storage.local `tabBindings`, Format
// tabId → {b: bookmarkId, u: normalisierte URL, t: Timestamp}); der SW hält
// sie aktuell — auch wenn das Panel geschlossen ist:
// - onReplaced: klassischer Chrome-Prerender-Swap → Binding auf neue tabId.
// - ⚠️ DIA feuert bei seinem Tab-Swap KEIN onReplaced, sondern remove+create
//   (live verifiziert: tabs.create lieferte ID A, die Seite landete in ID B).
//   Deshalb: stirbt ein junges Binding per onRemoved, wird es am Nachfolger-
//   Tab mit gleicher normalisierter URL neu verankert (tryRebind).
// - onUpdated: navigiert ein gebundener Tab, wird die gemerkte URL mitgeführt,
//   damit ein späteres Re-Attach die aktuelle URL kennt.
// - KEIN Aufräumen über tabs.query-Abgleich — transiente Lücken löschten
//   Bindings fälschlich.
async function updateBindings(fn) {
  try {
    const { tabBindings = {} } = await chrome.storage.local.get('tabBindings');
    const next = fn(tabBindings);
    if (next) await chrome.storage.local.set({ tabBindings: next });
  } catch (e) {
    /* Storage nicht verfügbar */
  }
}

// Gleiche Normalisierung wie im Panel (sidepanel.js).
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

const REBIND_WINDOW_MS = 15000;

async function tryRebind(rec, attempt) {
  try {
    const tabs = await chrome.tabs.query({});
    const cand = tabs.find(
      (t) =>
        t.id != null &&
        ((t.url && normalizeUrl(t.url) === rec.u) ||
          (t.pendingUrl && normalizeUrl(t.pendingUrl) === rec.u))
    );
    if (cand) {
      await updateBindings((b) => {
        if (cand.id in b) return null; // schon anderweitig gebunden
        b[cand.id] = { b: rec.b, u: rec.u, t: Date.now() };
        return b;
      });
      return;
    }
  } catch (e) {
    /* query fehlgeschlagen → Retry unten */
  }
  if (attempt < 3) setTimeout(() => tryRebind(rec, attempt + 1), 700 * (attempt + 1));
}

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  updateBindings((b) => {
    if (!(removedTabId in b)) return null;
    b[addedTabId] = b[removedTabId];
    delete b[removedTabId];
    return b;
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  updateBindings((b) => {
    const rec = b[tabId];
    if (!rec) return null;
    delete b[tabId];
    // Junges Binding + Tab weg = vermutlich Dias Tab-Swap → neu verankern.
    if (rec.b && rec.u && Date.now() - (rec.t || 0) < REBIND_WINDOW_MS) {
      setTimeout(() => tryRebind(rec, 0), 250);
    }
    return b;
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) return;
  updateBindings((b) => {
    const rec = b[tabId];
    if (!rec || !rec.b) return null;
    rec.u = normalizeUrl(changeInfo.url);
    rec.t = Date.now();
    return b;
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return undefined;

  if (msg.type === 'OPEN_PEEK' && typeof msg.url === 'string') {
    openPeekWindow(msg.url).then(
      () => sendResponse({ ok: true }),
      () => sendResponse({ ok: false })
    );
    return true; // asynchrone Antwort
  }

  // Content-Script (Steuerleiste) fragt, ob seine Seite das Peek-Fenster ist.
  if (msg.type === 'IS_PEEK_WINDOW') {
    (async () => {
      const { peekWindowId } = await getPeekState();
      sendResponse({
        isPeekWindow: !!(sender.tab && peekWindowId != null && sender.tab.windowId === peekWindowId),
      });
    })();
    return true;
  }

  if (msg.type === 'CLOSE_PEEK_WINDOW') {
    (async () => {
      const { peekWindowId } = await getPeekState();
      await clearPeekState();
      if (peekWindowId != null) chrome.windows.remove(peekWindowId).catch(() => {});
      sendResponse({ ok: true });
    })();
    return true;
  }

  // Peek-Fenster als normalen Tab im zuletzt fokussierten Fenster öffnen.
  if (msg.type === 'PROMOTE_PEEK_WINDOW' && typeof msg.url === 'string') {
    (async () => {
      const { peekWindowId } = await getPeekState();
      await clearPeekState(); // Blur-Auto-Close entschärfen
      try {
        const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
        await chrome.tabs.create({ url: openableUrl(msg.url), windowId: win.id, active: true });
        await chrome.windows.update(win.id, { focused: true });
      } catch (e) {
        chrome.tabs.create({ url: openableUrl(msg.url) }).catch(() => {});
      }
      if (peekWindowId != null) chrome.windows.remove(peekWindowId).catch(() => {});
      sendResponse({ ok: true });
    })();
    return true;
  }

  return undefined;
});
