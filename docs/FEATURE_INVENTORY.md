# Feature Inventory

Legend for **Src**: `O` observed and exercised · `D` present in the DOM or options but not exercised · `G` gated behind login or a plan (not accessible) · `I` inferred from public config or comments.

## A. Global and header
| # | Feature | Src | Notes |
|---|---|---|---|
| A1 | View mode: Sewing pattern / Split / 3D | O | Persists in `localStorage.viewMode` |
| A2 | Day/night theme | O | `data-theme` light/dark, persisted |
| A3 | Language EN / FR / 中文 / RU | D | Garment names are localised in the manifest |
| A4 | Quick tour (6 steps, Back/Next/Skip/Done) | O | `tourDone` flag; auto-runs on first visit |
| A5 | Undo (Ctrl+Z) / Redo (Ctrl+Shift+Z) | O | |
| A6 | New design | D | |
| A7 | Your files (project browser) | G | Opens the login modal |
| A8 | Save project | G | Opens the login modal |
| A9 | 3D snapshot | D | Instant PNG of the current 3D view |
| A10 | Export split-button and "More exports" menu | O | See section H |
| A11 | Log in / Sign up modal | O | Email+password, remember me, forgot password, magic link, sign-up tab |
| A12 | Version badge, document name and cut | O | |
| A13 | Back to home page | D | |
| A14 | Mobile gate ("Open in your desktop browser", send/copy link, 3D teaser) | O | Under about 768 px |

## B. Pattern editor (2D)
| # | Feature | Src | Notes |
|---|---|---|---|
| B1 | Pattern pieces drawn true to size, with labels "53 × 73 cm · cut 1" | O | |
| B2 | Outside / Inside side switch | O | Inside adds Label, hem facings, sleeve hem facings (6 → 9 pieces) |
| B3 | Rulers (top and left) in the current unit | O | |
| B4 | Units mm / cm / in | O | Persisted |
| B5 | Cursor read-out "back · 37.3 × 50.5 cm" | O | Piece name plus local coordinates |
| B6 | Zoom −/+, %, Fit, wheel zoom | O | |
| B7 | Pattern markings toggle (centre lines, notches) | D | Also in Scene → Details |
| B8 | Tools: Select, Hand (pan), Image, Text, Shapes | O | |
| B9 | Shapes: Rectangle, Square, Circle, Triangle, Star, Diamond, Line, Dashed line | O | Drag to draw, Shift keeps proportions, Esc cancels |
| B10 | Selection box with corner scale and a rotate handle, size badge | O | "Or drag outside a corner" rotates |
| B11 | Artwork clipped to the piece; can be moved between pieces | O | |
| B12 | Paste an image from the clipboard (Ctrl+V) | D | Stated in the tour and empty state |
| B13 | Drag and drop images | I | Typical; to verify |

## C. Layers and objects
| # | Feature | Src |
|---|---|---|
| C1 | Layer list with thumbnail, name, type and side ("image · inside") | O |
| C2 | Show/hide layer (eye) | O |
| C3 | Drag to reorder | O |
| C4 | "+" add layer | D |
| C5 | Transform: width, height, rotation, opacity (unit-aware) | O |
| C6 | Rotate 90° left/right | O |
| C7 | Align to piece: left, centre, right, top, middle, bottom | O |
| C8 | Mirror, Copy (duplicate), Delete | O |
| C9 | Place-at presets: Chest, Left chest logo, Front bottom, Back, Back neck, Right sleeve, Left sleeve, Label, Printed label | O |
| C10 | Wrap over seams, with "extra past the seams" bleed in cm | O |
| C11 | Multi-select and grouping | Not observed. Treat as **absent** in the reference. |

## D. Image layer
| # | Feature | Src |
|---|---|---|
| D1 | Upload (button, paste, Image tool) | O |
| D2 | Invert | O |
| D3 | Crop: drag edges, drag inside to move, Trim empty edges, Reset crop, Cancel/Done (non-destructive) | O |
| D4 | Hue (°) and Saturation (%) | O |
| D5 | Fill with colour (recolour every opaque pixel) and eyedropper | O |
| D6 | Reset colours | O |
| D7 | SVG/PDF/AI uploads treated as vector for print | I (export menu copy) |

## E. Text layer
| # | Feature | Src |
|---|---|---|
| E1 | Multiline text field | O |
| E2 | Font: about 40 families (Inter … Germania One) | O |
| E3 | Colour and eyedropper | O |
| E4 | Weight 100–900 | O |
| E5 | Style: Bold, Italic, ALL CAPS | O |
| E6 | Paragraph align left/centre/right | O |
| E7 | Line height, letter spacing | O |

## F. Shape layer
| # | Feature | Src |
|---|---|---|
| F1 | Kind switch (7 kinds) | O |
| F2 | Colour: Solid / Gradient | O |
| F3 | Gradient: up to 5 stops, add or remove a stop, per-stop colour and opacity %, swap, Linear/Radial, angle | O |
| F4 | Outline only, thickness (mm), dashed (lines) | O |

## G. Fabric, appearance and lighting (Design tab)
| # | Feature | Src |
|---|---|---|
| G1 | Fabric swatches (10), custom colour, eyedropper | O |
| G2 | Fabric colour Solid / Gradient (Top→Bottom stops) | O |
| G3 | Material: Cotton, Cotton blend, Interlock, Sport knit, Piqué, Rib knit, Waffle, Fleece/French terry, Athletic mesh | O |
| G4 | Fold shadows (AO) toggle | O |
| G5 | Fabric wrinkles toggle and strength | O |
| G6 | Texture strength, knit size (×n) | O |
| G7 | Brightness, contrast | O |
| G8 | Key light: Side°, Height°, Power | O |
| G9 | Default settings: Reset to saved, Save as default, Restore factory | O |

## H. 3D preview and scene (Scene tab)
| # | Feature | Src |
|---|---|---|
| H1 | Orbit (drag), zoom (scroll), Front/Back/Side presets, Reset view | O |
| H2 | Preview quality: Adaptive / Full / Half / Quarter | O |
| H3 | Auto-rotate | O |
| H4 | 28 garment models in 5 categories, search, grid/list, tier badges | O |
| H5 | Studio HDRI on/off, intensity, rotation | O |
| H6 | Studio backdrop on/off, colour (17 + custom), shadow on backdrop | O |
| H7 | Backdrop light (gobo): 30 patterns, invert, brightness, contrast | O |
| H8 | Hanger on/off and colour | O |
| H9 | Neck label on/off, shape (5), colour | O |
| H10 | Pattern markings toggle | O |
| H11 | Loading state "Loading the garment…", first-run hint | O |

## I. Export and render
| # | Feature | Src |
|---|---|---|
| I1 | Catalogue render dialog: frame preview, Front/Back/Side, 13 sizes across 5 aspect ratios, Frame, Quality (150/500/1000/1500 passes), transparent background | O |
| I2 | Render in cloud (credits), render on this computer (Pro), Stop, progress ring and status | O (UI) / G (run) |
| I3 | Save PNG (full) / Save WebP (compact) | O (UI) |
| I4 | Print files ZIP: PNG per print at real size, plus spec sheet, plus vector for SVG/PDF/AI | D |
| I5 | Sublimation panels ZIP: each piece full with bleed | D |
| I6 | Spec sheet PDF: sizes and positions | D |
| I7 | Turntable video (360°) | D |
| I8 | Watermark on Free | I |

## J. Account and billing (gated)
| # | Feature | Src |
|---|---|---|
| J1 | Email/password, magic link, password reset | O (UI) |
| J2 | Plans Free/Basic/Pro/Ultra, monthly or yearly (Paddle) | I |
| J3 | Credit packs (renders, exports) | I |
| J4 | Quotas: images, exports, renders, projects, storage, render px/quality | I |
| J5 | Storage grace period of 30 days after downgrade | I |
