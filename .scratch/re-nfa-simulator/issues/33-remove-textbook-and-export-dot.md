# 33: Remove Textbook View, Fix View-Toggle Layout Shift, Remove Export DOT

**What to build:** Remove Textbook View completely across presentation layers, fix view-toggle layout shift across all 6 viewports within ±0.5px, and remove Export DOT while preserving standalone Export SVG.

**Blocked by:** 32: Control sizing and alignment across all rows and panels

**Status:** done

- [x] Textbook view option removed from `#view-toggle` in `index.html`. Two views remain: "NFA" (flat) and "Final NFA" (final).
- [x] Composite sub-box render path `toTextbookDot` and 150-token fallback warning bar removed from `src/diagram/index.ts` and `src/ui/main.ts`.
- [x] Diagram cap mode simplified to `'flat' | 'off'` with single 400 postfix token limit.
- [x] Legacy deep links and stored settings with `view=textbook` load as "NFA" mode (`view: 'flat'`) without error.
- [x] Unit tests in `tests/diagram.test.ts`, `tests/export.test.ts`, `tests/url.test.ts` updated to reflect textbook and DOT removal.
- [x] Stepper and toggle control bounding boxes match within ±0.5px between "NFA" and "Final NFA" across all six viewports (1920x1080, 1440x900, 1280x800, 1024x768, 768x1024, 390x844).
- [x] `#step-counter` width fixed to 80px flex cell with concise `Final NFA` text and detailed stats in accessible title, eliminating wrapping and horizontal displacement.
- [x] Stepper controls remain mounted in Final NFA view with `aria-disabled="true"` and informative title ("Switch to NFA view to step through construction") rather than being hidden.
- [x] Automated layout stability tests across all 6 viewports added and passing in `tests/e2e.cjs`.
- [x] `#export-dot-btn` deleted from `index.html`, and all click handlers, references, and disabled assignments removed from `src/ui/main.ts`.
- [x] `getExportFilename` in `src/ui/export.ts` streamlined to SVG format only.
- [x] Standalone Export SVG verified in a fresh tab with inlined computed styles, opaque white background rect, and on-screen text labels.
- [x] Documentation updated across `README.md`, `docs/SPEC.md`, `docs/DEMO.md`, and `docs/design.md` (Screen S5 removed).
- [x] Zero matches for `export.dot` or `export-dot` outside of historic ADRs and completed issue records.
- [x] `toDot` retained in `src/diagram/index.ts` for Viz.js diagram rendering.
- [x] Engine seam byte-identical: `git diff b87339c -- src/engine` is exactly 0 bytes.
- [x] ADR 0009 drafted in `docs/adr/0009-display-only-numbering-and-removal-of-textbook-view.md`.
- [x] All test gates passing: `npm run check` (0 errors), `node tests/e2e.cjs` (0 failures), `node tests/ui-mutants.cjs` (100% mutants killed).
