// Runs inside the theme editor iframe (online-store-web.shopifyapps.com,
// all_frames). Applies the three universal customizer tweaks and injects a
// fullscreen toggle button into the editor top bar.
//
// Selector notes (verified live 2026-07-18):
// - The editor layout is a CSS grid on `PowerFrame__MainInterior` with
//   grid-template-columns: <left> <preview> <right> <extra>, e.g.
//   "300px 1380px 0px 0px" (nothing selected) or "300px 1080px 300px 0px"
//   (section/block selected). The right column appearing/disappearing is what
//   causes the page shift - pinning forces it to 300px at all times.
// - Sidebars: #PowerFrame-PortalArea-PrimaryPanel / -SecondaryPanel (stable
//   semantic ids). display:none breaks grid auto-placement (the preview
//   wrapper slides into the collapsed first column), so fullscreen collapses
//   the columns and hides the panels with visibility instead.
// - The Sidekick "Ask for changes" floating bar over the preview is
//   div[class*="_FloatingControlsWrapper_"] (CSS-module class, hash suffix
//   changes across builds - match on the stable prefix).
(() => {
  if (!/^\/themes\/\d+\/editor/.test(location.pathname)) return;

  const STYLE_ID = '__shopifybar-editor';
  const BTN_ID = '__shopifybar-fs-btn';

  const state = { pinRightBar: false, hideAiBar: false, editorFullscreen: false };

  // When the extension is reloaded/updated, content scripts already injected
  // into open tabs are orphaned: they keep running but every chrome.* call
  // throws "Extension context invalidated". chrome.runtime.id is undefined
  // once orphaned - detect that and tear down our button and CSS so the fresh
  // script (after a page refresh) is the only one leaving marks on the page.
  const orphaned = () => !chrome.runtime?.id;

  const teardown = () => {
    observer.disconnect();
    document.getElementById(STYLE_ID)?.remove();
    document.getElementById(BTN_ID)?.parentElement?.remove();
  };

  // Lucide maximize / minimize
  const ICON = (name) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
    (name === 'minimize'
      ? '<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>'
      : '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>') +
    '</svg>';

  const buildCss = () => {
    let css = '';
    if (state.hideAiBar) {
      css += 'div[class*="_FloatingControlsWrapper_"] { display: none !important; }\n';
    }
    if (state.editorFullscreen) {
      css +=
        'div[class*="PowerFrame__MainInterior"] { grid-template-columns: 0px 1fr 0px 0px !important; }\n' +
        '#PowerFrame-PortalArea-PrimaryPanel, #PowerFrame-PortalArea-SecondaryPanel' +
        ' { min-width: 0 !important; overflow: hidden !important; visibility: hidden !important; }\n';
    } else if (state.pinRightBar) {
      css += 'div[class*="PowerFrame__MainInterior"] { grid-template-columns: 300px 1fr 300px 0px !important; }\n';
    }
    return css;
  };

  const applyCss = () => {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      document.documentElement.appendChild(style);
    }
    style.textContent = buildCss();
  };

  // ---------- fullscreen top-bar button ----------

  const syncButtonIcon = () => {
    const btn = document.getElementById(BTN_ID);
    if (!btn) return;
    btn.innerHTML = ICON(state.editorFullscreen ? 'minimize' : 'maximize');
    btn.title = state.editorFullscreen ? 'Exit fullscreen (ShopifyBar)' : 'Fullscreen - hide both sidebars (ShopifyBar)';
    btn.setAttribute('aria-label', btn.title);
  };

  const ensureButton = () => {
    if (document.getElementById(BTN_ID)) return;
    // The device-preview toggle ("Show mobile view" / "Show desktop view")
    // sits in the top bar's right layout group; our button goes right after
    // it, borrowing its classes so it inherits the native look.
    const deviceBtn = document.querySelector(
      'button[aria-label*="mobile view" i], button[aria-label*="desktop view" i]'
    );
    if (!deviceBtn) return;
    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.className = deviceBtn.className;
    btn.style.display = 'inline-flex';
    btn.style.alignItems = 'center';
    btn.style.justifyContent = 'center';
    btn.addEventListener('click', () => {
      if (orphaned()) {
        teardown();
        return;
      }
      chrome.storage.sync.set({ editorFullscreen: !state.editorFullscreen });
    });
    const wrap = document.createElement('span');
    wrap.appendChild(btn);
    const anchor = deviceBtn.closest('span') || deviceBtn;
    anchor.insertAdjacentElement('afterend', wrap);
    syncButtonIcon();
  };

  // React re-renders can drop our injected button; watch and re-insert.
  let rafPending = false;
  const observer = new MutationObserver(() => {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      if (orphaned()) {
        teardown();
        return;
      }
      ensureButton();
    });
  });

  // ---------- boot ----------

  chrome.storage.sync.get(['pinRightBar', 'hideAiBar', 'editorFullscreen']).then((v) => {
    state.pinRightBar = !!v.pinRightBar;
    state.hideAiBar = !!v.hideAiBar;
    state.editorFullscreen = !!v.editorFullscreen;
    applyCss();
    ensureButton();
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    let dirty = false;
    for (const key of ['pinRightBar', 'hideAiBar', 'editorFullscreen']) {
      if (changes[key]) {
        state[key] = !!changes[key].newValue;
        dirty = true;
      }
    }
    if (dirty) {
      applyCss();
      syncButtonIcon();
    }
  });
})();
