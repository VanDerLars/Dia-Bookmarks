// Mock der chrome.*-APIs, damit sidepanel.js außerhalb einer Extension läuft.
// Beispieldaten ähnlich den Referenz-Screenshots; claude.ai + github.com sind
// "offen" (Killerfeature-Markierung testbar). Favicon-URLs zeigen ins Leere →
// Letter-Avatar-Fallback wird mitgetestet.
(() => {
  const mkEvent = () => {
    const ls = new Set();
    return { addListener: (f) => ls.add(f), fire: (...a) => ls.forEach((f) => f(...a)) };
  };

  let nextId = 100;
  const f = (id, title, kids) => ({ id, title, children: kids });
  const b = (id, title, url) => ({ id, title, url });

  const root = {
    id: '0',
    title: '',
    children: [
      f('1', 'Bookmarks Bar', [
        f('10', 'Private', [
          b('101', 'YouTube', 'https://www.youtube.com/'),
          b('102', 'Reddit', 'https://www.reddit.com/'),
        ]),
        f('11', 'AI', [
          b('111', 'Claude', 'https://claude.ai/'),
          b('112', 'ChatGPT', 'https://chatgpt.com/'),
          b('113', 'Gemini', 'https://gemini.google.com/'),
        ]),
        f('12', 'DEV Tools', [
          b('121', 'GitHub', 'https://github.com/'),
          b('122', 'MDN Web Docs', 'https://developer.mozilla.org/'),
        ]),
        f('13', 'Music', []),
        b('14', 'Hacker News', 'https://news.ycombinator.com/'),
      ]),
      f('2', 'Other Bookmarks', [
        b('21', 'Aktivität - SLN - Slack', 'https://app.slack.com/client/T02G/activity'),
      ]),
    ],
  };

  const nodes = new Map();
  const reindex = () => {
    nodes.clear();
    const walk = (n, parent) => {
      if (parent) n.parentId = parent.id;
      nodes.set(n.id, n);
      (n.children || []).forEach((c, i) => {
        c.index = i;
        walk(c, n);
      });
    };
    walk(root, null);
  };
  reindex();

  const clone = (o) => JSON.parse(JSON.stringify(o));

  const tabs = [
    { id: 1, windowId: 1, title: 'Claude', url: 'https://claude.ai/' },
    { id: 2, windowId: 1, title: 'GitHub', url: 'https://github.com/' },
    { id: 3, windowId: 1, title: 'Example — current page', url: 'https://example.com/some/page' },
  ];

  const bmEvents = {
    onCreated: mkEvent(),
    onRemoved: mkEvent(),
    onChanged: mkEvent(),
    onMoved: mkEvent(),
    onChildrenReordered: mkEvent(),
  };
  const tabEvents = {
    onCreated: mkEvent(),
    onRemoved: mkEvent(),
    onReplaced: mkEvent(),
    onUpdated: mkEvent(),
    onActivated: mkEvent(),
  };

  const mkStorageArea = () => ({
    _data: {},
    async get(k) {
      return { [k]: this._data[k] };
    },
    async set(o) {
      Object.assign(this._data, o);
    },
    async remove(k) {
      delete this._data[k];
    },
  });

  window.chrome = {
    storage: {
      local: mkStorageArea(),
      session: mkStorageArea(),
    },
    bookmarks: {
      async getTree() {
        return [clone(root)];
      },
      async create({ parentId, title, url }) {
        const p = nodes.get(parentId);
        const n = { id: String(nextId++), title, ...(url ? { url } : { children: [] }) };
        p.children.push(n);
        reindex();
        bmEvents.onCreated.fire(n.id, clone(n));
        return clone(n);
      },
      async update(id, ch) {
        Object.assign(nodes.get(id), ch);
        bmEvents.onChanged.fire(id, ch);
        return clone(nodes.get(id));
      },
      async remove(id) {
        const n = nodes.get(id);
        const p = nodes.get(n.parentId);
        p.children = p.children.filter((c) => c.id !== id);
        reindex();
        bmEvents.onRemoved.fire(id, {});
      },
      async removeTree(id) {
        return this.remove(id);
      },
      async move(id, { parentId, index }) {
        const n = nodes.get(id);
        const oldP = nodes.get(n.parentId);
        const newP = nodes.get(parentId != null ? parentId : n.parentId);
        const oldIndex = n.index;
        // Chromium-Semantik: Index inkl. noch vorhandenem Element,
        // alt/alt+1 im selben Parent ist ein No-op.
        if (oldP === newP && index != null && (index === oldIndex || index === oldIndex + 1)) {
          return clone(n);
        }
        oldP.children.splice(oldIndex, 1);
        let i = index == null ? newP.children.length : index;
        if (oldP === newP && index != null && index > oldIndex) i = index - 1;
        newP.children.splice(i, 0, n);
        reindex();
        bmEvents.onMoved.fire(id, {});
        return clone(n);
      },
      ...bmEvents,
    },
    tabs: {
      async query(q) {
        if (q && q.active) return [clone(tabs[2])];
        return clone(tabs);
      },
      async create({ url }) {
        const t = { id: 900 + tabs.length, windowId: 1, title: url, url };
        tabs.push(t);
        console.log('[mock] tabs.create', url);
        tabEvents.onCreated.fire(clone(t));
        return clone(t);
      },
      async update(id, p) {
        console.log('[mock] tabs.update', id, JSON.stringify(p));
        return {};
      },
      async remove(id) {
        console.log('[mock] tabs.remove', id);
        window.__mock.closeTab(id);
      },
      ...tabEvents,
    },
    windows: {
      async update(id, p) {
        console.log('[mock] windows.update', id, JSON.stringify(p));
        return {};
      },
    },
    runtime: {
      getURL: (p) => 'https://icons.invalid' + p,
      async sendMessage(msgOrId, maybeMsg) {
        // Einargumentig = Nachricht an den eigenen SW (z. B. OPEN_PEEK).
        const msg = maybeMsg === undefined ? msgOrId : maybeMsg;
        console.log('[mock] runtime.sendMessage', JSON.stringify(msg));
        return { ok: true };
      },
    },
  };

  // Test-Helfer für die Konsole, z. B. Redirect eines Tabs simulieren:
  //   __mock.redirect(<tabId>, 'https://example.com/nach/redirect')
  window.__mock = {
    tabs,
    redirect(tabId, url) {
      const t = tabs.find((x) => x.id === tabId);
      if (!t) return 'no such tab';
      t.url = url;
      tabEvents.onUpdated.fire(tabId, { url }, clone(t));
      return 'ok';
    },
    activate(tabId) {
      tabEvents.onActivated.fire({ tabId, windowId: 1 });
    },
    // Prerender-Swap (tabs.onReplaced): neue tabId + neue URL. Überträgt auch
    // das Binding in storage.session — das macht im echten Betrieb der
    // Service Worker (src/background.js), den der Harness nicht lädt.
    async replaceTab(oldId, newId, url) {
      const t = tabs.find((x) => x.id === oldId);
      if (!t) return 'no such tab';
      t.id = newId;
      if (url) t.url = url;
      const { tabBindings = {} } = await window.chrome.storage.local.get('tabBindings');
      if (oldId in tabBindings) {
        tabBindings[newId] = tabBindings[oldId];
        delete tabBindings[oldId];
        await window.chrome.storage.local.set({ tabBindings });
      }
      tabEvents.onReplaced.fire(newId, oldId);
      return 'ok';
    },
    closeTab(tabId) {
      const i = tabs.findIndex((x) => x.id === tabId);
      if (i === -1) return 'no such tab';
      tabs.splice(i, 1);
      // Binding-Löschung macht im echten Betrieb der SW bei onRemoved.
      window.chrome.storage.local.get('tabBindings').then(({ tabBindings = {} }) => {
        if (tabId in tabBindings) {
          delete tabBindings[tabId];
          window.chrome.storage.local.set({ tabBindings });
        }
        tabEvents.onRemoved.fire(tabId, {});
      });
      return 'ok';
    },
  };
})();
