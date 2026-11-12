# 19: NFA export, URL deep links, keyboard-shortcut help

**What to build:** Implement LATER items 5 (SVG/DOT export of the displayed NFA view/step), 6 (URL query deep links for regex, notation, concat, preset, alphabet, test string, view, step, compact) and 7 (accessible keyboard-shortcut help dialog).

**Blocked by:** 18: Stress panel upgrades

**Status:** done

- [x] AC1 SVG export (flat step 2, textbook step, final view): filename, DOMParser 0 parsererror, exactly one XML declaration, xmlns/xlink, explicit width/height, white background rect, and the viewBox equals the on-screen SVG's (no zoom transform leaks, even after zooming). Mutants: declaration omitted; declaration duplicated; rect omitted; export taken from the DOM after a zoom.
- [x] AC2 DOT export equals the DOT the render recorder saw (rendered views); for a >400-token build the node count equals the #stats state count. Mutants: wrong filename; exports the wrong view's DOT.
- [x] AC3 Button states: disabled at load, during a build in flight, after a syntax error, after a >2,000-token refusal; a >400-token build has DOT enabled and SVG disabled; a normal build enables both. Mutants: SVG enabled when capped; DOT disabled when capped; not disabled in flight.
- [x] AC4 No stale export: after rebuilding a different expression the exported DOT/SVG belong to the new build; after a refused build both are disabled. Mutants: buttons not reset in clearResults(); cache key ignores the build.
- [x] AC5 URL codec (unit): round trip of every special character, limits, invalid values reported, unknown keys ignored. Mutants: + not encoded; notation always standard; limit removed.
- [x] AC6 Deep link load (fresh page): auto-build, controls set, #stats, preset restore, input restores and shows the verdict, view/step restore with clamping, invalid params show #link-notice while valid ones apply. Mutants: build skipped; preset skipped; view skipped; notice omitted.
- [x] AC7 XSS: a malicious regex param shows escaped text and window.__pwned stays undefined. Mutant: error text set via innerHTML.
- [x] AC8 Copy Link: clipboard text equals the expected URL, "Link copied!" in #copy-link-status clears after 2 s without a sleep, nothing in #live-region; opening the copied URL in a fresh page reproduces the same state. Mutants: timer omitted; link missing the query; live-region write added.
- [x] AC9 Help dialog: `?` opens it; `?` typed into #regex-input inserts the character and does not open it; Ctrl+? and Alt+? do not open it; arrows do not step while it is open; Esc closes; focus returns to the opener; the shortcut list contains every key in D8. Mutants: input guard removed; open-guard on the arrow handler removed; focus return omitted; one list row removed.
- [x] AC10 Hygiene: dist assignment-pattern check still only self.onmessage and window.VizRenderer; waitForTimeout count still 2; src/engine diff empty.

## Verification Evidence

### 1. Vitest Unit Test Results
```
Test Files  7 passed (7)
     Tests  137 passed (137)
  Duration  2.08s
- tests/export.test.ts (4 tests passed)
- tests/url.test.ts (6 tests passed)
- tests/viewport.test.ts (7 tests passed)
- tests/csv.test.ts (5 tests passed)
- tests/engine.test.ts (68 tests passed)
- tests/diagram.test.ts (39 tests passed)
- tests/properties.test.ts (8 tests passed)
```

### 2. Browser Smoke Test (Playwright E2E)
- E2E policy: 0 console warnings treated as non-fatal notices.
- Suite passed with 0 failures across all tickets (01–19).

### 3. UI Mutants Summary Table

| ID | Description | Status | First Failing Assertion |
|---|---|---|---|
| CTRL-SURVIVE | Control: No-op comment added | **SURVIVED** | (none) |
| CTRL-WRONG-KILLER | Control: Wrong expect string on real failure | **WRONG-KILLER** | `E2E test failed: AssertionError [ERR_ASSERTION]: Ctrl+wheel focal point X must keep node center within 1 px` |
| T19-AC1-1 | XML declaration omitted from standalone SVG | **KILLED** | `AssertionError [ERR_ASSERTION]: SVG must begin with XML declaration` |
| T19-AC1-2 | Duplicate XML declaration in formatStandaloneSvg | **KILLED** | `AssertionError [ERR_ASSERTION]: Standalone SVG must contain exactly one XML declaration` |
| T19-AC1-3 | White background rect omitted from formatStandaloneSvg | **KILLED** | `AssertionError [ERR_ASSERTION]: Exported SVG must contain opaque white background rect` |
| T19-AC1-4 | SVG export takes on-screen SVG from DOM after zoom | **KILLED** | `AssertionError [ERR_ASSERTION]: Standalone SVG viewBox must match cached SVG viewBox regardless of zoom` |
| T19-AC2-1 | Wrong filename for DOT export | **KILLED** | `AssertionError [ERR_ASSERTION]: Step DOT download filename must match expected pattern` |
| T19-AC2-2 | Export DOT uses wrong view DOT string | **KILLED** | `AssertionError [ERR_ASSERTION]: Exported DOT must match recorded render DOT` |
| T19-AC3-1 | SVG button enabled when diagram is capped | **KILLED** | `AssertionError [ERR_ASSERTION]: SVG export button must be disabled for diagram-capped expressions` |
| T19-AC3-2 | DOT button disabled when diagram is capped | **KILLED** | `AssertionError [ERR_ASSERTION]: DOT export button must be enabled for diagram-capped expressions` |
| T19-AC3-3 | Export buttons not disabled while build is in flight | **KILLED** | `AssertionError [ERR_ASSERTION]: SVG export button must be disabled while build is in flight` |
| T19-AC4-1 | Export buttons not reset in clearResults | **KILLED** | `AssertionError [ERR_ASSERTION]: SVG export button must be disabled after syntax error` |
| T19-AC4-2 | Export cache ignores build expression change | **KILLED** | `AssertionError [ERR_ASSERTION]: Exported DOT must match newly built expression` |
| T19-AC5-1 | + character not encoded as %2B in buildShareableUrl | **KILLED** | `AssertionError: expected 'http://localhost/path?regex=(a%2…' to deeply equal 'http://localhost/path?regex=(a+…'` |
| T19-AC5-2 | Notation always standard in parseShareableUrl | **KILLED** | `AssertionError: expected 'standard' to deeply equal 'textbook'` |
| T19-AC5-3 | URL query length limit removed | **KILLED** | `AssertionError: expected [Array(1)] to deeply equal []` |
| T19-AC6-1 | Build skipped on deep link load | **KILLED** | `AssertionError [ERR_ASSERTION]: Deep link load must auto-build NFA` |
| T19-AC6-2 | Preset restoration skipped on deep link load | **KILLED** | `AssertionError [ERR_ASSERTION]: Preset dropdown must match deep link parameter` |
| T19-AC6-3 | View restoration skipped on deep link load | **KILLED** | `AssertionError [ERR_ASSERTION]: Final tab must be selected after deep link restore` |
| T19-AC6-4 | Link notice omitted when invalid params exist | **KILLED** | `AssertionError [ERR_ASSERTION]: #link-notice must announce ignored parameters` |
| T19-AC7-1 | Syntax error set via innerHTML on deep link | **KILLED** | `AssertionError [ERR_ASSERTION]: XSS probe executed! window.__pwned must remain undefined` |
| T19-AC8-1 | 2s clear timer omitted for copy link status | **KILLED** | `page.waitForFunction: Timeout 5000ms exceeded` |
| T19-AC8-2 | Copied link misses query parameters | **KILLED** | `AssertionError [ERR_ASSERTION]: Copied link must contain query string` |
| T19-AC8-3 | Copy link writes to #live-region | **KILLED** | `AssertionError [ERR_ASSERTION]: Copy Link must not write to #live-region` |
| T19-AC9-1 | Input guard removed from ? shortcut | **KILLED** | `AssertionError [ERR_ASSERTION]: Typing ? in input must not open keyboard help` |
| T19-AC9-2 | Open-guard on arrow handler removed | **KILLED** | `AssertionError [ERR_ASSERTION]: Arrow stepping must be disabled while keyboard help is open` |
| T19-AC9-3 | Focus return omitted on dialog close | **KILLED** | `AssertionError [ERR_ASSERTION]: Focus must return to opener button on close` |
| T19-AC9-4 | One list row removed from keyboard help table | **KILLED** | `AssertionError [ERR_ASSERTION]: Keyboard help table must contain 9 shortcut rows` |

### 4. AC10 Codebase Hygiene
- **Window/Self Globals**: `dist/index.html` matches only `[ 'self.onmessage=', 'window.VizRenderer=' ]` (ADR 0004 compliance).
- **No Fixed Sleeps**: `waitForTimeout` occurrences in `tests/e2e.cjs` remains exactly 2 (lines 1714 and 2211).
- **Engine Purity**: `git diff b87339c -- src/engine` produces zero diff.
