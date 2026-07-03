// Runs in the page's MAIN world. Reads window.Shopify and bridges it to the
// isolated-world content script via CustomEvent. Payload is a JSON string
// because objects created in one world are not directly readable in another.
(() => {
  const send = () => {
    const S = window.Shopify;
    const payload = {
      isShopify: !!(S && S.theme),
      designMode: !!(S && S.designMode),
      shop: (S && S.shop) || null,
      theme: S && S.theme
        ? {
            id: S.theme.id,
            name: S.theme.name,
            role: S.theme.role,
            themeStoreId: S.theme.theme_store_id != null ? S.theme.theme_store_id : null
          }
        : null
    };
    document.dispatchEvent(
      new CustomEvent('shopifybar:data', { detail: JSON.stringify(payload) })
    );
  };

  document.addEventListener('shopifybar:request', send);
  send();
})();
