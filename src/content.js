// Isolated-world content script. Receives Shopify data from main-world.js,
// renders the on-page badge, manages preview-bar hiding, and serves state to
// the popup.
(() => {
  const HIDE_STYLE_ID = '__shopifybar-hide';
  const host = location.host;

  const state = {
    data: null, // { isShopify, designMode, shop, theme }
    badgeMode: 'full', // 'full' | 'dot' | 'off'
    sessionHide: false, // hide for current page load only (in-memory)
    persistentHide: false // hide until unhide, per store (chrome.storage)
  };

  let ui = null; // { root, pill, panel, ... }

  // ---------- preview bar hiding ----------

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

  const adminHandle = () => {
    const shop = state.data?.shop || '';
    return shop.endsWith('.myshopify.com') ? shop.slice(0, -'.myshopify.com'.length) : null;
  };

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
    if (id && !themeRoleIsLive()) url.searchParams.set('preview_theme_id', String(id));
    url.searchParams.set('pb', '1');
    return url.toString();
  };

  // ---------- storage ----------

  const loadSettings = async () => {
    const keys = ['badgeMode', `hide:${host}`];
    const stored = await chrome.storage.local.get(keys);
    state.badgeMode = stored.badgeMode || 'full';
    state.persistentHide = !!stored[`hide:${host}`];
  };

  const setBadgeMode = async (mode) => {
    state.badgeMode = mode;
    await chrome.storage.local.set({ badgeMode: mode });
    renderBadge();
  };

  const setPersistentHide = async (on) => {
    state.persistentHide = on;
    if (on) await chrome.storage.local.set({ [`hide:${host}`]: true });
    else await chrome.storage.local.remove(`hide:${host}`);
    syncHideCss();
    refreshPanel();
  };

  const setSessionHide = (on) => {
    state.sessionHide = on;
    syncHideCss();
    refreshPanel();
  };

  // ---------- badge UI ----------

  const BADGE_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .wrap { position: fixed; top: 12px; right: 12px; z-index: 2147483647; display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
    .pill { display: flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 999px; cursor: pointer; user-select: none; color: #fff; font-size: 12px; font-weight: 600; line-height: 1; box-shadow: 0 2px 8px rgba(0,0,0,.25); border: none; }
    .pill.live { background: #108043; }
    .pill.preview { background: #c05717; }
    .pill .dotmark { width: 8px; height: 8px; border-radius: 50%; background: #fff; flex: none; }
    .pill.dot-only { padding: 6px; }
    .pill.dot-only .label { display: none; }
    .panel { background: #1a1a1a; color: #eee; border-radius: 10px; padding: 12px; width: min(280px, calc(100vw - 24px)); font-size: 12px; box-shadow: 0 4px 16px rgba(0,0,0,.35); }
    .panel h1 { font-size: 12px; margin: 0 0 2px; font-weight: 700; }
    .panel .meta { color: #aaa; margin: 0 0 10px; word-break: break-all; }
    .panel .status { color: #aaa; margin: 0 0 10px; }
    .row { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
    .row:last-child { margin-bottom: 0; }
    button.act { flex: 1 1 45%; background: #333; color: #eee; border: 1px solid #444; border-radius: 6px; padding: 6px 8px; font-size: 11px; cursor: pointer; }
    button.act:hover { background: #3d3d3d; }
    button.act.on { background: #0b5cad; border-color: #0b5cad; color: #fff; }
    .modes { display: flex; gap: 4px; align-items: center; margin-top: 10px; padding-top: 8px; border-top: 1px solid #333; }
    .modes span { color: #888; margin-right: 4px; }
    .modes button { background: none; border: 1px solid #444; color: #aaa; border-radius: 5px; padding: 3px 7px; font-size: 10px; cursor: pointer; }
    .modes button.on { border-color: #0b5cad; color: #fff; background: #0b5cad; }
    .hidden { display: none !important; }
    /* Mobile: Shopify's bar behaves differently and screen space is tight -
       auto-collapse the pill to a dot; the panel still opens on tap. */
    @media (max-width: 640px) {
      .pill { padding: 6px; }
      .pill .label { display: none; }
    }
  `;

  const buildBadge = () => {
    if (ui) return;
    const hostEl = document.createElement('div');
    hostEl.id = '__shopifybar-badge';
    const shadow = hostEl.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = BADGE_CSS;
    shadow.appendChild(style);

    const wrap = document.createElement('div');
    wrap.className = 'wrap';

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

    ui = { hostEl, pill, label, panel };
  };

  const panelButton = (text, onClick, isOn = false) => {
    const b = document.createElement('button');
    b.className = 'act' + (isOn ? ' on' : '');
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  };

  const refreshPanel = () => {
    if (!ui || ui.panel.classList.contains('hidden')) return;
    const { theme } = state.data;
    const panel = ui.panel;
    panel.textContent = '';

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
        ? 'Shopify bar: not present (live theme)'
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
      location.href = forceShowUrl();
    });
    btnFix.title =
      "Brings Shopify's preview bar back (reloads with preview_theme_id and pb=1). Use when Shopify's own hide has kept it away.";
    rowActions.append(
      btnFix,
      panelButton('Copy preview link', async (e) => {
        const link = previewLink();
        if (!link) return;
        await navigator.clipboard.writeText(link);
        e.target.textContent = 'Copied';
        setTimeout(() => (e.target.textContent = 'Copy preview link'), 1200);
      })
    );
    const editor = editorUrl();
    if (editor) {
      rowActions.append(
        panelButton('Open theme editor', () => window.open(editor, '_blank'))
      );
    }

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

    panel.append(title, meta, status, rowHide, rowActions, modes);
  };

  const renderBadge = () => {
    if (!state.data?.isShopify || state.data.designMode) return;
    if (state.badgeMode === 'off') {
      if (ui) ui.hostEl.remove(), (ui = null);
      return;
    }
    buildBadge();
    const { theme } = state.data;
    const live = themeRoleIsLive();
    ui.pill.className = `pill ${live ? 'live' : 'preview'}${state.badgeMode === 'dot' ? ' dot-only' : ''}`;
    ui.pill.title = `${live ? 'LIVE' : 'PREVIEW'}: ${theme.name} (#${theme.id})`;
    ui.label.textContent = live ? `LIVE - ${theme.name}` : `PREVIEW - ${theme.name}`;
  };

  // ---------- popup messaging ----------

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'getState') {
      sendResponse({
        active: !!state.data?.isShopify && !state.data.designMode,
        shop: state.data?.shop || null,
        theme: state.data?.theme || null,
        barPresent: shopifyBarPresent(),
        sessionHide: state.sessionHide,
        persistentHide: state.persistentHide,
        badgeMode: state.badgeMode,
        previewLink: previewLink(),
        editorUrl: editorUrl(),
        forceShowUrl: forceShowUrl()
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
    if (msg?.type === 'forceShow') {
      location.href = forceShowUrl();
      sendResponse({ ok: true });
      return;
    }
  });

  // ---------- boot ----------

  document.addEventListener('shopifybar:data', async (e) => {
    let payload;
    try {
      payload = JSON.parse(e.detail);
    } catch {
      return;
    }
    if (state.data) {
      state.data = payload;
      return;
    }
    state.data = payload;
    if (!payload.isShopify) return;

    await loadSettings();
    syncHideCss();
    if (!payload.designMode) renderBadge();
  });

  document.dispatchEvent(new CustomEvent('shopifybar:request'));
})();
