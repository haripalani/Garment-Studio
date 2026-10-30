# Page and Component Map

The reference has a single route (`/app/`) plus a mobile gate. Below is the component tree the rebuild will implement. Names are ours; the reference DOM ids are shown in brackets for traceability.

```
<AppShell data-theme>
├─ <Header>                                   [header]
│  ├─ ExitButton                              [.bb-exit]
│  ├─ Logo · VersionBadge · DocTitle(name, cut)   [appVer, docName]
│  ├─ ViewModeSegment(pattern|split|3d)       [.seg.mode]
│  ├─ ThemeToggle                             [bTheme]
│  ├─ TourButton                              [bTour]
│  ├─ LanguageSelect                          [bLang]
│  ├─ HistoryGroup(Undo, Redo)                [bUndo, bRedo]
│  ├─ FileGroup(New, Files, Save)             [bOpen, bSave]
│  ├─ SnapshotButton                          [bShot]
│  ├─ ExportSplitButton + ExportMenu          [bExportMain, bExportMore, exportMenu]
│  └─ AccountButton / AccountMenu             [.bb-acct]
├─ <Main>
│  ├─ <PatternStage>                          [.stage-pat]
│  │  ├─ StageHeader(title, pieceCount, SideSegment outside|inside)   [pieceCount, sideOut, sideIn]
│  │  ├─ PatternCanvas (rulers, grid, pieces, layers, handles)        [canvas]
│  │  ├─ ToolRail(Select, Hand, Image, Text, Shapes▸ShapePopover)     [tSelect … tShape, shapePop]
│  │  ├─ UnitBox(mm|cm|in)                                            [unitBox]
│  │  ├─ CursorReadout                                                [cursorPos]
│  │  ├─ CropBar(Trim, Reset, Cancel, Done)                           [cropBar]
│  │  ├─ ShapeHint                                                    [shapeHint]
│  │  └─ ZoomBar(−, value, +, Fit, Markings)                          [zOut, zVal, zIn, zFit, zMarks]
│  ├─ <ViewerStage>                           [.stage-3d]
│  │  ├─ StageHeader(title, QualitySelect, CameraPresetSegment)       [vQuality, view]
│  │  ├─ ViewerCanvas (WebGL)                                         [.studio canvas]
│  │  ├─ GarmentPicker pill + GarmentPanel(search, chips, grid/list, cards, tier badges)  [gPicker, gPanel]
│  │  ├─ LoadingOverlay                                               [gLoading]
│  │  ├─ Hint3D (dismissable, "don't show again")                     [hint3d]
│  │  ├─ LiveBadge                                                    [.live]
│  │  └─ ViewBar(AutoRotate, ResetView, NeckLabel, Hanger)            [vSpin, vReset, vLabel, vHanger]
│  ├─ <SelectedItemPanel> (floating, collapsible)                     [props]
│  │  ├─ TextProps(text, font, colour+eyedrop, weight, B/I/AA, align, line height, letter spacing)  [textProps]
│  │  ├─ ShapeProps(kind, colour, Solid|Gradient, GradientEditor, Linear|Radial, angle, outline, dashed, thickness)  [shapeProps]
│  │  ├─ ImageActions(Mirror, Invert, Crop, Copy, Delete)             [bFlip, bInvert, bCrop, bDup, bDel]
│  │  ├─ ImageAdjust(hue, saturation, fill colour+eyedrop, reset)     [imgAdj]
│  │  ├─ WrapOverSeams(toggle, info, bleed cm)                        [wrapRow, wrapBox]
│  │  └─ PlacePresets(9 buttons)                                      [presets]
│  └─ <Inspector>                             [aside]
│     ├─ Tabs(Design | Scene)                 [tabDesign, tabScene]
│     ├─ DesignPane                           [paneDesign]
│     │  ├─ ArtworkSection(subtitle = selected name, Image, Text)     [artSub, bImg, bText]
│     │  ├─ TransformSection(W, H, rot, opacity, ±90°, align ×6)      [xform] (only when selected)
│     │  ├─ LayersSection(+, sortable list)                           [layers]
│     │  ├─ FabricSection(swatches, custom, eyedrop, Solid|Gradient)  [swatches, fGradBox]
│     │  ├─ AppearanceSection(material, AO, wrinkles, strengths, knit, brightness, contrast)
│     │  ├─ KeyLightSection (collapsible: side, height, power)        [lightBody]
│     │  └─ DefaultsCard(reset, save, factory)                        [lookReset, lookSave, lookFactory]
│     └─ ScenePane                            [paneScene]
│        ├─ BackdropSection(HDRI, intensity, rotation, studio backdrop, shadow, colours, gobo, invert, brightness, contrast)
│        ├─ HangerSection(show, colours)
│        ├─ DetailsSection(neck label, label shape, label colours, auto-rotate, pattern markings)
│        └─ DefaultsCard
├─ <RenderModal>                              [rModal]
│  ├─ FramePreview (own camera: Front/Back/Side/Reset, hint)
│  └─ Settings(size, frame, quality, recommendation, transparent bg, plan note, Cloud | Local | Stop, progress ring, Save PNG | WebP)
├─ <AuthModal>(Log in | Sign up, magic link, reset)
├─ <TourOverlay>(6 steps, spotlight)
├─ <Tooltip>                                  [.tip]
└─ <MobileGate> (narrow viewports only)
```

## Shared primitives (design-system level)
Button (default / primary / ghost / icon / big), SplitButton, Segmented (`seg`, `seg.sm`, `seg.blue`), Dropdown (custom-styled select), Toggle switch, Slider with value output, NumberField with unit suffix, Swatch / ColourPicker / Eyedropper, GradientBar editor, Section, CollapsibleSection, Tabs, Modal, Popover/Menu, Tooltip, Toast, FloatingToolbar (glass card), Badge (tier: Free/Basic/Pro/Ultra), Card (garment card).
