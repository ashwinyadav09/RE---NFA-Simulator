# 20: Release-Candidate Audit

**What to audit:** Comprehensive end-to-end verification of the release candidate: clean clone, offline proof, mutant runner coverage across all seeded UI and engine mutants, documentation consistency audit, keyboard and accessibility smoke, performance benchmarks, and edge cases.

**Blocked by:** 19: NFA export, URL deep links, keyboard-shortcut help

**Status:** done

- [x] AC1 Clean clone: reproducible bit-for-bit single-file production build (`dist/index.html` sha256 and byte sizes match), clean `npm run check`, 5 consecutive clean `npm run e2e` runs, and mutation gate passes 13/13.
- [x] AC2 Offline proof: zero non-file network requests and zero console errors over full app walkthrough in Playwright with `context.setOffline(true)`.
- [x] AC3 UI mutants: all UI mutants (T17 + T18 + T18b + T19 + T20) killed by their targeted tests with 0 unexpected survived and 0 wrong killers; controls pass.
- [x] AC4 Documentation audit: README verified against running app, size caps, differential limits, shortcuts, URL parameter encoding, and Chromium target per ADR 0002.
- [x] AC5 Accessibility & Keyboard: full Tab traversal over all focusable controls without keyboard traps, visible focus styles, and accessible names on all form controls including selects.
- [x] AC6 Performance sanity: sub-100ms median build and first render up to 400 tokens; heap stability under 20MB after walkthrough.
- [x] AC7 Edge matrix: clean handling with zero console errors or uncaught exceptions across all edge expressions.
- [x] AC8 Evaluator walkthrough: verified step-by-step evaluator guide with screen-verified numbers.
- [x] AC9 Engine integrity: `src/engine` remains 100% byte-identical to commit `b87339c`.

