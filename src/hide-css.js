// Selectors covering Shopify's preview bar across its UI revisions.
// - #PBarNextFrameWrapper + power_preview: current bar (2025+ "PBar Next")
// - [id^="PBar"]: catch-all for PBar variants (mobile renders a compact
//   variant whose element may differ from desktop)
// - #preview-bar-iframe: legacy iframe bar
// Shared by content script and popup (plain script, attaches to globalThis).
const SHOPIFYBAR_HIDE_SELECTORS = [
  '#PBarNextFrameWrapper',
  '[id^="PBar"]',
  '[data-component-extra-ui_interaction_source="power_preview"]',
  '#preview-bar-iframe'
];

const SHOPIFYBAR_HIDE_CSS =
  SHOPIFYBAR_HIDE_SELECTORS.join(',\n') +
  ' { display: none !important; }\n' +
  'html { padding-bottom: 0 !important; }';

globalThis.SHOPIFYBAR_HIDE_SELECTORS = SHOPIFYBAR_HIDE_SELECTORS;
globalThis.SHOPIFYBAR_HIDE_CSS = SHOPIFYBAR_HIDE_CSS;
