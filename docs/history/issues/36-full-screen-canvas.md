# 36: Full-screen canvas mode

**What to build:** Add a "Full screen" button (`#fullscreen-btn`, 44x44 target on touch) in the canvas toolbar. Entering makes the canvas fill the viewport via a fixed overlay (`#fullscreen-overlay`). Exit via an always-visible "Exit full screen" button (`#exit-fullscreen-btn`) and Escape. Inside full screen: step controls (First/Prev/Play/Next/Last, speed, step counter, scrubber), view toggle (NFA / Final NFA), collapsible transition table drawer (`#fullscreen-table-drawer`), zoom controls, Export SVG, and current regex in the header. Background is made `inert`, body scroll is locked, focus moves to `#exit-fullscreen-btn` on enter and restores to `#fullscreen-btn` on exit. Escape closes topmost layer first (help dialog or legend, then full screen). Re-fit on enter and exit if mode is "fit". Route changes exit full screen. Mobile 390x844 layout: controls in bottom bar, table as bottom sheet/drawer, 44x44 targets, zero horizontal overflow.

**Blocked by:** 35: Transition arrows and edge labels match Stitch design

**Status:** done

- [x] AC1: `#fullscreen-btn` (with 44x44 touch target) in `#canvas-toolbar` enters full screen overlay.
- [x] AC2: `#exit-fullscreen-btn` always visible in full screen header exits full screen overlay.
- [x] AC3: Escape closes topmost layer first (help dialog -> legend -> full screen); with help dialog open, Escape closes only the dialog.
- [x] AC4: Background `#app` is marked `inert`, body scroll locked (`body.fullscreen-mode`), focus moves to `#exit-fullscreen-btn` on enter and restores to `#fullscreen-btn` on exit.
- [x] AC5: Inside full screen, step controls, scrubber, counter, speed, view toggle (`#view-toggle`), zoom controls, Export SVG, and current regex in header are fully operational using the SAME DOM instances (zero duplicate IDs).
- [x] AC6: Zoom/pan, step index, view, play state, and table highlights survive enter and exit without rebuild; re-fit is performed on enter and exit if mode is "fit".
- [x] AC7: Collapsible transition table drawer (`#fullscreen-table-btn`, `#fullscreen-table-drawer`, `#fullscreen-table-close-btn`) collapsed by default in full screen, toggles on click, remembered for session.
- [x] AC8: Mobile (390x844) responsive layout: bottom control bar, table as bottom sheet, touch gestures preserved, safe-area insets, zero horizontal overflow.
- [x] AC9: Route change (hashchange) cleanly exits full screen.
- [x] AC10: Unit tests and e2e tests passing for enter/exit, escape priority, state preservation, unique IDs, inert, focus restore, and re-fit.
- [x] AC11: Mutants defined and killed in `tests/ui-mutants.cjs` (Escape handler removed, inert missing, focus restore removed, re-fit removed, table collapse broken, view toggle missing in overlay).
