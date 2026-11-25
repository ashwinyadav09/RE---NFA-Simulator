# Ticket 28: Overlays, Presets & Help Dialog

**Status:** done  
**Branch:** ui-redesign  
**Date:** 2026-11-13  

---

## 1. Summary & Scope
Implements Screen S8 overlays and preset enhancement per `docs/design.md` §7.8, §8.3, §11.1, and Appendix B:
1. **Presets:** Shows preset descriptions from canonical engine presets (`#preset-description`), setting `title` on select options, keeping native `<select>` per decision Q3.
2. **Canvas Legend Popover:** Adds `#legend-btn` and `#canvas-legend` popover on the canvas containing 6 visual vocabulary items (Start State, Accept State, Symbol Transition, ε-Transition, New at this step, Active in simulation). Dismissible by close button, Escape key, or outside click.
3. **Keyboard Shortcuts Dialog:** Modernized styling matching Stitch S8 with backdrop blur, styled header with subtitle, close button, and `<kbd>` badges while preserving the 9 tested rows in `#keyboard-help-table`.
4. **Copy Link & Link Notice:** Inline status badge for `#copy-link-status` with `data-copied` attributes, and clean warning styling for `#link-notice`.

---

## 2. Acceptance Criteria Checklist
- [x] **AC1 (Preset Descriptions):** When a preset is chosen in `#preset-select`, `#preset-description` is visibly displayed and options carry descriptive titles from `PRESETS` data.
- [x] **AC2 (Legend Popover):** `#canvas-legend` opens on `#legend-btn` click, updates `aria-expanded`, presents the 6 canonical diagram items with drawn SVG icons and descriptive text, and closes on `#legend-close`, `Esc`, or outside click.
- [x] **AC3 (Keyboard Help Dialog):** Restyled with backdrop blur, header subtitle, and clean table layout matching Stitch S8 while maintaining 100% test compatibility.
- [x] **AC4 (Copy Link Status):** `#copy-link-status` styled as an inline status badge with green background on success and transient auto-clear.
- [x] **AC5 (Pure Engine Seam & Single-file Production Gate):** `src/engine/` is 100% untouched; `dist/index.html` assignment pattern strictly contains `window.VizRenderer=` and `self.onmessage=`; 0 console errors.

---

## 3. UI Mutants Verification

| ID | Description | Status | First Failing Assertion | Location |
|---|---|---|---|---|
| CTRL-SURVIVE | Control: No-op comment added (must SURVIVE) | **SURVIVED** | `` | `` |
| CTRL-WRONG-KILLER | Control: Wrong expect string on real failure (must be WRONG-KILLER) | **WRONG-KILLER** | `E2E test failed: AssertionError [ERR_ASSERTION]: Ctrl+wheel focal point X must keep node center within 1 px, drift was 51.22856140136719` | `/Projects/Automata/tests/e2e.cjs:2846:3` |
| T28-AC1-1 | T28-AC1-1: Mutate openLegend remove hidden in src/ui/overlays.ts | **KILLED** | `E2E test failed: AssertionError [ERR_ASSERTION]: #canvas-legend must be visible when opened` | `/Projects/Automata/tests/e2e.cjs:4130:10` |
| T28-AC1-2 | T28-AC1-2: Mutate closeLegend add hidden in src/ui/overlays.ts | **KILLED** | `E2E test failed: AssertionError [ERR_ASSERTION]: #canvas-legend must be hidden when closed` | `/Projects/Automata/tests/e2e.cjs:4141:10` |
| T28-AC2-1 | T28-AC2-1: Mutate formatPresetDescription return in src/ui/overlays.ts | **KILLED** | `E2E test failed: AssertionError [ERR_ASSERTION]: #preset-description text must match preset description` | `/Projects/Automata/tests/e2e.cjs:4117:10` |
| T28-AC2-2 | T28-AC2-2: Mutate LEGEND_ITEMS count in src/ui/overlays.ts | **KILLED** | `E2E test failed: AssertionError [ERR_ASSERTION]: #canvas-legend must contain 6 items` | `/Projects/Automata/tests/e2e.cjs:4136:10` |

---

## 4. Visual Evidence
- `scratch/ticket28-light.png`: Light mode workbench with Worked Example preset description and Diagram Legend popover open.
- `scratch/ticket28-dark.png`: Dark mode workbench with Diagram Legend popover open.
