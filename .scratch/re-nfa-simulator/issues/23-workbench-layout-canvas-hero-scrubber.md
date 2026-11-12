# 23: Workbench Layout: 3 Rails, Canvas Hero & Scrubber

**What to build:** Implement the 3-column workbench grid layout (`docs/design.md` §4.4, §6.6, §6.7; Stitch S1–S3) comprising Left rail (Parse), Centre column (Hero Canvas, Stepper with Scrubber, and Simulation Test Dock), and Right rail (Steps log and Transition Table). Integrate the construction step scrubber (`#step-scrubber`) synchronized with stepper state and view mode.

**Blocked by:** 22: Shell, Header & Build Stamp Footer

**Status:** done

- [x] AC1 Workbench 3-rail grid: `#workbench` container with CSS Grid layout (`280px minmax(0, 1fr) 340px`), responsive collapse at lg (2 columns) and md/sm (single column), containing `#left-rail`, `#centre-column`, and `#right-rail`.
- [x] AC2 Hero canvas frame: `#canvas` wrapped in `#canvas-container` with minimum height 380px (`clamp(380px, 50vh, 600px)`), subtle 24px dot-grid texture (`radial-gradient`), 1px border, and rounded corners (`var(--radius-lg)`).
- [x] AC3 Construction scrubber: `#step-scrubber` (`input[type=range]`) in `#stepper-controls`. Bi-directional synchronization: updates on build, Next, Prev, and Play; dragging/inputting on scrubber navigates to step; disabled when 0 steps and in Final NFA view.
- [x] AC4 Canvas overlays: `#canvas-toolbar` styled as floating overlay clusters over the canvas sheet for zoom controls, export buttons, and centered hint text.
- [x] AC5 Unit testing: pure scrubber state synchronization and event wiring unit tested in `tests/scrubber.test.ts` (4 tests passing).
- [x] AC6 Browser smoke test: E2E suite verifying grid display, rail elements, canvas height >= 380px, dot-grid background, scrubber build sync, step-next sync, scrubber input navigation, and final view disabling.
- [x] AC7 Mutation testing: 4 new mutants in `tests/ui-mutants.cjs` (`T23-AC1-1`, `T23-AC1-2`, `T23-AC2-1`, `T23-AC3-1`) targeting scrubber value sync, final view disabling, grid display, and dot-grid background all killed; controls pass.
- [x] AC8 Codebase hygiene: `git diff b87339c -- src/engine` produces zero diff; `dist/index.html` assignment pattern check allows only `self.onmessage=` and `window.VizRenderer=`; fixed sleep count (`waitForTimeout`) remains exactly 2.

## Verification Evidence

### 1. Vitest Unit Test Results
```
Test Files  10 passed (10)
     Tests  150 passed (150)
  Duration  899ms
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
- E2E suite executed clean with 0 console warnings and 0 errors.
- Verified:
  - `#workbench` computed display is `grid`.
  - `#left-rail`, `#centre-column`, `#right-rail` exist and are visible.
  - `#canvas` height is >= 380px with `radial-gradient` dot-grid texture.
  - `#canvas-toolbar` is positioned as absolute overlay over canvas sheet.
  - `#step-scrubber` enabled after build, min 1, max 6, value 1.
  - Stepping via `#step-next` updates scrubber value to 2.
  - Scrubber input event navigates expression to step 4 / 6.
  - Final NFA view disables scrubber.

### 3. UI Mutants Summary Table

| ID | Description | Status | First Failing Assertion | Location |
|---|---|---|---|---|
| CTRL-SURVIVE | Control: No-op comment added | **SURVIVED** | (none) | |
| CTRL-WRONG-KILLER | Control: Wrong expect string on real failure | **WRONG-KILLER** | `E2E test failed: ...` | `/Projects/Automata/tests/e2e.cjs` |
| T23-AC1-1 | Corrupt scrubber value sync in src/ui/scrubber.ts | **KILLED** | `AssertionError [ERR_ASSERTION]: Scrubber value must update to 2 when stepping via Next button` | `tests/e2e.cjs` |
| T23-AC1-2 | Do not disable scrubber in final view in src/ui/scrubber.ts | **KILLED** | `AssertionError [ERR_ASSERTION]: Scrubber must be disabled in Final NFA view` | `tests/e2e.cjs` |
| T23-AC2-1 | Corrupt #workbench CSS grid display in index.html | **KILLED** | `AssertionError [ERR_ASSERTION]: #workbench must use CSS grid display` | `tests/e2e.cjs` |
| T23-AC3-1 | Remove canvas dot grid radial gradient in index.html | **KILLED** | `AssertionError [ERR_ASSERTION]: Canvas background must contain radial-gradient dot grid` | `tests/e2e.cjs` |

### 4. Codebase Hygiene & Safety
- **Engine Purity**: `git diff b87339c -- src/engine` produces zero diff.
- **Window/Self Globals**: `dist/index.html` matches only `[ 'self.onmessage=', 'window.VizRenderer=' ]` (ADR 0004 compliance).
- **No Fixed Sleeps**: `waitForTimeout` occurrences in `tests/e2e.cjs` remains exactly 2 (lines 1714 and 2211).
- **Dist Size**: `dist/index.html` is 1,478.58 kB (gzip: 522.45 kB).

