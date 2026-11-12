# 27: Validation and Stress Panels

**What to build:** Implement the approved Validation and Stress Panels (`docs/design.md` §6.13, §6.14, §7.6 S6, §7.7 S7). Includes `#validation-summary-strip` (4 summary card links: Invariants, Built-in Suite, 3 Oracles, Linear Scaling) with live status pills and metric values, formatted invariant check rows (`#inv-I1` through `#inv-replay`) with `.check-code` badges, `.check-name` labels, and `.verdict-pill` badges (`PASS`/`FAIL`), suite summary chip (`#suite-summary`) displaying live test counts (e.g. `24 / 24 pass`), diff oracle result rows with badges, and responsive dual-panel stress chart container (`#stress-chart-container`) with log-scale toggle and live performance stats.

**Blocked by:** 26: Test Dock & Simulation Traces

**Status:** done

- [x] AC1 Validation Summary Strip: `#validation-summary-strip` anchored at top of validation panel with 4 cards linking to sections (`#strip-card-invariants` -> `#invariants-section`, `#strip-card-suite` -> `#suite-section`, `#strip-card-diff` -> `#differential-section`, `#strip-card-stress` -> `#stress-section`), each featuring a header with code label and status pill (`.strip-card-pill`), and live value metric text (`6 / 6 pass`, `24 / 24 pass`, `3 oracles · 511 strings`, `n ≤ 1,000 · NFA linear` / `Not run`).
- [x] AC2 Structured Invariant Check Rows: `#inv-I1` through `#inv-replay` formatted with `.check-row`, `.verdict-pill` (`.accept` / `.reject` displaying `PASS`/`FAIL`), `.check-code` (e.g. `I1`, `Size`, `Replay`), `.check-name`, and `.check-explanation`, while strictly preserving the legacy `textContent` contract (`PASS - <label>: <explanation>`) for backwards compatibility.
- [x] AC3 Built-in Suite Summary & Table: `#suite-summary` chip displaying `24 / 24 pass` (or `X / 24 pass · Y fail`); table wrapper with clean horizontal scrolling and sticky headers.
- [x] AC4 Differential Oracles & Stress Chart: `#diff-status` and `#diff-results` displaying oracle badges; `#stress-chart-container` dual-panel inline SVG chart with linear/log scale toggle button (`#stress-scale-toggle`), family selector, cancel support, and CSV export.
- [x] AC5 State Reset Hygiene: `clearResults()` clears all summary cards to their neutral default un-run states (`6 / 6`, `Suite`, `Diff`, `Stress` with `Not run`), and partial updates do not overwrite other card metrics.
- [x] AC6 Unit Testing: `formatSuiteSummary`, `extractCodeBadge`, `renderInvariantRow`, and `updateSummaryStrip` unit tested in `tests/validation-view.test.ts` (4 tests passing, 168 total vitest tests passing across 14 files).
- [x] AC7 Browser Smoke Test: E2E suite verifying validation summary strip cards, anchor links, invariant check rows, suite summary chip, oracle results, stress chart rendering, and scale toggle.
- [x] AC8 Mutation Testing: 4 mutants in `tests/ui-mutants.cjs` (`T27-AC1-1`, `T27-AC1-2`, `T27-AC2-1`, `T27-AC2-2`) targeting suite summary formatting, code badge extraction, invariant pill text, and summary strip values all killed; controls pass.
- [x] AC9 Codebase Hygiene: `git diff b87339c -- src/engine` produces zero diff; `dist/index.html` assignment pattern check strictly limited to `['self.onmessage=', 'window.VizRenderer=']`; fixed sleep count (`waitForTimeout`) remains strictly 2; 5× consecutive E2E smoke test gate passed.

## Verification Evidence

### 1. Vitest Unit Test Results
```
Test Files  14 passed (14)
     Tests  168 passed (168)
  Duration  1.69s
- tests/validation-view.test.ts (4 tests passed)
- tests/test-dock.test.ts (3 tests passed)
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
- E2E suite verified:
  - `#validation-summary-strip` has 4 cards linking to `#invariants-section`, `#suite-section`, `#differential-section`, `#stress-section`.
  - Invariants card displays `PASS` pill and `6 / 6 pass`.
  - Suite card and `#suite-summary` chip display `24 / 24 pass`.
  - Differential card displays `PASS` pill and `3 oracles · 511 strings`.
  - Invariant row `#inv-I1` contains `.check-code` (`I1`), `.verdict-pill` (`PASS`), and `.check-name` (`Distinct Start & Accept`).
  - Stress chart renders dual-panel inline SVG with log scale toggle and CSV export.

### 3. UI Mutants Summary Table

| ID | Description | Status | First Failing Assertion | Location |
|---|---|---|---|---|
| CTRL-SURVIVE | Control: No-op comment added (must SURVIVE) | **SURVIVED** | `` | `` |
| CTRL-WRONG-KILLER | Control: Wrong expect string on real failure (must be WRONG-KILLER) | **WRONG-KILLER** | `E2E test failed: AssertionError [ERR_ASSERTION]: Ctrl+wheel focal point X must keep node center within 1 px, drift was 51.22856140136719` | `/Projects/Automata/tests/e2e.cjs:2846:3` |
| T27-AC1-1 | T27-AC1-1: Mutate formatSuiteSummary return in src/ui/validation-view.ts | **KILLED** | `E2E test failed: AssertionError [ERR_ASSERTION]: #suite-summary chip must be 24 / 24 pass` | `/Projects/Automata/tests/e2e.cjs:2134:10` |
| T27-AC1-2 | T27-AC1-2: Mutate extractCodeBadge return code in src/ui/validation-view.ts | **KILLED** | `E2E test failed: AssertionError [ERR_ASSERTION]: #inv-I1 .check-code must be I1` | `/Projects/Automata/tests/e2e.cjs:2137:10` |
| T27-AC2-1 | T27-AC2-1: Mutate renderInvariantRow pill text in src/ui/validation-view.ts | **KILLED** | `E2E test failed: AssertionError [ERR_ASSERTION]: #inv-I1 must display PASS` | `/Projects/Automata/tests/e2e.cjs:1611:5` |
| T27-AC2-2 | T27-AC2-2: Mutate updateSummaryStrip invariant value in src/ui/validation-view.ts | **KILLED** | `E2E test failed: AssertionError [ERR_ASSERTION]: Invariants summary card val must be 6 / 6 pass` | `/Projects/Automata/tests/e2e.cjs:2131:10` |

### 4. Visual Artifacts
- Light Mode: `scratch/ticket27-light.png`
- Dark Mode: `scratch/ticket27-dark.png`

### 5. Codebase Hygiene & Safety
- **Engine Purity**: `git diff b87339c -- src/engine` produces zero diff (0 bytes).
- **Window/Self Globals**: `dist/index.html` strictly limited to `[ 'self.onmessage=', 'window.VizRenderer=' ]` (ADR 0004 compliance).
- **No Fixed Sleeps**: `waitForTimeout` occurrences in `tests/e2e.cjs` remains strictly 2.
- **Dist Size**: `dist/index.html` is 1,518.09 kB (gzip: 529.91 kB).
