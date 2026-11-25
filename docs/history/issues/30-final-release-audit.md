# 30: Final Release Audit & Release Candidate Hygiene

**What to audit:** Comprehensive end-to-end verification of the redesign release candidate: engine seam byte-identity, offline proof, single-file bundle integrity, global assignment verification, full E2E reliability (5 consecutive clean runs), zero fixed-sleep creep, engine mutation gate (13/13 killed), UI mutant verification across Tickets 21–29, Kleene star ergonomics fix, and S0–S10 screen parity confirmation.

**Blocked by:** 29: Responsive Mobile & Touch

**Status:** done

## Acceptance Criteria Checklist

- [x] **AC1 Engine Seam Integrity:** `src/engine` remains 100% byte-identical to commit `b87339c` (`git diff b87339c -- src/engine` produces 0 bytes).
- [x] **AC2 Single-File Bundle:** Built with `vite-plugin-singlefile` into `dist/index.html` (~1.5 MB, ~532 kB gzip), self-contained, loads and runs offline from `file:///`.
- [x] **AC3 Global Scope Hygiene:** Window/self assignment patterns in `dist/index.html` strictly restricted to `['self.onmessage=', 'window.VizRenderer=']`. Zero pollution of global window scope by app or theme state.
- [x] **AC4 Offline Proof:** Playwright walkthrough with `context.setOffline(true)` executes with 0 external network requests, 0 console errors, and 0 page errors.
- [x] **AC5 E2E Test Suite Stability:** 5 consecutive runs of `node tests/e2e.cjs` executed and passed without flakiness or uncaught warnings.
- [x] **AC6 Fixed Sleep Bound:** Fixed sleeps (`page.waitForTimeout`) in `tests/e2e.cjs` remain strictly capped at 2 (no timing regression).
- [x] **AC7 Engine Mutation Gate:** All 13 canonical mutants from `tests/mutation-gate.cjs` KILLED (13/13, 0 survived).
- [x] **AC8 UI Mutants Coverage:** All UI mutants across redesign tickets (Tickets 21–29) killed by targeted test suites with 0 unexpected survivors; controls (`CTRL-SURVIVE`, `CTRL-WRONG-KILLER`) verified.
- [x] **AC9 Kleene Star Ergonomics:** Pressing `^` in the regex input safely inserts `*` without cursor jump; `^*` and `^` normalized to `*` during build; `^` never enters the inferred alphabet.
- [x] **AC10 Screen Parity Matrix S0–S10:** High-fidelity parity achieved across all screens S0–S10, with real screenshots captured in `scratch/screens/`.

## Verification Evidence

### 1. Engine Seam Check
```
$ git diff b87339c -- src/engine
(empty - 0 bytes diff)
```

### 2. Global Assignments Check
```
$ node -e "const html = require('fs').readFileSync('dist/index.html', 'utf8'); const m = html.match(/(?:window|self)\.[a-zA-Z0-9_$]+\s*=/g) || []; console.log(JSON.stringify([...new Set(m)]));"
["self.onmessage=","window.VizRenderer="]
```

### 3. Fixed Sleeps (`waitForTimeout`) Count
```
$ git grep -n "waitForTimeout" tests/e2e.cjs
tests/e2e.cjs:1718:  await page.waitForTimeout(1200);
tests/e2e.cjs:2298:  await page.waitForTimeout(100);
(Total: exactly 2)
```

### 4. Build & Unit Test Gate (`npm run check`)
```
Test Files  16 passed (16)
Tests       178 passed (178)
Duration    1.46s
dist/index.html  1,528.23 kB │ gzip: 532.23 kB
✓ built in 200ms
```

### 5. Engine Mutation Gate (`npm run test:mutants`)
```
| Mutant | Layer | Description | Status |
| --- | --- | --- | --- |
| star-no-back | builder | drop A.f -ε→ A.s in STAR | KILLED |
| star-no-skip | builder | drop s -ε→ f in STAR | KILLED |
| union-no-b-exit | builder | drop B.f -ε→ f in UNION | KILLED |
| plus-skip | builder | add s -ε→ f to PLUS | KILLED |
| opt-no-skip | builder | drop s -ε→ f in OPT | KILLED |
| eps-as-empty | builder | ε atom without its edge | KILLED |
| empty-as-eps | builder | ∅ atom with an ε edge | KILLED |
| merge-no-move | builder | merge deletes B.s without moving its transitions | KILLED |
| assoc-right | parser | binary operators right-associative | KILLED |
| prec-swap | parser | union binds tighter than concatenation | KILLED |
| closure-one-step | simulator | closure follows one ε step only | KILLED |
| no-initial-closure | simulator | simulation skips the first closure | KILLED |
| no-closure-after-move | simulator | no closure after each move | KILLED |

Total mutants: 13, Killed: 13, Survived: 0
```

### 6. Consecutive E2E Runs
- Run 1/5: PASSED
- Run 2/5: PASSED
- Run 3/5: PASSED
- Run 4/5: PASSED
- Run 5/5: PASSED
- Final release run: PASSED (0 console warnings, 0 errors)

### 7. Offline Verification
Playwright headless session under `context.setOffline(true)` loaded `file:///.../dist/index.html`, completed full build, simulation, and export workflow with 0 external network requests, 0 console errors, and 0 unhandled exceptions.

### 8. Screen Parity Artifacts (Saved in `scratch/screens/`)
- `S1-empty.png`: Fresh load empty workbench
- `S2-mid-construction.png`: Mid-construction flat stepping (`regex=(a|b)*a&view=flat&step=4`)
- `S2c-merge-variant.png`: State merge variant (`regex=(a|b)*a&concat=merge&step=6`)
- `S3-final-nfa-traces.png`: Final NFA with simulation traces and active state highlight
- `S4-syntax-error.png`: Syntax error state (`(a|)`) with inline error bar and clear indicators
- `S5-textbook.png`: Textbook view (`(a|b)*abb&view=textbook&step=5`) with composite sub-boxes
- `S6-validation.png`: Validation panel with 24-case built-in suite and invariant cards
- `S7-stress.png`: Stress benchmark panel with family selector and linear scaling
- `S8-overlays-legend.png`: Overlays with legend panel and modal dialogs
- `S9-mobile.png`: Mobile 390×844 responsive single-column layout
- `S10-stepping-cap-160.png`: Stepping cap handling (>150 tokens) with layout note banner
