# 32: Control sizing and alignment across all rows and panels

**What to build:** Make every input, select, and button the exact same height and font size across desktop and mobile, with proper vertical center alignment within each row, independent touch target expansion, full-width in-flow alphabet error messaging, and strict geometric consistency.

**Blocked by:** 31: Split Workbench, Validation and Stress into three separate pages

**Status:** done

- [x] Foundation tokens defined in `:root`: `--control-h: 36px`, `--control-h-touch: 44px`, `--control-pad-x: 10px`, `--control-font-size: 14px`, `--control-radius: var(--radius-sm)`, `--control-border: 1px solid var(--border-strong)`.
- [x] Coarse/touch media query `@media (pointer: coarse), (max-width: 640px) { :root { --control-h: var(--control-h-touch); } }` expanding all controls to 44px on mobile and touchscreens.
- [x] `#insert-eps` and `#insert-empty` styled as normal standalone buttons at `--control-h`, eliminating nested ghost buttons and restoring the 44x44 minimum touch target.
- [x] Font size standardized to 14px across all buttons, selects, and text inputs; `#regex-input` preserves 16px monospace as the documented exception.
- [x] `#alphabet-message` placed on its own dedicated in-flow grid row (`grid-column: 1 / -1; grid-row: 3;`) collapsing when empty and expanding without overlapping or clipping.
- [x] All controls in `.input-strip`, `#app-header`, `.stepper-controls`, `.canvas-toolbar`, `.test-dock`, `#page-validation`, and `#page-stress` share identical height and vertical alignment ($\pm 1\text{px}$).
- [x] Range slider `#step-scrubber` and textarea `#test-input` align their center line with adjacent row controls.
- [x] E2E geometry suite verifies height, font-size, and vertical alignment across 6 viewports (1440x900, 1280x800, 1024x768, 768x1024, 640x480, 390x844).
- [x] All 5 Ticket 32 mutants killed and controls verified.

