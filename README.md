# ShopifyBar

A Chrome extension for Shopify devs and QA. Shopify's own preview bar is unreliable - once hidden (its state is cached in the session), it does not come back until a `preview_theme_id` URL is used again, leaving devs and clients unsure which theme they are looking at. ShopifyBar makes the current theme always visible and puts preview-bar hiding under your control.

## Features

- **Always-on theme badge**: a pill on every Shopify storefront page showing the theme name, colour-coded green `LIVE` or orange `PREVIEW`. Click it for details (theme ID, role, Shopify bar status) and actions. Auto-collapses to a dot on mobile viewports.
- **Hide Shopify's bar, two modes**:
  - *Hide this load* - hidden until the next navigation, then back to normal.
  - *Hide till unhide* - stays hidden on this store until you toggle it off. Per store, so other stores are unaffected.
  - Both modes hide the bar with injected CSS only. Shopify's own session state is never touched, so nothing gets stuck.
- **Restore bar**: reloads with `preview_theme_id=<current theme>&pb=1`, recovering the bar when Shopify's cached hide has eaten it.
- **Copy preview link**: current page URL with `preview_theme_id` set - shareable with QA.
- **Open theme editor**: jumps to the theme in admin (`admin.shopify.com/store/<handle>/themes/<id>/editor`).
- **Configurable UI**: the on-page badge can be `full`, `dot`, or `off` (popup-only). The toolbar popup mirrors all controls and always works.

## Install (unpacked)

1. `chrome://extensions`
2. Enable "Developer mode" (top right).
3. "Load unpacked" -> select this directory.

## How it works

- `src/main-world.js` runs in the page's MAIN world and reads `window.Shopify` (`theme.id`, `theme.name`, `theme.role`, `shop`, `designMode`), bridging it to the extension via a CustomEvent.
- `src/content.js` renders the badge in a closed shadow root (store CSS cannot break it) and injects/removes the hide CSS. Per-store and UI settings live in `chrome.storage.local`.
- `src/hide-css.js` holds the preview-bar selectors:
  - `#PBarNextFrameWrapper`, `[id^="PBar"]`, `[data-component-extra-ui_interaction_source="power_preview"]` - current bar (desktop and mobile variants)
  - `#preview-bar-iframe` - legacy bar
- The badge is suppressed inside the theme editor customiser (`Shopify.designMode`).
- No background worker, no build step, `storage` permission only. Runs on all http(s) hosts because storefronts use custom domains; it activates only when `window.Shopify.theme` exists.

## Verify before relying on it

- [ ] Desktop: badge shows correct theme on a live storefront (green) and in a `preview_theme_id` session (orange).
- [ ] Hide this load: bar disappears, returns on next navigation.
- [ ] Hide till unhide: persists across pages on the store; unhide restores it; second store unaffected.
- [ ] Restore bar: recovers the bar after hiding it via Shopify's own control.
- [ ] Mobile viewport: Shopify's compact bar variant is caught by the selectors; badge collapses to a dot.
- [ ] A store with a strict `style-src` CSP (would block the injected hide CSS - none seen on standard storefronts).

## Known limitations

- The `pb=1` force-show relies on behaviour reported by the dev community, not documented API; Shopify has changed this UI repeatedly.
- Checkout pages do not expose `window.Shopify.theme`, so the badge does not show there.
