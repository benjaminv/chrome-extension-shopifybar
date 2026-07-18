// Toolbar popup: mirrors the on-page badge state and controls, and is the
// only UI when the badge mode is "off". Works on storefront tabs and on
// admin.shopify.com (store admin / customizer) tabs.
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

const roleClass = (role) =>
  role === 'main' ? 'live' : role === 'development' ? 'dev' : 'preview';

const roleLabel = (role) =>
  ({ main: 'LIVE', development: 'DEV', unpublished: 'OFFLINE', demo: 'DEMO' })[role] || 'THEME';

const renderUniversal = (s) => {
  for (const b of document.querySelectorAll('.uni button.act')) {
    b.classList.toggle('on', !!s[b.dataset.key]);
  }
};

const render = () => {
  const s = current;
  if (!s || !s.active) {
    setInactive('Not a Shopify storefront or admin tab.');
    return;
  }
  $('main').classList.remove('hidden');
  const banner = $('banner');

  if (s.context === 'admin') {
    if (s.isEditor && s.theme) {
      banner.className = `banner ${s.theme.role ? roleClass(s.theme.role) : 'preview'}`;
      banner.textContent = `${roleLabel(s.theme.role)} - CUSTOMIZER`;
      $('themeName').textContent = s.theme.name || `Theme #${s.theme.id}`;
      $('themeMeta').textContent = `#${s.theme.id} - ${s.theme.role ? (s.theme.role === 'main' ? 'live theme' : `role: ${s.theme.role}`) : 'customizer'} - ${s.handle}`;
    } else {
      banner.className = 'banner admin';
      banner.textContent = 'STORE ADMIN';
      $('themeName').textContent = s.handle;
      $('themeMeta').textContent = `admin.shopify.com/store/${s.handle}`;
    }
    $('barStatus').classList.add('hidden');
    $('rowHide').classList.add('hidden');
    $('btnForceShow').classList.add('hidden');
    $('btnCopy').classList.add('hidden');
    $('btnEditor').classList.add('hidden');
    $('btnStorefront').classList.remove('hidden');
  } else {
    const live = s.theme.role === 'main';
    banner.className = `banner ${roleClass(s.theme.role)}`;
    banner.textContent = `${roleLabel(s.theme.role)} THEME`;

    $('themeName').textContent = s.theme.name || 'Unknown theme';
    $('themeMeta').textContent =
      `#${s.theme.id} - ${live ? 'live theme' : `role: ${s.theme.role}`}` +
      (s.shop ? ` - ${s.shop}` : '');

    $('barStatus').classList.remove('hidden');
    $('rowHide').classList.remove('hidden');
    $('btnForceShow').classList.remove('hidden');
    $('btnCopy').classList.remove('hidden');
    $('btnStorefront').classList.add('hidden');

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
  }

  renderUniversal(s);

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
  $('btnStorefront').addEventListener('click', () => {
    if (current?.storefrontUrl) chrome.tabs.create({ url: current.storefrontUrl });
  });
  document.querySelectorAll('.uni button.act').forEach((b) => {
    b.addEventListener('click', async () => {
      await send({ type: 'setUniversal', key: b.dataset.key, on: !current[b.dataset.key] });
      refresh();
    });
  });
  document.querySelectorAll('.modes button').forEach((b) => {
    b.addEventListener('click', async () => {
      await send({ type: 'setBadgeMode', mode: b.dataset.mode });
      refresh();
    });
  });
};

init();
