# Build log

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
