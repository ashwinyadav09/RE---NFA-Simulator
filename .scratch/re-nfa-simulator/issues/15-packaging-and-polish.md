# 15: Packaging and polish

**What to build:** An evaluator opens one file or link, tries presets, uses the keyboard alone, and trusts what they see.

**Blocked by:** 04: Syntax errors; 09: Textbook view; 10: Final NFA view; 12: Mutation gate; 13: Validation panel; 14: Stress panel

**Status:** done

- [x] At least eight presets, in both notations, including the classic examples.
  - *Proof:* `PRESETS` constant in `src/engine/presets.ts` exports 9 curated presets (`(a|b)*a`, `(a|b)*abb`, `a*b`, `(a+b)*a`, `(a+b)*abb`, `a+?`, `a**`, `(0|1)*(00|11)`, `(a+ε)b`). Verified via engine tests in `tests/engine.test.ts` (state/transition counts match `worked-example.json` and `classic-abb.json`) and browser smoke in `tests/e2e.cjs` iterating every preset with zero errors.
- [x] Everything works by keyboard (tab order, arrow keys, Enter to build). Verdicts and step changes are announced through a live region. Colour is never the only cue.
  - *Proof:* Verified in `tests/e2e.cjs`: Enter builds expression in `#regex-input`; visual tab order verified across all focusable controls; Arrow keys step construction; `#live-region` (`aria-live="polite"`) announces verdict after Run (`Verdict: ACCEPT`) and step & rule after Next (`Step 2 of 6: symbol`). Non-colour cues verified: verdicts, invariant marks, suite rows, and stress timeout marker each carry explicit text.
- [x] From a clean clone, `npm run check` and `npm run e2e` pass and the browser console is clean.
  - *Proof:* Cloned to temporary directory, executed `npm ci`, `npm run check`, and `npm run e2e` with 0 console errors and 0 uncaught page errors.
- [x] The single file works from file:// in Chromium (smoke). Other browsers are not verified (owner decision: Chromium only).
  - *Note:* Verified in Chromium over file:// (smoke test and headed walkthrough pass cleanly). Owner decision (8 Nov 2026): Chromium is the only supported browser; no Firefox check will be done and other browsers are not verified.
- [x] The README's evaluator walkthrough is performed in a real browser and matches: `(a|b)*a` gives 10 states and 12 transitions, `ba` is ACCEPT with the two sets from the fixture, the suite passes, a differential run reports no mismatch.
  - *Proof:* Full R3 rehearsal documented in `README.md` and executed in headed Chromium over `file://`: `(a|b)*a` reports 10 states and 12 transitions; `ba` yields ACCEPT with `{0, 2, 4, 6, 7, 8}`, `{0, 2, 3, 4, 5, 7, 8}`, and `{0, 1, 2, 4, 5, 7, 8, 9}`; built-in suite passes 24/24 cases; differential test on `(a|b)*abb` passes for $k = 8$ (511 strings).
- [x] A hosted copy, if wanted, is the same file; how to publish it is documented.
  - *Proof:* `README.md` includes "Publishing & Static Hosting" section detailing how `dist/index.html` runs self-contained on any static host with zero configuration or server requirements.
