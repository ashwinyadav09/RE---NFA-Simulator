# 26: Test Dock and Simulation Traces

**What to build:** Implement the approved Test Dock and Simulation Traces (`docs/design.md` §6.12, §7.3 S3, §7.4 S4). Includes collapsible dock header with title and live result summary ("2 accepted · 2 rejected" / "Not run"), dock collapse toggle button (`#test-dock-toggle`), responsive two-column body layout (input controls + results area), `Ctrl+Enter` shortcut to trigger simulation run, structured result cards per tested string (`.trace-line.trace-card`) with string labels, length badges, verdict pills (`ACCEPT`/`REJECT`), initial closure step (`data-step="0"` with `○` marker), per-symbol steps (`data-step="1..N"` with `●` marker), dead run warning steps (`⚠ Dead at position N`), symbol-outside-alphabet error steps, active step selection sync with canvas highlight and transition table (`.active-state-row`), and empty hint helper.

**Blocked by:** 25: Step Log & Transition Table

**Status:** done

- [x] AC1 Test Dock layout & collapse: `#test-dock` structured with `.test-dock-header` (title "Test Strings & Traces", `#dock-summary` reporting live status e.g. "Not run" or "1 accepted · 2 rejected"), `#test-dock-toggle` toggling `.collapsed` with `aria-expanded` ("true"/"false"), and two-column `.test-dock-body` grid (controls + results).
- [x] AC2 Input strip & keyboard shortcut: `#test-input` with mono font, placeholder, and `Ctrl+Enter` / `Cmd+Enter` shortcut triggering `#run-button.click()`.
- [x] AC3 Structured result cards: `.trace-line.trace-card` per tested string containing header with mono string label (`String: "ba"`, empty string showing `String: ""` with `ε (empty string)` badge), length badge (`|w| = N`), and `.verdict-pill` (`.accept` / `.reject`).
- [x] AC4 Trace step navigation & highlighting: Initial closure step (`data-step="0"` with `○`) and per-symbol steps (`data-step="1..N"` with `●`); clicking or pressing Enter/Space selects step, adds `.active` and `aria-pressed="true"`, updates `#canvas` final view highlight, and highlights matching state rows in `#transition-table` (`.active-state-row`).
- [x] AC5 Dead run & alphabet error reporting: Dead runs render status row (`.trace-status.dead` with `⚠ Dead at position N`), clicking activates dead state (`data-run-status="dead"` on `#canvas`), and updates `#run-status.warning` callout; out-of-alphabet symbol renders `.trace-status.error`.
- [x] AC6 Stale results clearing: `#verdict`, `#trace`, and `#run-status` cleared on syntax error, unbuilt state, or rebuild; `#dock-summary` resets to `'Not run'`; `#trace-empty-hint` displayed when empty.
- [x] AC7 Unit testing: `formatDockSummary`, `formatStringLabel`, and `renderTraceCards` unit tested in `tests/test-dock.test.ts` (3 tests passing, 164 total vitest tests passing across 13 files).
- [x] AC8 Browser smoke test: E2E suite verifying test dock header, summary, collapse toggle, multi-line test simulation, verdict pills, empty string formatting, step selection, active state table synchronization, and `Ctrl+Enter` shortcut.
- [x] AC9 Mutation testing: 4 mutants in `tests/ui-mutants.cjs` (`T26-AC1-1`, `T26-AC1-2`, `T26-AC2-1`, `T26-AC2-2`) targeting dock summary formatting, verdict pill classes, `Ctrl+Enter` shortcut, and collapse toggle all killed; controls pass.
- [x] AC10 Codebase hygiene: `git diff b87339c -- src/engine` produces zero diff; `dist/index.html` assignment pattern check allows only `self.onmessage=` and `window.VizRenderer=`; fixed sleep count (`waitForTimeout`) remains strictly 2; 5× consecutive E2E gate passed.

## Verification Evidence

### 1. Vitest Unit Test Results
```
Test Files  13 passed (13)
     Tests  164 passed (164)
  Duration  1.05s
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
- E2E suite executed clean with 0 console warnings and 0 errors across 5 consecutive runs.
- Verified:
  - `#test-dock` contains `.test-dock-header` with title "Test Strings & Traces" and `#dock-summary` reporting live status.
  - `#test-dock-toggle` toggles `.collapsed` and flips `aria-expanded` between "true" and "false".
  - Running strings `ba\nab\n` renders 3 `.trace-card`s with string headers, length badges, and verdict pills (`ACCEPT` in green, `REJECT` in red).
  - Empty string displays `String: ""` and `ε (empty string)` badge.
  - First step of first card is automatically marked `.active` with `aria-pressed="true"` on run.
  - Clicking step 2 in first card updates selection and highlights accept state 9 in `#transition-table` (`.active-state-row`).
  - `Ctrl+Enter` shortcut triggers simulation run and updates `#dock-summary`.

### 3. UI Mutants Summary Table

| ID | Description | Status | First Failing Assertion | Location |
|---|---|---|---|---|
| CTRL-SURVIVE | Control: No-op comment added (must SURVIVE) | **SURVIVED** | `` | `` |
| CTRL-WRONG-KILLER | Control: Wrong expect string on real failure (must be WRONG-KILLER) | **WRONG-KILLER** | `E2E test failed: AssertionError [ERR_ASSERTION]: Ctrl+wheel focal point X must keep node center within 1 px, drift was 51.22856140136719` | `/Projects/Automata/tests/e2e.cjs:2790:3` |
| T26-AC1-1 | T26-AC1-1: Mutate formatDockSummary return text in src/ui/test-dock.ts | **KILLED** | `E2E test failed: AssertionError [ERR_ASSERTION]: Summary must reflect current run results` | `/Projects/Automata/tests/e2e.cjs:3957:10` |
| T26-AC1-2 | T26-AC1-2: Invert verdict pill class in src/ui/test-dock.ts | **KILLED** | `E2E test failed: AssertionError [ERR_ASSERTION]: First card must have isAccept=true` | `/Projects/Automata/tests/e2e.cjs:4014:10` |
| T26-AC2-1 | T26-AC2-1: Omit Ctrl+Enter run shortcut in src/ui/main.ts | **KILLED** | `E2E test failed: AssertionError [ERR_ASSERTION]: Ctrl+Enter must trigger simulation run` | `/Projects/Automata/tests/e2e.cjs:4044:10` |
| T26-AC2-2 | T26-AC2-2: Omit test-dock collapse toggle in src/ui/main.ts | **KILLED** | `E2E test failed: AssertionError [ERR_ASSERTION]: Clicking toggle must add .collapsed to #test-dock` | `/Projects/Automata/tests/e2e.cjs:3969:10` |

### 4. Codebase Hygiene & Safety
- **Engine Purity**: `git diff b87339c -- src/engine` produces zero diff.
- **Window/Self Globals**: `dist/index.html` matches only `[ 'self.onmessage=', 'window.VizRenderer=' ]` (ADR 0004 compliance).
- **No Fixed Sleeps**: `waitForTimeout` occurrences in `tests/e2e.cjs` remains strictly 2 (lines 1718 and 2242).
- **Dist Size**: `dist/index.html` is 1,507.73 kB (gzip: 528.05 kB).

