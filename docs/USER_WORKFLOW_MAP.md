# User Workflow Map

## W1. First visit
Open /app/ → the sample design loads (front print, sleeve logo, inside label) → the tour runs automatically (6 steps) → Skip or Done sets `tourDone`.

## W2. Put artwork on a garment
1. **Image** (button, Image tool, Ctrl+V paste, drag-drop) → a file lands centred on the front piece, outside, and is selected.
2. Drag on the pattern to move it (it can cross onto another piece), drag a corner to scale, drag the top handle or outside a corner to rotate.
3. Or type exact W/H/rotation/opacity in **Transform**, or click **Place at → Chest / Left chest logo / …**
4. The 3D preview updates live; the camera frames the edited area.
5. Optional: Crop (with trim of empty edges), Mirror, Invert, Hue/Saturation, Fill with colour, Wrap over seams.

## W3. Add text
**Text** → a layer is created with the placeholder "Text" selected in the property panel → type → pick font, weight, style, alignment, spacing, colour → place.

## W4. Add a shape
Shapes tool → pick a kind → drag on the pattern (Shift keeps it even, Esc cancels) → solid or gradient fill (up to 5 stops, linear or radial, angle) → optional outline-only with thickness in mm, or a dashed line.

## W5. Inside printing
Switch to **Inside** → the pieces show their inner face plus inside-only pieces (Label, hem facings) → place a printed label → visible in 3D through the neckline.

## W6. Style the fabric
Design tab → Fabric swatch, custom colour, eyedropper or gradient → material → AO, wrinkles, texture, knit size, brightness, contrast → Key light.

## W7. Stage the scene
Scene tab → HDRI on/off, intensity, rotation → backdrop on/off, colour, shadow → gobo light pattern, invert, brightness, contrast → hanger and its colour → neck label, shape and colour → auto-rotate, markings.

## W8. Change garment
Garment pill → Models panel → search or filter by category → pick a card. The design carries over by piece role (front, back, sleeves). Locked tiers show a badge.

## W9. Export
- **3D snapshot** → immediate PNG of the viewport.
- **Export → Catalogue render** → frame the shot, pick size, frame, quality and transparent background → cloud render (credits) or local (Pro) → progress → Save PNG or WebP.
- **Print files (ZIP)**, **Sublimation panels (ZIP)**, **Spec sheet (PDF)**, **Turntable video**.

## W10. Save and reopen (gated)
Save project or Your files → login modal → (after login) cloud projects. Signed out, the work persists locally between reloads.

## W11. Defaults
Save the current look as default → it is applied to new designs → Reset to saved defaults → Restore factory settings.

## Workflow diagram
```
             ┌────────── choose garment ──────────┐
             ▼                                    │
 add art ─► place on pattern ─► adjust (crop/colour/wrap) ─► style fabric ─► stage scene
   ▲             │   ▲                                                        │
   │             ▼   │ live sync                                              ▼
 paste/drop    3D preview (orbit, presets)            snapshot · render · print files · spec · video
                                                                              │
                                                                     save / open (account)
```
