# Accessibility and Compatibility

## Reference observations
- Controls are mostly native `<button>`/`<input>` with `aria-label`/`title` (good). Segmented controls use `aria-pressed`. Garment cards have descriptive labels.
- Custom dropdowns wrap native `<select>`s (keyboard: arrows, Enter, Space, Escape, Tab).
- Canvas content (pattern pieces, artwork) is not exposed to assistive tech. There is no keyboard path to move or scale artwork on the canvas; the Transform fields are the only accessible alternative.
- Muted text (#6f747c on #232428) is about 3.2:1, **below WCAG AA** for small text.
- The mobile layout is a gate page; the editor is desktop-only.
- Tooltips appear on hover; their focus behaviour was not verified.

## Targets for the rebuild (WCAG 2.2 AA)
1. All controls are keyboard reachable with a visible focus ring (accent, 2 px offset).
2. **Canvas keyboard model:** Tab cycles layers; arrows nudge 1 mm (Shift 10 mm); `[`/`]` reorder; `+`/`−` scale; `R` rotates 15°; Delete removes. A live region announces "Front · 120 × 80 mm at x 160, y 90".
3. Layer list = an ARIA listbox with drag *and* keyboard reorder (Alt+↑/↓).
4. Contrast: raise `--faint` in dark mode to about #8a9099 for text uses (keep the original as decorative only). Document the deviation.
5. Reduced motion: disable auto-rotate and camera tweens under `prefers-reduced-motion`.
6. Dialogs: focus trap, return focus, labelled titles. The tour is navigable by keyboard.
7. Colour inputs always have a hex text field, so the eyedropper and swatches aren't the only route.

## Platform and browser matrix
| Target | Minimum | Notes |
|---|---|---|
| Chrome / Edge | 120+ | Primary; WebGL2, OffscreenCanvas, EyeDropper, WebCodecs |
| Firefox | 120+ | No EyeDropper API (hide the button); WebCodecs 130+ |
| Safari (macOS) | 17+ | OffscreenCanvas 2D OK; WebCodecs partial → fall back to server video |
| PWA install | Chromium desktop/Android, Safari 17 macOS (Add to Dock), iOS 16.4+ (Add to Home Screen) | |
| Desktop app | Windows 10 1809+ (WebView2), macOS 12+ (WKWebView) | WebGL2 required |
| GPU | WebGL2, 4 GB VRAM recommended for path tracing | Adaptive quality below that |
| Mobile | Viewer + basic editing on tablets ≥ 768 px; phone = viewer and project list | The reference blocks phones entirely; we can do better without promising the full editor |
