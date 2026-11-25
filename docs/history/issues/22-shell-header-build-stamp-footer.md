# 22: Shell, Header & Build Stamp Footer

**What to build:** Implement the persistent application shell (`docs/design.md` §6.1, §6.11, §15.2; Stitch S1): sticky `#app-header` with vector logo mark, display title, section navigation links (`Workbench`, `Validation`, `Stress test`), theme switcher (`system`, `light`, `dark`) with no-flash pre-paint script, and restyled `#app-footer` with course text and `#build-stamp`.

**Blocked by:** 21: Foundation tokens, base styles, and debug text hiding

**Status:** done

- [x] AC1 Header & branding: sticky `#app-header` with 56px height, surface backdrop, hairline border, vector logo mark (start state → arrow in primary → accept state double ring per §14.1), and `<h1>RE → NFA (Thompson) Simulator</h1>`.
- [x] AC2 Section navigation: `.app-nav` with anchor links to `#app` (Workbench), `#validation-panel` (Validation), and `#stress-section` (Stress test), with smooth scrolling and `scroll-margin-top: 72px`.
- [x] AC3 Theme management: `#theme-select` with options `system`, `light`, and `dark`. Pre-paint script in `<head>` sets `data-theme` attribute before paint to eliminate flash without window/self assignments; selection saved to `localStorage` under `re-nfa:theme`.
- [x] AC4 Build stamp footer: `#app-footer` restyled with warm paper sunken tokens (`--bg-sunken`, `--border`), course subtitle, and `#build-stamp` retaining its commit hash and test anchor.
- [x] AC5 Focus traversal & accessibility: all form controls and selects retain accessible names; initial tab stop updated per Amendment A12 (`theme-select` in header precedes `preset-select`).
- [x] AC6 Unit & E2E testing: pure theme logic tested in `tests/theme.test.ts` (5 tests passing); E2E browser suite verifies sticky header, logo SVG, section links, theme switching, and footer style.
- [x] AC7 Mutation testing: 4 new mutants in `tests/ui-mutants.cjs` (`T22-AC1-1`, `T22-AC1-2`, `T22-AC2-1`, `T22-AC3-1`) targeting theme storage, attribute setting, nav link href, and header sticky position all killed; controls pass.
- [x] AC8 Codebase hygiene: `git diff b87339c -- src/engine` produces zero diff; `dist/index.html` assignment pattern check allows only `self.onmessage=` and `window.VizRenderer=`; fixed sleep count (`waitForTimeout`) remains exactly 2.

## Verification Evidence

### 1. Vitest Unit Test Results
```
Test Files  9 passed (9)
     Tests  146 passed (146)
  Duration  877ms
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
  - `#app-header` position is sticky, top 0px, display flex.
  - Logo SVG with circle and arrow present and visible.
  - `<h1>` title reads `RE → NFA (Thompson) Simulator`.
  - Nav links point to `#app`, `#validation-panel`, and `#stress-section`.
  - `#theme-select` switching to `dark`, `light`, and `system` updates `data-theme` and `re-nfa:theme` storage.
  - `#app-footer` background color matches `--bg-sunken` (`rgb(240, 237, 230)`).
  - `#build-stamp` text retained.

### 3. UI Mutants Summary Table

| ID | Description | Status | First Failing Assertion | Location |
|---|---|---|---|---|
| CTRL-SURVIVE | Control: No-op comment added | **SURVIVED** | (none) | |
| CTRL-WRONG-KILLER | Control: Wrong expect string on real failure | **WRONG-KILLER** | `E2E test failed: ...` | `/Projects/Automata/tests/e2e.cjs` |
| T22-AC1-1 | Corrupt theme storage key in src/ui/theme.ts | **KILLED** | `AssertionError [ERR_ASSERTION]: localStorage theme key 're-nfa:theme' must be saved as dark` | `tests/e2e.cjs` |
| T22-AC1-2 | Omit data-theme attribute set in src/ui/theme.ts | **KILLED** | `AssertionError [ERR_ASSERTION]: data-theme attribute must be set to dark` | `tests/e2e.cjs` |
| T22-AC2-1 | Corrupt validation nav link href in index.html | **KILLED** | `AssertionError [ERR_ASSERTION]: Validation nav link must point to #validation-panel` | `tests/e2e.cjs` |
| T22-AC3-1 | Corrupt #app-header sticky position in index.html | **KILLED** | `AssertionError [ERR_ASSERTION]: #app-header position must be sticky` | `tests/e2e.cjs` |

### 4. Codebase Hygiene & Safety
- **Engine Purity**: `git diff b87339c -- src/engine` produces zero diff.
- **Window/Self Globals**: `dist/index.html` matches only `[ 'self.onmessage=', 'window.VizRenderer=' ]` (ADR 0004 compliance).
- **No Fixed Sleeps**: `waitForTimeout` occurrences in `tests/e2e.cjs` remains exactly 2 (lines 1714 and 2211).
- **Dist Size**: `dist/index.html` is 1,474.05 kB (gzip: 521.53 kB).

