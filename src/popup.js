// Toolbar popup: mirrors the on-page badge state and controls, and is the
// only UI when the badge mode is "off".
const $ = (id) => document.getElementById(id);

let tabId = null;
let current = null;

const send = (msg) =>
  new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, msg, (res) => {
      // Swallow "no receiving end" for non-Shopify / restricted pages.
      void chrome.runtime.lastError;
      resolve(res);
    });
  });

const setInactive = (text) => {
  const banner = $('banner');
  banner.className = 'banner inactive';
  banner.textContent = text;
  $('main').classList.add('hidden');
};

const render = () => {
  const s = current;
  if (!s || !s.active) {
    setInactive('Not a Shopify storefront tab (or the theme editor).');
    return;
  }

  const live = s.theme.role === 'main';
  const banner = $('banner');
  banner.className = `banner ${live ? 'live' : 'preview'}`;
  banner.textContent = live ? 'LIVE THEME' : 'PREVIEW THEME';

  $('main').classList.remove('hidden');
  $('themeName').textContent = s.theme.name || 'Unknown theme';
  $('themeMeta').textContent =
    `#${s.theme.id} - ${live ? 'live theme' : `role: ${s.theme.role}`}` +
    (s.shop ? ` - ${s.shop}` : '');

  const hiddenByUs = s.sessionHide || s.persistentHide;
  $('barStatus').textContent = s.barPresent
    ? hiddenByUs
      ? 'Shopify bar: hidden by ShopifyBar'
      : 'Shopify bar: visible'
    : live
      ? 'Shopify bar: not present (normal on live theme - Restore bar can force it)'
      : 'Shopify bar: not present (hidden by Shopify - use Restore bar)';

  const btnSession = $('btnSessionHide');
  btnSession.textContent = s.sessionHide ? 'Shown next load' : 'Hide this load';
  btnSession.classList.toggle('on', s.sessionHide);

  const btnPersistent = $('btnPersistentHide');
  btnPersistent.textContent = s.persistentHide ? 'Unhide (this store)' : 'Hide till unhide';
  btnPersistent.classList.toggle('on', s.persistentHide);

  $('btnEditor').classList.toggle('hidden', !s.editorUrl);

  document.querySelectorAll('.modes button').forEach((b) => {
    b.classList.toggle('on', b.dataset.mode === s.badgeMode);
  });
};

const refresh = async () => {
  current = await send({ type: 'getState' });
  render();
};

const init = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    setInactive('No active tab.');
    return;
  }
  tabId = tab.id;
  await refresh();
  if (!current) return;

  $('btnSessionHide').addEventListener('click', async () => {
    await send({ type: 'setSessionHide', on: !current.sessionHide });
    refresh();
  });
  $('btnPersistentHide').addEventListener('click', async () => {
    await send({ type: 'setPersistentHide', on: !current.persistentHide });
    refresh();
  });
  $('btnForceShow').addEventListener('click', async () => {
    await send({ type: 'forceShow' });
    window.close();
  });
  $('btnCopy').addEventListener('click', async (e) => {
    if (!current?.previewLink) return;
    await navigator.clipboard.writeText(current.previewLink);
    e.target.textContent = 'Copied';
    setTimeout(() => (e.target.textContent = 'Copy preview link'), 1200);
  });
  $('btnEditor').addEventListener('click', () => {
    if (current?.editorUrl) chrome.tabs.create({ url: current.editorUrl });
  });
  document.querySelectorAll('.modes button').forEach((b) => {
    b.addEventListener('click', async () => {
      await send({ type: 'setBadgeMode', mode: b.dataset.mode });
      refresh();
    });
  });
};

init();
