# Interaction Specification

Behaviour marked *(verify)* was not fully exercised in the reference and must be confirmed during build against the reference before it is called parity.

## Pattern canvas
| Input | Context | Result |
|---|---|---|
| Click | Select tool, on artwork | Select the topmost layer under the cursor; show the bounding box, 4 corner handles, a rotate handle above, and a size badge "W × H cm" below |
| Click | Empty area | Deselect, close the Selected-item panel |
| Drag | Selected artwork body | Move. Crossing onto another piece re-parents the layer to that piece. |
| Drag | Corner handle | Uniform scale about the opposite corner *(verify: Shift frees the aspect)* |
| Drag | Rotate handle, or just outside a corner | Rotate about the centre *(verify: snapping)* |
| Drag | Hand tool, or Space+drag *(verify)* | Pan the sheet |
| Wheel / Ctrl+wheel | Canvas | Zoom about the cursor *(verify which one zooms vs. scrolls)* |
| Drag | Shape tool armed | Draw the shape; Shift keeps it even; Esc cancels |
| Drag edges / inside | Crop mode | Adjust the crop rectangle / move the image under the crop; Done commits, Cancel reverts |
| Hover | Canvas | Cursor read-out "‹piece› · x × y ‹unit›" |
| Ctrl+V | Anywhere | Paste a clipboard image as a new layer |
| Delete / Backspace | Layer selected | Delete *(verify)* |
| Ctrl+Z / Ctrl+Shift+Z | Global | Undo / redo |
| Arrow keys | Dropdowns / menus | Navigate options (observed key handlers: ArrowUp/Down, Enter, Space, Escape, Tab) |
| Escape | Popover, menu, modal, crop | Close / cancel |

## 3D viewer
| Input | Result |
|---|---|
| Left drag | Orbit around the garment |
| Scroll | Dolly zoom |
| Front / Back / Side | Animate to the preset azimuth |
| Reset view | Default camera and target |
| Selecting a layer | Camera frames that region *(observed: the view zoomed toward the selected print)* |
| Adaptive quality | Lower pixel ratio while interacting, full when idle |

## Panels and controls
- **Segmented controls:** single choice, the active segment raised (panel bg plus a small shadow), accent-coloured text.
- **Sliders:** live preview while dragging; commit to the undo history on release; the value is shown right-aligned (`0.5`, `×3`, `1.00`, `38°`).
- **Number fields:** unit suffix; Enter/blur commits; the value converts when the unit changes.
- **Swatches:** circular, 28 px; the selected one gets an accent ring; rainbow = native colour input; eyedropper uses the EyeDropper API.
- **Layers:** a click selects; the eye toggles visibility (not undoable? *verify*); drag reorders (tooltip "Drag to change the layer order").
- **Selected-item panel:** a floating glass card with a collapse chevron; its content switches by layer type.
- **Gradient bar:** click under the bar adds a stop (max 5); drag a stop away from the bar removes it; select a stop to edit its colour and opacity %; Swap reverses.
- **Garment panel:** opens from the pill; search filters live; category chips; grid/list toggle; card states selected / locked-tier badge.
- **Tour:** a spotlight on the target, "n of 6", Skip / Back / Next / Done; it re-runs from the "?" button.
- **Hints:** "It's 3D, move it" and "Choose your angle" with "Don't show again" (persisted).
- **Modals:** a backdrop dims the app; Close (×) and Escape close them.
- **Theme toggle:** a sliding knob between sun and moon icons.

## Feedback states
Loading ("Loading the garment…"), Live preview badge (green dot), the render progress ring and status line, disabled buttons until a render exists (Save PNG/WebP), plan upsell notes ("Rendering starts with Basic. See plans").
