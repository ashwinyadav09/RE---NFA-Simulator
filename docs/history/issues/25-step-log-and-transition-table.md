# 25: Step Log & Transition Table

**What to build:** Implement the approved Right Rail Step Log (`docs/design.md` §4.4, §6.8) and semantic Transition Table (§4.4, §6.11; Stitch S2, S3, S5, S8). Includes rich step log rows with badges, rule overlines, fragment tags, delta chips (+N st, +N tr), merged-note lines, past/active/future step synchronization, active fragment stack footer (`step.stackAfter`), sticky-header transition matrix table, active-state row highlighting linked to trace simulation with Escape key clearing (Amendment A9), and Copy as CSV toolbar button.

**Blocked by:** 24: Input Strip, Postfix Timeline, and Parse Tree

**Status:** done

- [x] AC1 Step log rich items: `.step-item-header` containing circular mono `.step-badge`, uppercase overline `.step-rule-name`, fragment range `.step-fragment`, and `.delta-chip`s (`+N st`, `+N tr`) from `formatDeltaChips()`; `.step-description` preserving exact `Step N: ...` text required by engine tests; and `.step-merged-note` in merge mode (`merged states 7 and 8 into 7`).
- [x] AC2 Step log lifecycle: `.past` (completed, green accent), `.active` (`--primary-soft` fill, 3px `--primary` left bar, 600 weight, `aria-current="step"`, auto-scrolling into view), `.future` (dimmed opacity, dashed border), and click/Enter/Space navigation to jump to any step.
- [x] AC3 Active fragment stack mini-strip: `#active-fragment-stack` beneath `#step-log` rendering active fragment boxes from `step.stackAfter` (e.g. `[ 6 → 7 ]`).
- [x] AC4 Semantic Transition Table: `table.transition-data-table` inside `#transition-table` with sticky `thead th` headers (`State`, `Symbol`, `Next State(s)`), mono tabular figures, 1px row separators, and persistent `data-state` and `data-display-state` attributes.
- [x] AC5 Active state table highlighting: Selecting any trace step (or initial closure on Run) highlights matching state rows with `.active-state-row` (`--primary-soft` fill and 3px `--primary` left bar); pressing Escape clears active state row highlighting and trace selection (Amendment A9).
- [x] AC6 Table toolbar & CSV export: Right rail headers with stat chips (`#step-log-stats`, `#table-stats`) and secondary `#copy-table-csv-btn` ("Copy CSV") with clipboard copy, button feedback (`Copied!`), and `#copy-table-csv-status` screen-reader announcement; disabled when unbuilt/cleared.
- [x] AC7 Unit testing: `formatDeltaChips`, `renderFragmentStack`, `renderStepLog`, `updateStepLogActive`, `renderTransitionTable`, `updateTableActiveStates`, and `exportTableCsv` unit tested in `tests/step-table-view.test.ts` (5 tests passing, 161 total vitest tests passing across 12 files).
- [x] AC8 Browser smoke test: E2E suite verifying step log items, badges, rules, fragments, deltas, active/past/future synchronization, active fragment stack strip, semantic transition table, active-state row highlighting, Escape key clearing, and Copy CSV export.
- [x] AC9 Mutation testing: 5 mutants in `tests/ui-mutants.cjs` (`T25-AC1-1`, `T25-AC1-2`, `T25-AC2-1`, `T25-AC2-2`, `T25-AC2-3`) targeting step log item classes, active step sync, table data attributes, active-state row highlighting, and Escape key clearing all killed; controls pass.
- [x] AC10 Codebase hygiene: `git diff b87339c -- src/engine` produces zero diff; `dist/index.html` assignment pattern check allows only `self.onmessage=` and `window.VizRenderer=`; fixed sleep count (`waitForTimeout`) remains strictly 2; 5× consecutive E2E gate passed.

## Verification Evidence

### 1. Vitest Unit Test Results
```
Test Files  12 passed (12)
     Tests  161 passed (161)
  Duration  1.16s
- tests/step-table-view.test.ts (5 tests passed)
- tests/parse-view.test.ts (6 tests passed)
- tests/scrubber.test.ts (4 tests passed)
- tests/theme.test.ts (5 tests passed)
- tests/stamp.test.ts (3 tests passed)
- tests/url.test.ts (7 tests passed)
- tests/viewport.test.ts (7 tests passed)
- tests/export.test.ts (4 tests passed)
- tests/csv.test.ts (5 tests passed)
- tests/engine.test.ts (68 tests passed)
- tests/diagram.test.ts (39 tests passed)
- tests/properties.test.ts (8 tests passed)
```

### 2. Browser Smoke Test (Playwright E2E)
- E2E suite executed clean with 0 console warnings and 0 errors across 5 consecutive runs.
- Verified:
  - `#step-log` contains `.step-log-item` elements with `.step-item-header`, `.step-badge`, `.step-rule-name`, `.step-fragment`, `.delta-chip`, and `.step-description`.
  - Initial step 1 item has class `active` and `aria-current="step"`; subsequent items have class `future`.
  - Stepping to step 3 updates step 1 & 2 to `past`, step 3 to `active`, and step 4..6 to `future`.
  - Clicking step 4 item jumps to step 4 with full diagram synchronization.
  - `#active-fragment-stack` displays active fragment stack boxes `[ 6 → 7 ]` at step 4.
  - `#transition-table` renders semantic `table.transition-data-table` with sticky `thead th` headers (`State`, `Symbol`, `Next State(s)`).
  - `#table-stats` reports state and transition counts (`10 states · 12 transitions`).
  - Active state row highlighting (`.active-state-row`) marks active simulation states upon trace selection.
  - Pressing `Escape` clears active state row highlighting from the transition table and trace step (Amendment A9).
  - `#copy-table-csv-btn` copies CSV matrix to clipboard with visual `Copied!` feedback and live region announcement.

### 3. UI Mutants Summary Table

| ID | Description | Status | First Failing Assertion | Location |
|---|---|---|---|---|
| CTRL-SURVIVE | Control: No-op comment added (must SURVIVE) | **SURVIVED** | `` | `` |
| CTRL-WRONG-KILLER | Control: Wrong expect string on real failure (must be WRONG-KILLER) | **WRONG-KILLER** | `E2E test failed: AssertionError [ERR_ASSERTION]: Ctrl+wheel focal point X must keep node center within 1 px, drift was 51.22856140136719` | `/Projects/Automata/tests/e2e.cjs:2790:3` |
| T25-AC1-1 | T25-AC1-1: Corrupt step log item class in src/ui/step-table-view.ts | **KILLED** | `E2E test failed: AssertionError [ERR_ASSERTION]: Step log must list all 6 steps` | `/Projects/Automata/tests/e2e.cjs:437:10` |
| T25-AC1-2 | T25-AC1-2: Omit active step log class in updateStepLogActive in src/ui/step-table-view.ts | **KILLED** | `E2E test failed: AssertionError [ERR_ASSERTION]: First step item must be active at step 1` | `/Projects/Automata/tests/e2e.cjs:3833:10` |
| T25-AC2-1 | T25-AC2-1: Corrupt transition table row data-state attribute in src/ui/step-table-view.ts | **KILLED** | `E2E test failed: AssertionError [ERR_ASSERTION]: Before compact toggle, state 9 row must start with q9` | `/Projects/Automata/tests/e2e.cjs:1506:3` |
| T25-AC2-2 | T25-AC2-2: Omit active-state-row class in updateTableActiveStates in src/ui/step-table-view.ts | **KILLED** | `E2E test failed: AssertionError [ERR_ASSERTION]: Active state rows must be highlighted after simulation run` | `/Projects/Automata/tests/e2e.cjs:3896:10` |
| T25-AC2-3 | T25-AC2-3: Omit Escape key active states clearing in src/ui/main.ts | **KILLED** | `E2E test failed: AssertionError [ERR_ASSERTION]: Pressing Escape must clear active state row highlighting` | `/Projects/Automata/tests/e2e.cjs:3905:10` |

### 4. Codebase Hygiene & Safety
- **Engine Purity**: `git diff b87339c -- src/engine` produces zero diff.
- **Window/Self Globals**: `dist/index.html` matches only `[ 'self.onmessage=', 'window.VizRenderer=' ]` (ADR 0004 compliance).
- **No Fixed Sleeps**: `waitForTimeout` occurrences in `tests/e2e.cjs` remains strictly 2 (lines 1718 and 2242).
- **Dist Size**: `dist/index.html` is 1,499.45 kB (gzip: 526.56 kB).

