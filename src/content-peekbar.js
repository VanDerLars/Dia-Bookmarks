// DiaSideBar — Steuerleiste im Peek-Fenster (adaptiert von DiaPeek).
// Läuft auf allen Seiten (Top-Frame), tut aber nur etwas, wenn die Seite im
// DiaSideBar-Peek-Fenster steckt (IS_PEEK_WINDOW). Buttons: Copy / Als Tab /
// Schließen; ⌥⇧C kopiert die URL. NICHT ⌘⇧C: das ist in Dia der native
// Menü-Accelerator "Copy URL" und aus Content-Scripts nicht abfangbar
// (gleiche Erkenntnis wie in DiaPeek).

(() => {
  if (window.top !== window) return; // nur Top-Frame

  let inPeekWindow = false;
  let barObserver = null;
  let toastHost = null;
  let toastTimer = null;

  function fallbackCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed; top:-1000px; left:-1000px; opacity:0;';
      (document.body || document.documentElement).appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) {
      return false;
    }
  }

  function showToast(text) {
    if (!toastHost || !toastHost.isConnected) {
      toastHost = document.createElement('div');
      toastHost.id = 'diasidebar-toast';
      toastHost.style.cssText =
        'all:initial; position:fixed; bottom:16px; left:50%; transform:translateX(-50%); z-index:2147483647; pointer-events:none;';
      const r = toastHost.attachShadow({ mode: 'open' });
      r.innerHTML = `
        <style>
          .t { font: 13px system-ui, -apple-system, sans-serif; background: rgba(20,20,22,.92);
               color: #fff; padding: 8px 14px; border-radius: 8px;
               box-shadow: 0 4px 16px rgba(0,0,0,.4); opacity: 0; transition: opacity .12s ease; }
          .t.show { opacity: 1; }
        </style>
        <div class="t"></div>`;
      (document.body || document.documentElement).appendChild(toastHost);
    }
    const el = toastHost.shadowRoot.querySelector('.t');
    el.textContent = text;
    requestAnimationFrame(() => el.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1400);
  }

  function copyPeekURL() {
    const url = location.href;
    const done = () => showToast('URL copied');
    try {
      navigator.clipboard.writeText(url).then(done, () => {
        if (fallbackCopy(url)) done();
      });
    } catch (e) {
      if (fallbackCopy(url)) done();
    }
  }

  function renderBar() {
    if (document.getElementById('diasidebar-winbar')) return;
    const host = document.createElement('div');
    host.id = 'diasidebar-winbar';
    host.style.cssText = 'all:initial; position:fixed; top:10px; right:10px; z-index:2147483647;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        .bar { display:flex; gap:6px; background:rgba(20,20,22,.9); padding:5px; border-radius:10px; box-shadow:0 4px 16px rgba(0,0,0,.4); }
        .b { width:30px; height:30px; border:0; background:transparent; color:#fff; border-radius:7px; cursor:pointer; display:flex; align-items:center; justify-content:center; }
        .b:hover { background:rgba(255,255,255,.16); }
        .b.close:hover { background:#ff5f57; }
        svg { width:16px; height:16px; display:block; pointer-events:none; }
      </style>
      <div class="bar">
        <button class="b" data-act="copy" title="Copy URL (⌥⇧C)">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="5.5" y="5.5" width="7.75" height="7.75" rx="1.5"/><path d="M3 10.25V4.25A1.25 1.25 0 0 1 4.25 3H10.25"/></svg>
        </button>
        <button class="b" data-act="promote" title="Open as tab">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3.25H4.25A1.25 1.25 0 0 0 3 4.5v7.25A1.25 1.25 0 0 0 4.25 13h7.25A1.25 1.25 0 0 0 12.75 11.75V9"/><path d="M9.5 2.75h3.75V6.5"/><path d="M13.25 2.75 7.25 8.75"/></svg>
        </button>
        <button class="b close" data-act="close" title="Close window">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>
        </button>
      </div>`;
    (document.body || document.documentElement).appendChild(host);
    root.querySelector('[data-act="copy"]').addEventListener('click', () => copyPeekURL());
    root.querySelector('[data-act="promote"]').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'PROMOTE_PEEK_WINDOW', url: location.href });
    });
    root.querySelector('[data-act="close"]').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'CLOSE_PEEK_WINDOW' });
    });

    // SPA-Seiten ersetzen bei internem Routing teils den <body> und entfernen
    // dabei die Leiste → beobachten und bei Bedarf neu einsetzen (wie DiaPeek).
    if (!barObserver) {
      barObserver = new MutationObserver(() => {
        if (inPeekWindow && !document.getElementById('diasidebar-winbar')) renderBar();
      });
      barObserver.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  function onKeydown(e) {
    // ⌥⇧C → URL kopieren. e.code (physische Taste) ist layout-unabhängig.
    if (e.altKey && e.shiftKey && !e.metaKey && !e.ctrlKey && e.code === 'KeyC') {
      e.preventDefault();
      e.stopPropagation();
      copyPeekURL();
    }
  }

  try {
    chrome.runtime.sendMessage({ type: 'IS_PEEK_WINDOW' }, (resp) => {
      if (chrome.runtime.lastError) return; // SW nicht erreichbar
      if (resp && resp.isPeekWindow) {
        inPeekWindow = true;
        renderBar();
        document.addEventListener('keydown', onKeydown, true);
      }
    });
  } catch (e) {
    /* Extension-Kontext weg (Reload) → nichts tun */
  }
})();
