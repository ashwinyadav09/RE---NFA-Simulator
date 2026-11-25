# 21: Foundation tokens, base styles, and debug text hiding

**What to build:** Port the approved Stitch design token system (Thompson Drafting Table, `docs/design.md` §5, §6, §15) into `index.html`. Establish light and dark theme CSS custom properties, system font typography stacks, base element styles (buttons, inputs, tables, status pills, transparent canvas polygon), and visually hide the debug `#worker-status` element while preserving its DOM text and worker handshake logic.

**Blocked by:** 20: Release candidate audit

**Status:** done

- [x] AC1 Token dictionary: full palette implemented in `:root` with dark theme overrides in `:root[data-theme="dark"]` and `@media (prefers-color-scheme: dark)`. WCAG 2.2 AA verified contrast ratios across both themes.
- [x] AC2 Typography: system font fallback stacks (`--font-ui`, `--font-serif`, `--font-mono`) declared and applied to body, inputs, controls, and code elements.
- [x] AC3 Worker status: `#worker-status` hidden visually via `display: none;` while retaining full DOM node presence, worker handshake, and `pong` textContent.
- [x] AC4 Base styles: primary interactive buttons (`#build-button`), focus ring styling (`outline: 2px solid var(--border-focus); outline-offset: 2px`), status pills, stat/delta chips, alert bars, and transparent graph polygon.
- [x] AC5 CSS testing: Playwright `getComputedStyle` assertions in `tests/e2e.cjs` verifying tokens, font family strings, element styles, and theme switching.
- [x] AC6 Mutation testing: 4 new mutants in `tests/ui-mutants.cjs` targeting tokens, typography, worker status, and button styling all killed by computed-style assertions; controls pass.
- [x] AC7 Codebase hygiene: `git diff b87339c -- src/engine` is strictly empty; `dist/index.html` assignment pattern check allows only `self.onmessage=` and `window.VizRenderer=`; fixed sleep count (`waitForTimeout`) in `tests/e2e.cjs` remains exactly 2.

## Verification Evidence

### 1. Vitest Unit Test Results
```
Test Files  8 passed (8)
     Tests  141 passed (141)
  Duration  858ms
- tests/viewport.test.ts (7 tests passed)
- tests/export.test.ts (4 tests passed)
- tests/url.test.ts (7 tests passed)
- tests/csv.test.ts (5 tests passed)
- tests/stamp.test.ts (3 tests passed)
- tests/engine.test.ts (68 tests passed)
- tests/diagram.test.ts (39 tests passed)
- tests/properties.test.ts (8 tests passed)
```

### 2. Browser Smoke Test (Playwright E2E — 5x Gate)
- 5 consecutive clean runs of `npm run e2e` passed with 0 console warnings and 0 errors.
- Computed-style assertions verified:
  - `--bg-page`: `#f7f5f0` (light), `#14130f` (dark)
  - `--primary`: `#2541b2` (light), `#9db0ff` (dark)
  - `--new`: `#b8400a`
  - Font family: `IBM Plex Sans` / `system-ui` for body; `IBM Plex Mono` / `monospace` for `#regex-input`
  - `#build-button`: background `rgb(37, 65, 178)`, color `rgb(255, 255, 255)`
  - `#worker-status`: `display: none`, textContent retained `pong`

### 3. UI Mutants Summary Table

| ID | Description | Status | First Failing Assertion | Location |
|---|---|---|---|---|
| CTRL-SURVIVE | Control: No-op comment added | **SURVIVED** | (none) | |
| CTRL-WRONG-KILLER | Control: Wrong expect string on real failure | **WRONG-KILLER** | `E2E test failed: AssertionError [ERR_ASSERTION]: Ctrl+wheel focal point X must keep node center within 1 px, drift was 3.2738037109375` | `/Projects/Automata/tests/e2e.cjs:2785:3` |
| T21-AC1-1 | Corrupt primary color token in index.html | **KILLED** | `E2E test failed: AssertionError [ERR_ASSERTION]: Computed --primary token must match #2541b2` | `/Projects/Automata/tests/e2e.cjs:3521:10` |
| T21-AC2-1 | Corrupt UI font stack in index.html | **KILLED** | `E2E test failed: AssertionError [ERR_ASSERTION]: Body font-family must include IBM Plex Sans or system-ui, got ""Comic Sans MS", cursive"` | `/Projects/Automata/tests/e2e.cjs:3523:10` |
| T21-AC3-1 | Remove display:none from #worker-status in index.html | **KILLED** | `E2E test failed: AssertionError [ERR_ASSERTION]: #worker-status must be visually hidden` | `/Projects/Automata/tests/e2e.cjs:3533:10` |
| T21-AC4-1 | Corrupt build-button background color in index.html | **KILLED** | `E2E test failed: AssertionError [ERR_ASSERTION]: #build-button background-color must match primary token` | `/Projects/Automata/tests/e2e.cjs:3531:10` |

### 4. Codebase Hygiene & Safety
- **Engine Purity**: `git diff b87339c -- src/engine` produces zero diff.
- **Window/Self Globals**: `dist/index.html` matches only `[ 'self.onmessage=', 'window.VizRenderer=' ]` (ADR 0004 compliance).
- **No Fixed Sleeps**: `waitForTimeout` occurrences in `tests/e2e.cjs` remains exactly 2 (lines 1714 and 2211).
- **Dist Size**: `dist/index.html` is 1,469.65 kB (gzip: 520.45 kB), well within budget.
