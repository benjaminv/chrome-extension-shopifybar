// Isolated-world content script. Three contexts, decided by host/frame:
//  - Storefront top frame: receives Shopify data from main-world.js, renders
//    the on-page badge, manages preview-bar hiding, records recent stores.
//  - Customizer preview iframe (*.myshopify.com, design mode): records the
//    edited theme's real name/role into recentStores and nothing else - the
//    admin frame's badge picks it up via storage.onChanged.
//  - Admin top frame (admin.shopify.com): renders the badge/panel from URL
//    context (store handle, theme id) enriched by recentStores.
(() => {
  const HIDE_STYLE_ID = '__shopifybar-hide';
  const host = location.host;
  const IS_ADMIN = host === 'admin.shopify.com';
  const IS_TOP = window === window.top;
  const UNIVERSAL_KEYS = ['pinRightBar', 'hideAiBar', 'editorFullscreen'];
  const RECENT_MAX = 20;

  const state = {
    data: null, // { isShopify, designMode, shop, theme }
    badgeMode: 'full', // 'full' | 'dot' | 'off'
    sessionHide: false, // hide for current page load only (in-memory)
    persistentHide: false, // hide until unhide, per store (chrome.storage)
    pinRightBar: false, // universal: keep customizer right bar space reserved
    hideAiBar: false, // universal: hide Sidekick "Ask for changes" bar
    editorFullscreen: false, // universal: hide both customizer sidebars
    recentStores: {}, // handle -> { handle, shop, origin, lastVisited, liveTheme, lastTheme }
    panelTab: 'current' // 'current' | 'recent'
  };

  let ui = null; // { hostEl, wrap, pill, label, panel }

  // ---------- preview bar hiding (storefront only) ----------

  const hideCssApplied = () => !!document.getElementById(HIDE_STYLE_ID);

  const applyHideCss = () => {
    if (hideCssApplied()) return;
    const style = document.createElement('style');
    style.id = HIDE_STYLE_ID;
    style.textContent = globalThis.SHOPIFYBAR_HIDE_CSS;
    document.documentElement.appendChild(style);
  };

  const removeHideCss = () => {
    const style = document.getElementById(HIDE_STYLE_ID);
    if (style) style.remove();
  };

  const syncHideCss = () => {
    if (IS_ADMIN) return;
    if (state.sessionHide || state.persistentHide) applyHideCss();
    else removeHideCss();
  };

  const shopifyBarPresent = () =>
    globalThis.SHOPIFYBAR_HIDE_SELECTORS.some((sel) => {
      try {
        return !!document.querySelector(sel);
      } catch {
        return false;
      }
    });

  // ---------- helpers ----------

  const themeRoleIsLive = () => state.data?.theme?.role === 'main';

  const storeHandle = (shop) =>
    shop && shop.endsWith('.myshopify.com') ? shop.slice(0, -'.myshopify.com'.length) : null;

  const adminHandle = () => storeHandle(state.data?.shop || '');

  const editorUrl = () => {
    const handle = adminHandle();
    const id = state.data?.theme?.id;
    if (!handle || !id) return null;
    return `https://admin.shopify.com/store/${handle}/themes/${id}/editor`;
  };

  const previewLink = () => {
    const id = state.data?.theme?.id;
    if (!id) return null;
    const url = new URL(location.href);
    url.searchParams.set('preview_theme_id', String(id));
    url.searchParams.delete('pb');
    return url.toString();
  };

  const forceShowUrl = () => {
    const url = new URL(location.href);
    const id = state.data?.theme?.id;
    // Always include preview_theme_id (window.Shopify.theme.id works for the
    // live theme too, no admin login needed): pb=1 alone is a no-op unless
    // Shopify already has a preview session for this visit.
    if (id) url.searchParams.set('preview_theme_id', String(id));
    url.searchParams.set('pb', '1');
    return url.toString();
  };

  // Restore implies "I want to see the bar": drop our own hides first,
  // otherwise the restored bar would be invisible behind our CSS.
  const restoreBar = async () => {
    state.sessionHide = false;
    await setPersistentHide(false);
    location.href = forceShowUrl();
  };

  // ---------- admin context ----------

  const adminCtx = () => {
    const m = location.pathname.match(/^\/store\/([^/]+)/);
    if (!m) return null;
    const t = location.pathname.match(/\/themes\/(\d+)\/editor/);
    return { handle: m[1], themeId: t ? Number(t[1]) : null, isEditor: !!t };
  };

  // Fallback when recentStores has nothing: the admin tab title is
  // "<Store> · Edit <theme name> · Shopify" on editor pages.
  const titleThemeName = () => {
    const m = document.title.match(/·\s*Edit\s+(.+?)\s*·/);
    return m ? m[1] : null;
  };

  // Resolve the edited theme via recentStores (written live by this same
  // script running inside the customizer's preview iframe).
  const adminTheme = (ctx) => {
    if (!ctx.themeId) return null;
    const rec = state.recentStores[ctx.handle];
    if (rec?.liveTheme && rec.liveTheme.id === ctx.themeId)
      return { ...rec.liveTheme, role: 'main' };
    if (rec?.lastTheme && rec.lastTheme.id === ctx.themeId) return rec.lastTheme;
    return { id: ctx.themeId, name: titleThemeName(), role: null };
  };

  const roleClass = (role) =>
    role === 'main' ? 'live' : role === 'development' ? 'dev' : 'preview';

  const roleLabel = (role) =>
    ({ main: 'LIVE', development: 'DEV', unpublished: 'OFFLINE', demo: 'DEMO' })[role] || 'THEME';

  // ---------- storage ----------
  // Settings live in chrome.storage.sync so they follow the Chrome profile
  // across computers. Reads fall back to .local for pre-sync installs.

  const loadSettings = async () => {
    const keys = ['badgeMode', `hide:${host}`, 'recentStores', ...UNIVERSAL_KEYS];
    const [synced, local] = await Promise.all([
      chrome.storage.sync.get(keys),
      chrome.storage.local.get(keys)
    ]);
    state.badgeMode = synced.badgeMode || local.badgeMode || 'full';
    state.persistentHide = !!(synced[`hide:${host}`] ?? local[`hide:${host}`]);
    state.recentStores = synced.recentStores || {};
    for (const key of UNIVERSAL_KEYS) state[key] = !!synced[key];
  };

  const setBadgeMode = async (mode) => {
    state.badgeMode = mode;
    await chrome.storage.sync.set({ badgeMode: mode });
    renderBadge();
  };

  const setPersistentHide = async (on) => {
    state.persistentHide = on;
    if (on) await chrome.storage.sync.set({ [`hide:${host}`]: true });
    else
      await Promise.all([
        chrome.storage.sync.remove(`hide:${host}`),
        chrome.storage.local.remove(`hide:${host}`)
      ]);
    syncHideCss();
    refreshPanel();
  };

  const setSessionHide = (on) => {
    state.sessionHide = on;
    syncHideCss();
    refreshPanel();
  };

  const setUniversal = async (key, on) => {
    state[key] = !!on;
    await chrome.storage.sync.set({ [key]: !!on });
    refreshPanel();
  };

  // ---------- recent stores ----------

  const saveRecent = () => chrome.storage.sync.set({ recentStores: state.recentStores });

  const recordRecent = async () => {
    let handle;
    const patch = {};
    if (IS_ADMIN) {
      const ctx = adminCtx();
      if (!ctx) return;
      handle = ctx.handle;
    } else {
      handle = storeHandle(state.data?.shop);
      if (!handle) return;
      patch.shop = state.data.shop;
      // Don't let the customizer's myshopify preview frame clobber a custom
      // domain recorded from a real storefront visit.
      if (!state.data.designMode) patch.origin = location.origin;
      const t = state.data.theme;
      if (t) {
        if (t.role === 'main') patch.liveTheme = { id: t.id, name: t.name };
        else patch.lastTheme = { id: t.id, name: t.name, role: t.role };
      }
    }
    const prev = state.recentStores[handle] || {};
    const entry = { ...prev, handle, ...patch, lastVisited: Date.now() };
    // Skip writes that change nothing material (several preview frames record
    // at once; sync storage has a write-rate quota).
    const strip = (e) => JSON.stringify({ ...e, lastVisited: 0 });
    if (strip(prev) === strip(entry) && Date.now() - (prev.lastVisited || 0) < 5 * 60 * 1000)
      return;
    state.recentStores[handle] = entry;
    const byRecency = Object.values(state.recentStores).sort(
      (a, b) => (b.lastVisited || 0) - (a.lastVisited || 0)
    );
    for (const stale of byRecency.slice(RECENT_MAX)) delete state.recentStores[stale.handle];
    try {
      await saveRecent();
    } catch {
      // sync quota exceeded - recent list is best-effort
    }
  };

  const storeLinks = (e) => {
    const origin = e.origin || `https://${e.shop || `${e.handle}.myshopify.com`}`;
    const admin = `https://admin.shopify.com/store/${e.handle}`;
    return {
      live: origin,
      liveEditor: e.liveTheme ? `${admin}/themes/${e.liveTheme.id}/editor` : `${admin}/themes`,
      offline: e.lastTheme ? `${origin}/?preview_theme_id=${e.lastTheme.id}` : null,
      offlineEditor: e.lastTheme ? `${admin}/themes/${e.lastTheme.id}/editor` : null,
      admin
    };
  };

  // ---------- badge UI ----------

  const BADGE_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .wrap { position: fixed; top: 12px; right: 12px; z-index: 2147483647; display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
    /* Admin: bottom-right so the pill never covers the editor's Save/Publish
       buttons; the panel opens upward. */
    .wrap.bottom { top: auto; bottom: 12px; flex-direction: column-reverse; }
    .pill { display: flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 999px; cursor: pointer; user-select: none; color: #fff; font-size: 12px; font-weight: 600; line-height: 1; box-shadow: 0 2px 8px rgba(0,0,0,.25); border: none; }
    .pill.live { background: #108043; }
    .pill.preview { background: #c05717; }
    .pill.dev { background: #d81b60; }
    .pill.admin { background: #5c6ac4; }
    .pill .dotmark { width: 8px; height: 8px; border-radius: 50%; background: #fff; flex: none; }
    .pill.dot-only { padding: 6px; }
    .pill.dot-only .label { display: none; }
    .panel { background: #1a1a1a; color: #eee; border-radius: 10px; padding: 12px; width: min(300px, calc(100vw - 24px)); font-size: 12px; box-shadow: 0 4px 16px rgba(0,0,0,.35); }
    .panel h1 { font-size: 12px; margin: 0 0 2px; font-weight: 700; }
    .panel .meta { color: #aaa; margin: 0 0 10px; word-break: break-all; }
    .panel .status { color: #aaa; margin: 0 0 10px; }
    .tabs { display: flex; gap: 4px; margin: 0 0 10px; }
    .tabs button { flex: 1; background: none; border: 1px solid #444; color: #aaa; border-radius: 5px; padding: 4px 0; font-size: 10px; cursor: pointer; }
    .tabs button.on { border-color: #0b5cad; background: #0b5cad; color: #fff; }
    .row { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
    .row:last-child { margin-bottom: 0; }
    button.act { flex: 1 1 45%; background: #333; color: #eee; border: 1px solid #444; border-radius: 6px; padding: 6px 8px; font-size: 11px; cursor: pointer; }
    button.act:hover { background: #3d3d3d; }
    button.act.on { background: #0b5cad; border-color: #0b5cad; color: #fff; }
    .uni { margin-top: 10px; padding-top: 8px; border-top: 1px solid #333; }
    .uni .unihead { color: #888; margin: 0 0 6px; }
    .modes { display: flex; gap: 4px; align-items: center; margin-top: 10px; padding-top: 8px; border-top: 1px solid #333; }
    .modes span { color: #888; margin-right: 4px; }
    .modes button { background: none; border: 1px solid #444; color: #aaa; border-radius: 5px; padding: 3px 7px; font-size: 10px; cursor: pointer; }
    .modes button.on { border-color: #0b5cad; color: #fff; background: #0b5cad; }
    .store { border: 1px solid #333; border-radius: 8px; padding: 8px; margin-bottom: 6px; }
    .store .shead { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 4px; }
    .store .shead b { font-size: 12px; word-break: break-all; }
    .store .bin { background: none; border: none; color: #888; cursor: pointer; padding: 2px; display: flex; flex: none; }
    .store .bin:hover { color: #e66; }
    .store p { margin: 3px 0; color: #aaa; }
    .store a { color: #6ba7ff; text-decoration: none; }
    .store a:hover { text-decoration: underline; }
    .emptynote { color: #888; margin: 4px 0 8px; }
    .hidden { display: none !important; }
    /* Mobile: Shopify's bar behaves differently and screen space is tight -
       auto-collapse the pill to a dot; the panel still opens on tap. */
    @media (max-width: 640px) {
      .pill { padding: 6px; }
      .pill .label { display: none; }
    }
  `;

  // Lucide trash-2
  const BIN_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>';

  const buildBadge = () => {
    if (ui) return;
    // Custom-element tag, not a <div>: the host lives in the page's light DOM
    // (a shadow root shields its contents, never the host itself), so page CSS
    // can target it. A real culprit here was an extension injecting
    // `div:empty { display: none }` - our host is :empty in light-DOM terms
    // because all content sits in the shadow tree. A non-div tag dodges the
    // whole class of div/element-targeting rules; the inline display guard
    // below covers the rest (`*:empty`, `[id]`, etc.).
    const hostEl = document.createElement('shopifybar-badge');
    hostEl.id = '__shopifybar-badge';
    hostEl.style.setProperty('display', 'block', 'important');
    const shadow = hostEl.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = BADGE_CSS;
    shadow.appendChild(style);

    const wrap = document.createElement('div');
    wrap.className = 'wrap' + (IS_ADMIN ? ' bottom' : '');

    const pill = document.createElement('button');
    pill.className = 'pill';
    const dotmark = document.createElement('span');
    dotmark.className = 'dotmark';
    const label = document.createElement('span');
    label.className = 'label';
    pill.append(dotmark, label);

    const panel = document.createElement('div');
    panel.className = 'panel hidden';

    pill.addEventListener('click', () => {
      panel.classList.toggle('hidden');
      if (!panel.classList.contains('hidden')) refreshPanel();
    });

    wrap.append(pill, panel);
    shadow.appendChild(wrap);
    document.documentElement.appendChild(hostEl);

    ui = { hostEl, wrap, pill, label, panel };
  };

  const panelButton = (text, onClick, isOn = false) => {
    const b = document.createElement('button');
    b.className = 'act' + (isOn ? ' on' : '');
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  };

  const universalSection = () => {
    const uni = document.createElement('div');
    uni.className = 'uni';
    const head = document.createElement('p');
    head.className = 'unihead';
    head.textContent = 'Customizer (all stores):';
    const row = document.createElement('div');
    row.className = 'row';
    row.append(
      panelButton('Pin right bar', () => setUniversal('pinRightBar', !state.pinRightBar), state.pinRightBar),
      panelButton('Hide AI bar', () => setUniversal('hideAiBar', !state.hideAiBar), state.hideAiBar),
      panelButton('Fullscreen', () => setUniversal('editorFullscreen', !state.editorFullscreen), state.editorFullscreen)
    );
    uni.append(head, row);
    return uni;
  };

  const modesSection = () => {
    const modes = document.createElement('div');
    modes.className = 'modes';
    const modesLabel = document.createElement('span');
    modesLabel.textContent = 'Badge:';
    modes.appendChild(modesLabel);
    for (const mode of ['full', 'dot', 'off']) {
      const b = document.createElement('button');
      b.textContent = mode;
      if (state.badgeMode === mode) b.classList.add('on');
      b.addEventListener('click', () => setBadgeMode(mode));
      modes.appendChild(b);
    }
    return modes;
  };

  const tabsSection = () => {
    const tabs = document.createElement('div');
    tabs.className = 'tabs';
    for (const [tab, text] of [
      ['current', 'Current'],
      ['recent', 'Recent']
    ]) {
      const b = document.createElement('button');
      b.textContent = text;
      if (state.panelTab === tab) b.classList.add('on');
      b.addEventListener('click', () => {
        state.panelTab = tab;
        refreshPanel();
      });
      tabs.appendChild(b);
    }
    return tabs;
  };

  const link = (href, text) => {
    const a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = text;
    return a;
  };

  const renderRecentTab = (panel) => {
    const entries = Object.values(state.recentStores).sort(
      (a, b) => (b.lastVisited || 0) - (a.lastVisited || 0)
    );
    if (!entries.length) {
      const p = document.createElement('p');
      p.className = 'emptynote';
      p.textContent = 'No stores recorded yet. Visit a storefront or its customizer.';
      panel.appendChild(p);
      return;
    }
    for (const e of entries) {
      const links = storeLinks(e);
      const box = document.createElement('div');
      box.className = 'store';

      const head = document.createElement('div');
      head.className = 'shead';
      const name = document.createElement('b');
      name.textContent = e.handle;
      const bin = document.createElement('button');
      bin.className = 'bin';
      bin.title = `Remove ${e.handle} from recent`;
      bin.innerHTML = BIN_SVG;
      bin.addEventListener('click', async () => {
        delete state.recentStores[e.handle];
        await saveRecent();
        refreshPanel();
      });
      head.append(name, bin);
      box.appendChild(head);

      const liveLine = document.createElement('p');
      liveLine.append('Live: ', link(links.live, 'storefront'), ' · ', link(links.liveEditor, 'customizer'));
      box.appendChild(liveLine);

      if (e.lastTheme) {
        const offLine = document.createElement('p');
        const label = e.lastTheme.role === 'development' ? 'Dev' : 'Offline';
        offLine.append(
          `${label} (${e.lastTheme.name || `#${e.lastTheme.id}`}): `,
          link(links.offline, 'preview'),
          ' · ',
          link(links.offlineEditor, 'customizer')
        );
        box.appendChild(offLine);
      }

      const adminLine = document.createElement('p');
      adminLine.append(link(links.admin, 'Store admin'));
      box.appendChild(adminLine);

      panel.appendChild(box);
    }

    // Two-step clear-all: no blocking confirm() dialogs on the page.
    const clearRow = document.createElement('div');
    clearRow.className = 'row';
    const clearBtn = panelButton('Clear all recent stores', async () => {
      if (clearBtn.dataset.armed) {
        state.recentStores = {};
        await saveRecent();
        refreshPanel();
      } else {
        clearBtn.dataset.armed = '1';
        clearBtn.textContent = 'Click again to clear all';
      }
    });
    clearRow.appendChild(clearBtn);
    panel.appendChild(clearRow);
  };

  const renderStorefrontCurrent = (panel) => {
    const { theme } = state.data;

    const title = document.createElement('h1');
    title.textContent = theme.name || 'Unknown theme';
    const meta = document.createElement('p');
    meta.className = 'meta';
    meta.textContent = `#${theme.id} - ${themeRoleIsLive() ? 'live theme' : `role: ${theme.role}`}`;

    const status = document.createElement('p');
    status.className = 'status';
    const hiddenByUs = state.sessionHide || state.persistentHide;
    status.textContent = shopifyBarPresent()
      ? hiddenByUs
        ? 'Shopify bar: hidden by ShopifyBar'
        : 'Shopify bar: visible'
      : themeRoleIsLive()
        ? 'Shopify bar: not present (normal on live theme - Restore bar can force it)'
        : 'Shopify bar: not present (hidden by Shopify - use Restore bar)';

    const rowHide = document.createElement('div');
    rowHide.className = 'row';
    rowHide.append(
      panelButton(
        state.sessionHide ? 'Shown next load' : 'Hide this load',
        () => setSessionHide(!state.sessionHide),
        state.sessionHide
      ),
      panelButton(
        state.persistentHide ? 'Unhide (this store)' : 'Hide till unhide',
        () => setPersistentHide(!state.persistentHide),
        state.persistentHide
      )
    );

    const rowActions = document.createElement('div');
    rowActions.className = 'row';
    const btnFix = panelButton('Restore bar', () => {
      restoreBar();
    });
    btnFix.title =
      "Brings Shopify's preview bar back (clears ShopifyBar hides, reloads with preview_theme_id and pb=1). Use when Shopify's own hide has kept it away.";
    rowActions.append(
      btnFix,
      panelButton('Copy preview link', async (e) => {
        const l = previewLink();
        if (!l) return;
        await navigator.clipboard.writeText(l);
        e.target.textContent = 'Copied';
        setTimeout(() => (e.target.textContent = 'Copy preview link'), 1200);
      })
    );
    const editor = editorUrl();
    if (editor) {
      rowActions.append(panelButton('Open theme editor', () => window.open(editor, '_blank')));
    }

    panel.append(title, meta, status, rowHide, rowActions, universalSection(), modesSection());
  };

  const renderAdminCurrent = (panel) => {
    const ctx = adminCtx();
    const rec = ctx ? state.recentStores[ctx.handle] : null;
    const title = document.createElement('h1');
    const meta = document.createElement('p');
    meta.className = 'meta';

    const rowActions = document.createElement('div');
    rowActions.className = 'row';

    if (ctx?.isEditor) {
      const theme = adminTheme(ctx);
      title.textContent = theme.name || `Theme #${ctx.themeId}`;
      meta.textContent = `#${ctx.themeId} - ${theme.role ? (theme.role === 'main' ? 'live theme' : `role: ${theme.role}`) : 'customizer'}`;
      const origin = rec?.origin || `https://${ctx.handle}.myshopify.com`;
      const viewUrl =
        theme.role === 'main' ? origin : `${origin}/?preview_theme_id=${ctx.themeId}`;
      rowActions.append(
        panelButton('Open storefront', () => window.open(viewUrl, '_blank')),
        panelButton('Copy preview link', async (e) => {
          await navigator.clipboard.writeText(viewUrl);
          e.target.textContent = 'Copied';
          setTimeout(() => (e.target.textContent = 'Copy preview link'), 1200);
        })
      );
    } else if (ctx) {
      title.textContent = ctx.handle;
      meta.textContent = `Store admin - ${ctx.handle}`;
      const origin = rec?.origin || `https://${ctx.handle}.myshopify.com`;
      rowActions.append(
        panelButton('Open storefront', () => window.open(origin, '_blank')),
        panelButton('Themes', () =>
          window.open(`https://admin.shopify.com/store/${ctx.handle}/themes`, '_blank')
        )
      );
    }

    panel.append(title, meta, rowActions, universalSection(), modesSection());
  };

  const refreshPanel = () => {
    if (!ui || ui.panel.classList.contains('hidden')) return;
    const panel = ui.panel;
    panel.textContent = '';
    panel.appendChild(tabsSection());
    if (state.panelTab === 'recent') renderRecentTab(panel);
    else if (IS_ADMIN) renderAdminCurrent(panel);
    else renderStorefrontCurrent(panel);
  };

  const removeBadge = () => {
    if (ui) {
      ui.hostEl.remove();
      ui = null;
    }
  };

  const renderStorefrontBadge = () => {
    if (!state.data?.isShopify || state.data.designMode) return;
    buildBadge();
    const { theme } = state.data;
    const cls = roleClass(theme.role);
    ui.pill.className = `pill ${cls}${state.badgeMode === 'dot' ? ' dot-only' : ''}`;
    ui.pill.title = `${roleLabel(theme.role)}: ${theme.name} (#${theme.id})`;
    ui.label.textContent = `${roleLabel(theme.role)} - ${theme.name}`;
  };

  const renderAdminBadge = () => {
    const ctx = adminCtx();
    if (!ctx) {
      removeBadge();
      return;
    }
    buildBadge();
    let cls, text, tip;
    if (ctx.isEditor) {
      const theme = adminTheme(ctx);
      cls = theme.role ? roleClass(theme.role) : 'preview';
      const name = theme.name || `#${ctx.themeId}`;
      text = `${roleLabel(theme.role)} - ${name}`;
      tip = `${roleLabel(theme.role)}: ${name} (#${ctx.themeId})`;
    } else {
      cls = 'admin';
      text = `ADMIN - ${ctx.handle}`;
      tip = `Shopify admin: ${ctx.handle}`;
    }
    ui.pill.className = `pill ${cls}${state.badgeMode === 'dot' ? ' dot-only' : ''}`;
    ui.pill.title = tip;
    ui.label.textContent = text;
  };

  const renderBadge = () => {
    if (state.badgeMode === 'off') {
      removeBadge();
      return;
    }
    if (IS_ADMIN) renderAdminBadge();
    else renderStorefrontBadge();
  };

  // ---------- popup messaging (top frames only: the customizer's preview
  // iframes must not race the admin frame answering getState) ----------

  if (IS_TOP) {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type === 'getState') {
        const universal = {
          pinRightBar: state.pinRightBar,
          hideAiBar: state.hideAiBar,
          editorFullscreen: state.editorFullscreen,
          badgeMode: state.badgeMode
        };
        if (IS_ADMIN) {
          const ctx = adminCtx();
          if (!ctx) {
            sendResponse({ active: false });
            return;
          }
          const rec = state.recentStores[ctx.handle];
          const theme = ctx.isEditor ? adminTheme(ctx) : null;
          const origin = rec?.origin || `https://${ctx.handle}.myshopify.com`;
          sendResponse({
            active: true,
            context: 'admin',
            handle: ctx.handle,
            isEditor: ctx.isEditor,
            theme,
            storefrontUrl:
              theme && theme.role !== 'main'
                ? `${origin}/?preview_theme_id=${ctx.themeId}`
                : origin,
            ...universal
          });
          return;
        }
        sendResponse({
          active: !!state.data?.isShopify && !state.data.designMode,
          context: 'storefront',
          shop: state.data?.shop || null,
          theme: state.data?.theme || null,
          barPresent: shopifyBarPresent(),
          sessionHide: state.sessionHide,
          persistentHide: state.persistentHide,
          previewLink: previewLink(),
          editorUrl: editorUrl(),
          forceShowUrl: forceShowUrl(),
          ...universal
        });
        return;
      }
      if (msg?.type === 'setSessionHide') {
        setSessionHide(!!msg.on);
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === 'setPersistentHide') {
        setPersistentHide(!!msg.on).then(() => sendResponse({ ok: true }));
        return true;
      }
      if (msg?.type === 'setBadgeMode') {
        setBadgeMode(msg.mode).then(() => sendResponse({ ok: true }));
        return true;
      }
      if (msg?.type === 'setUniversal' && UNIVERSAL_KEYS.includes(msg.key)) {
        setUniversal(msg.key, !!msg.on).then(() => sendResponse({ ok: true }));
        return true;
      }
      if (msg?.type === 'forceShow') {
        sendResponse({ ok: true });
        restoreBar();
        return;
      }
    });
  }

  // ---------- cross-tab sync ----------

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (changes.badgeMode) state.badgeMode = changes.badgeMode.newValue || 'full';
    for (const key of UNIVERSAL_KEYS) {
      if (changes[key]) state[key] = !!changes[key].newValue;
    }
    if (changes[`hide:${host}`]) {
      state.persistentHide = !!changes[`hide:${host}`].newValue;
      syncHideCss();
    }
    if (changes.recentStores) state.recentStores = changes.recentStores.newValue || {};
    if (changes.badgeMode || changes.recentStores) renderBadge();
    refreshPanel();
  });

  // ---------- boot ----------

  let booted = false;

  if (IS_ADMIN) {
    if (IS_TOP) {
      (async () => {
        await loadSettings();
        renderBadge();
        recordRecent();
        // The admin is a SPA - poll for route changes to keep the badge and
        // recent-store record in step with the visible page.
        let href = location.href;
        setInterval(() => {
          if (location.href === href) return;
          href = location.href;
          renderBadge();
          refreshPanel();
          recordRecent();
        }, 1500);
      })();
    }
  } else {
    document.addEventListener('shopifybar:data', async (e) => {
      let payload;
      try {
        payload = JSON.parse(e.detail);
      } catch {
        return;
      }
      state.data = payload;
      if (booted || !payload.isShopify) return;
      booted = true;

      await loadSettings();
      if (payload.designMode) {
        // Customizer preview iframe: just report the edited theme upstream.
        recordRecent();
        return;
      }
      syncHideCss();
      renderBadge();
      recordRecent();
    });

    // window.Shopify may not be defined yet when document_idle fires on slow
    // loads; re-ask until the page reports a Shopify storefront (or we give up).
    let attempts = 0;
    const request = () => {
      if (booted || attempts++ >= 10) return;
      document.dispatchEvent(new CustomEvent('shopifybar:request'));
      setTimeout(request, 500);
    };
    request();
  }
})();
