# Design System (measured from the reference)

> **Brand note.** The tokens below are measured so that layout, density and interaction can match. The product name, logo, wordmark, default artwork, garment renders and marketing copy belong to the reference owner and **will not be reused**. Decision D1 in MIGRATION_ROADMAP covers whether the accent colour should also change.

## Typography
- Family: **Inter** (fallbacks: Microsoft YaHei, PingFang SC, Noto Sans SC, Segoe UI, system-ui). The same for display, body and "mono".
- Base: 13 px / 400. Button: 12.5–13 px / 500. Section title (h3): 14 px / 650, −0.07 px tracking. Stage title (h2): 15 px / 650, accent colour.
- Captions: 11.5–12 px muted. Garment caps: uppercase, 0.39–0.45 px tracking.

## Colour tokens
| Token | Light | Dark |
|---|---|---|
| --bg | #f5f6f8 | #1b1c1f |
| --panel | #ffffff | #232428 |
| --ink | #434343 | #e7e8ea |
| --muted | #6b7280 | #a0a5ad |
| --faint | #9aa1ab | #6f747c |
| --line | #e6e8ec | #34363b |
| --line-strong | #d5d9df | #41444a |
| --field | #ffffff | #1e1f22 |
| --hover | #f2f4f7 | #2d2f34 |
| --accent | #557f69 | #5e8a73 |
| --accent-hover | #4a6f5c | #6b977f |
| --accent-soft | #e8f0eb | #2a3a31 |
| --accent-ink | #ffffff | #ffffff |
| --danger | #d93025 | #f28b82 |
| --mat-bg / --mat-in | #f7f8fa / #eef0f3 | #26272b / #2b2d31 |
| --dot | #d3d7dd | #3c3f45 |
| --piece-line / --piece-ink | #9aa1ab / #434343 | #8b919a / #d3d6da |
| --stage | #ececec | #2a2b2e |
| --seg-bg | #eef0f3 | #2c2e33 |
| --icon | #4b5563 | #c3c7cd |
| --label | #434343 | #c9ccd1 |
| --toggle-off | #d5d9df | #4a4d54 |
| --glass / --glass-strong | rgba(255,255,255,.78) / .95 | rgba(40,42,46,.78) / rgba(48,50,55,.95) |
| --glass-line | rgba(16,24,40,.10) | rgba(255,255,255,.10) |
| --shadow | 0 1px 2px rgba(16,24,40,.06), 0 4px 14px rgba(16,24,40,.07) | 0 1px 2px rgba(0,0,0,.3), 0 4px 14px rgba(0,0,0,.35) |
| success dot | #34a853 with a 3 px 15 % ring | same |

## Radii and spacing
- Radii: buttons and fields 8 px · segment outer 9 / inner 7 · floating bars 12 · cards 14 · garment pill 16 · swatch 50 % · toggle 11.
- Header 56 px, padding 0 14 / 0 18, gap 16. Stage header 52 px, padding 0 16, gap 10. Inspector width 320, inner padding 20, section padding 16 0, gap 10.
- Controls: icon button 32×32 · button height 32 (big 40) · segment item height 26–28 · swatch 28 with gap 8 · toggle 38×22 · tool 36×36 in a 50 px rail.

## Components (states)
- **Button:** panel bg, 1 px line-strong border. Hover → --hover. **Primary:** accent bg and border, white text. **Ghost:** transparent.
- **Segmented:** seg-bg track with 2 px padding. The active item takes the panel bg, accent text and `0 1px 2px rgba(16,24,40,.12)`.
- **Dropdown:** field bg, line-strong border, chevron 14 px.
- **Toggle:** 38×22, off = --toggle-off, on = accent.
- **Floating bars** (tools, unit box, zoom bar, view bar): panel bg, line border, radius 12, --shadow.
- **Glass pill** (garment): rgba(35,36,40,.62), blur 14 px, saturate 1.2, radius 16.
- **Look-tile:** accent-soft bg, accent text, radius 10.
- **Tier badges:** Free / Basic / Pro / Ultra chips on cards.

## Iconography
A 1.5–2 px stroke line-icon set at 16–19 px. The rebuild uses **Lucide** (ISC licence) for an equivalent look.

## Motion
Short (≈150–200 ms) ease-out transitions on hover, segments, the toggle knob and panels; animated camera presets; the tour spotlight moves between targets.
