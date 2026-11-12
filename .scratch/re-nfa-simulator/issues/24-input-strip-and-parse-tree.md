# 24: Input Strip, Postfix Timeline, and Parse Tree

**What to build:** Implement the approved 2-row Input Strip layout (`docs/design.md` §4.3, §6.2), Postfix timeline chip row above the hero canvas in the centre column (§4.4, §6.9), and hierarchical Parse Tree with depth-capped subtree expansion (§4.4, §6.10; Stitch S1–S3).

**Blocked by:** 23: Workbench Layout: 3 Rails, Canvas Hero & Scrubber

**Status:** done

- [x] AC1 Input Strip 2-row layout: `#input-strip` container using CSS Grid with Expression Row (styled `#preset-select` with `#preset-description` helper, mono 18/28 `#regex-input`, ghost insertion buttons `#insert-eps` and `#insert-empty`, primary filled `#build-button`, and action buttons) and Settings Row (visible labels for `#notation-select`, `#concat-select`, `#alphabet-input`, message slot `#alphabet-message`, and right-aligned `#stats` chips with tabular figures).
- [x] AC2 Postfix Timeline: `#postfix-view` positioned above the hero canvas in `#centre-column`, rendering interactive chip buttons with `.postfix-token` classes, operator glyphs via CSS `::before` pseudo-elements (`∪`, `∗`, `⋅`, `+`, `?`), active/done/upcoming step synchronization, and click-to-step navigation.
- [x] AC3 Parse Tree & Code Well: `#tree-view` rendering hierarchical visual tree with `.tree-chip` operators and leaves, connector branch lines, depth-6 expansion capping per §6.10, `.sr-only` raw indented AST text preserving legacy accessibility/test checks, formatted math text in `#postfix-text-well`, and collapsible `<details id="token-list-disclosure">` for raw tokens.
- [x] AC4 Unit testing: AST serialization (`nodeToText`), postfix math formatting (`formatPostfixText`), parse tree rendering (`renderParseTree`), timeline generation and active state updates (`renderPostfixTimeline`, `updatePostfixTimelineActive`), and raw tokens diagnostics (`renderRawTokens`) unit tested in `tests/parse-view.test.ts` (6 tests passing, 156 total vitest tests passing).
- [x] AC5 Browser smoke test: E2E suite verifying input strip elements (display grid, regex height >= 40px, ghost buttons present, build button height >= 40px), postfix timeline (inside centre column above canvas, token chips, active token presence), and parse tree (visual tree, operator/leaf chips, sr-only container, postfix code well, token list disclosure).
- [x] AC6 Mutation testing: 4 mutants in `tests/ui-mutants.cjs` (`T24-AC1-1`, `T24-AC1-2`, `T24-AC2-1`, `T24-AC3-1`) targeting ghost button cursor insertion, stats formatting, parse tree chip generation, and postfix active token sync all killed; controls pass.
- [x] AC7 Codebase hygiene: `git diff b87339c -- src/engine` produces zero diff; `dist/index.html` assignment pattern check allows only `self.onmessage=` and `window.VizRenderer=`; fixed sleep count (`waitForTimeout`) remains strictly 2.

## Verification Evidence

### 1. Vitest Unit Test Results
```
Test Files  11 passed (11)
     Tests  156 passed (156)
  Duration  1000ms
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
- E2E suite executed clean with 0 console warnings and 0 errors.
- Verified:
  - `#input-strip` computed display is `grid`.
  - `#regex-input` height is >= 40px (48px styled).
  - `#insert-eps` and `#insert-empty` present inside regex field area with cursor insertion functionality.
  - `#build-button` height is >= 40px (48px primary filled).
  - `#postfix-view` located inside `#centre-column` directly above canvas frame.
  - Postfix tokens rendered with `.postfix-token` buttons, operator glyphs via `::before` pseudo-elements, active step synchronization, and click-to-step navigation.
  - `#tree-view` contains visual `.visual-tree` with `.tree-chip`, `.operator-chip`, and `.leaf-chip` elements.
  - `#tree-view` retains `.sr-only` container with exact indented AST text for full test/a11y compatibility.
  - Depth-6 expansion capping on parse tree subtrees prevents DOM explosion and layout freeze on large expressions.
  - `#postfix-text-well` displays formatted postfix math text.
  - `#token-list-disclosure` collapses raw diagnostics tokens by default.

### 3. UI Mutants Summary Table

| ID | Description | Status | First Failing Assertion | Location |
|---|---|---|---|---|
| CTRL-SURVIVE | Control: No-op comment added (must SURVIVE) | **SURVIVED** | `` | `` |
| CTRL-WRONG-KILLER | Control: Wrong expect string on real failure (must be WRONG-KILLER) | **WRONG-KILLER** | `E2E test failed: AssertionError [ERR_ASSERTION]: Ctrl+wheel focal point X must keep node center within 1 px, drift was 51.22856140136719` | `/Projects/Automata/tests/e2e.cjs:2790:3` |
| T24-AC1-1 | T24-AC1-1: Corrupt ghost buttons cursor insertion in src/ui/main.ts | **KILLED** | `E2E test failed: AssertionError [ERR_ASSERTION]: Insert ε button must insert ε` | `/Projects/Automata/tests/e2e.cjs:794:10` |
| T24-AC1-2 | T24-AC1-2: Corrupt #stats format in src/ui/main.ts | **KILLED** | `E2E test failed: AssertionError [ERR_ASSERTION]: Stats must report 10 states` | `/Projects/Automata/tests/e2e.cjs:412:3` |
| T24-AC2-1 | T24-AC2-1: Corrupt Parse Tree chip rendering in src/ui/parse-view.ts | **KILLED** | `E2E test failed: AssertionError [ERR_ASSERTION]: #tree-view must contain visual .tree-chip elements` | `/Projects/Automata/tests/e2e.cjs:3773:10` |
| T24-AC3-1 | T24-AC3-1: Corrupt Postfix token active class sync in src/ui/parse-view.ts | **KILLED** | `E2E test failed: AssertionError [ERR_ASSERTION]: Active postfix token must be UNION` | `/Projects/Automata/tests/e2e.cjs:560:10` |

Total mutant run time: 244.6 s

### 4. Codebase Hygiene & Safety
- **Engine Purity**: `git diff b87339c -- src/engine` produces zero diff.
- **Window/Self Globals**: `dist/index.html` matches only `[ 'self.onmessage=', 'window.VizRenderer=' ]` (ADR 0004 compliance).
- **No Fixed Sleeps**: `waitForTimeout` occurrences in `tests/e2e.cjs` remains strictly 2 (lines 1718 and 2242).
- **Dist Size**: `dist/index.html` is 1,490.27 kB (gzip: 524.78 kB).
