# Build log

## 2026-07-18 - v0.2.0 - theme editor tweaks, recent stores, admin badge

Big scope expansion: the extension now works inside the Shopify admin and theme editor (customizer), not just storefronts.

- **Theme editor tweaks** (three universal toggles, `chrome.storage.sync`, apply to every store):
  - **Pin right bar**: Shopify's 2025+ editor only shows the settings sidebar when a section/block is selected, causing a huge preview shift on every select/deselect (and under ~1608px window width it stacks over the left bar instead). The editor layout is a CSS grid on `PowerFrame__MainInterior` (`300px 1380px 0px 0px` unselected → `300px 1080px 300px 0px` selected); pinning forces the third column to 300px at all times so the preview never moves.
  - **Hide AI bar**: the floating Sidekick "Ask for changes" bar over the preview (`div[class*="_FloatingControlsWrapper_"]`) is hidden until toggled back.
  - **Fullscreen**: rebuilds the old editor's full-width view - collapses both sidebar columns (`0px 1fr 0px 0px` + `visibility: hidden` on the panels; `display: none` breaks grid auto-placement). Also injected as a native-looking button in the editor top bar right after the device-preview icon (Lucide maximize/minimize, classes borrowed from the neighbouring button, MutationObserver re-inserts it after React re-renders).
  - Architecture: the whole editor UI lives in a cross-origin iframe (`online-store-web.shopifyapps.com`), so a new `src/editor.js` content script runs there with `all_frames: true`. Selectors verified live on 2026-07-18; CSS-module hash suffixes are unstable so selectors match stable prefixes/ids only.
- **Badge on admin + customizer**: `content.js` now renders the badge on `admin.shopify.com` too (bottom-right so it never covers Save/Publish; panel opens upward). Theme name/role in the customizer come from `recentStores` - written live by the same script running inside the customizer's *preview* iframe (`*.myshopify.com`, `all_frames`, design mode), where `window.Shopify.theme` reports the edited theme truthfully. Falls back to parsing the tab title. Non-editor admin pages get an indigo ADMIN badge.
- **Role colours**: live = green (unchanged), unpublished/offline = brown (unchanged), development (`shopify theme dev`) = pink `#d81b60`, admin = indigo `#5c6ac4`. Labels now LIVE / OFFLINE / DEV / DEMO instead of a catch-all PREVIEW.
- **Recent stores**: the badge panel gained Current/Recent tabs. Recent lists up to 20 stores (recorded from storefront, preview-iframe, and admin visits) with links to live storefront/customizer, last offline or dev theme preview/customizer, and store admin - plus a per-store bin (Lucide trash-2) and a two-step "Clear all" (no blocking `confirm()`). Stored in `recentStores` (sync), writes deduplicated against the sync write-rate quota.
- **Popup**: mirrors the three universal toggles and now works on admin/customizer tabs (role-coloured banner, Open storefront). `getState` responders are registered in top frames only so the customizer's preview iframes can't race the admin frame answering the popup.
- Verified via playwright simulation against the live lbtimber editor (extension sources injected verbatim with a stubbed `chrome.*`): pin (grid stays `300px 1080px 300px` with nothing selected), AI bar hidden, fullscreen toggle round-trip via the injected top-bar button, admin badge + panel tabs + recent links all rendering correctly.

## 2026-07-04 - v0.1.1 - fixes from first days of real usage

Four issues reported after a few days of use:

- **Restore bar on live theme did nothing** (`?pb=1` alone, e.g. on lbtimber.com.au). `forceShowUrl()` skipped `preview_theme_id` when the theme role was `main`, but `pb=1` is a no-op unless Shopify already has a preview session. Now always appends `preview_theme_id=<id>` - the id comes from `window.Shopify.theme.id`, available on any storefront without admin login, so no login-gating needed.
- **Restore bar left "Hide till unhide" active**, so the restored bar was immediately re-hidden by our own CSS. Restore now clears both hide flags (session + persistent) before reloading.
- **Badge missing on another computer.** Two causes addressed: (1) boot bug - the content script only initialised from the *first* `shopifybar:data` event, so if `window.Shopify` wasn't defined yet at `document_idle` the badge never appeared; now re-requests every 500ms (up to 10x) and boots on the first Shopify-positive payload. (2) settings moved from `chrome.storage.local` to `chrome.storage.sync` (reads fall back to local for existing installs) so badge mode and per-store hides follow the Chrome profile.
- **Badge invisible (follow-up), and the real root cause.** Even with the boot fix the pill stayed hidden - not just on lbtimber but on other stores too. Live-debugging via claude-in-chrome: the host existed but computed `display: none`, and a probe matrix (bare div hidden; div *with a text child* not hidden; span not hidden; rule not `!important`) fingerprinted a `div:empty { display: none }` rule coming from **another installed browser extension**, not the theme or Shopify. Our host is `:empty` in light-DOM terms because all its content lives in a shadow root, so the rule matched it. (This also corrects the shipped v0.1.0 claim that the closed shadow root makes the badge untouchable by page CSS - a shadow root shields its *contents*, never the *host*.) Fix: the host is now a custom element `<shopifybar-badge>` instead of a `<div>` (dodges the whole class of `div`/element-targeting rules), plus an inline `display: block !important` backstop for element-agnostic rules like `*:empty`. Verified live: host reports `SHOPIFYBAR-BADGE`, pill renders.
- **Null icon in extension managers.** Manifest had no `icons`/`default_icon`. Added generated PNGs (16/32/48/128): green rounded square, white dot top-right (the badge), white bar at the bottom (Shopify's preview bar).

Verified against lbtimber.com.au (Playwright, fresh session): `?preview_theme_id=<live id>&pb=1` 302-redirects to `?pb=1` while setting a preview-session cookie (`_shopify_essential`), after which Shopify serves `preview-bar-modules.js` and `#PBarNextFrameWrapper` renders - the bar DOES come back on the live theme. Plain `?pb=1` with no preview session serves nothing, confirming the original bug. So `preview_theme_id` must always be sent; no admin login needed (id read from `window.Shopify.theme.id`).

## 2026-07-03 - v0.1.0 built, open-sourced, and written up

Built in a single Claude Code session, from complaint to published extension.

- **Trigger**: Shopify's preview bar hide is a one-way door - once clicked, the bar stays gone until the next `preview_theme_id` URL, leaving devs and clients doing QA unsure which theme they are viewing.
- **Research**: confirmed the `pb=0`/`pb=1` session-cached toggle and the community history (see README references). Current bar DOM (`#PBarNextFrameWrapper`, `power_preview` attribute) came from Ben's manual CSS-override workaround; mobile renders a compact variant.
- **Design decisions** (agreed before coding):
  - All state from `window.Shopify.theme` (ground truth), read by a MAIN-world script, UI in a closed shadow root.
  - Hide via injected CSS only - never `pb=0` - so Shopify's cached state is never mutated and hiding can't get stuck.
  - Two hide modes: this page load (in-memory) / until unhide (per store, `chrome.storage.local`).
  - Badge always answers "which theme am I in?" (green LIVE / orange PREVIEW); configurable full/dot/off with the toolbar popup mirroring all controls.
  - "Restore bar" escape hatch reloads with `preview_theme_id=<id>&pb=1` to recover from Shopify's own stuck hide. (Label history: "Force show Shopify bar" wrapped; "Fix stuck bar" sounded alarming.)
- **Verified**: badge and panel confirmed working on a live storefront (desktop). Still to verify: mobile bar DOM coverage, `pb=1` recovery behaviour - see README checklist.
- **Write-up**: [The preview bar that wouldn't come back (so I built my own)](https://benhu.netlify.app/posts/the-preview-bar-that-wouldnt-come-back)
