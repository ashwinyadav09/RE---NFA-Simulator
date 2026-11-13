# 38: Whole-app presentation audit and fixes

**What to build:** Comprehensive presentation audit and polish across all pages (`#workbench`, `#validation`, `#stress`), full screen mode, help dialog, legend, across the six viewports, in light, dark, and system theme.
- Inspect and fix: horizontal overflow, clipped/truncated text, overlapping elements, misaligned rows, uneven spacing, text under 12px, low contrast, missing focus rings, scroll traps, leftover debug text or placeholders, inconsistent wording (NFA, Final NFA, ε-link, q0), console warnings.
- States to exercise: empty, loading (Viz.js starting), syntax error, 150+ token cap, large NFA, zero test strings, many test strings, stress timeout.
- Walk `docs/DEMO.md` end to end using only the UI and fix anything that does not match.
- Report a defect list with severity and screenshot per item. Fix all P0/P1 issues.
- Capture screenshots S1–S15 and new S16–S21:
  - S16: Final NFA with q0 labels
  - S17: NFA vs Final NFA control row
  - S18: Edge before/after
  - S19: Full screen desktop
  - S20: Full screen mobile
  - S21: Regex bar with raised star

**Blocked by:** 37: Kleene star in the regex bar

**Status:** done

- [x] AC1: Visual audit of all three pages (#workbench, #validation, #stress) across 6 viewports (1920x1080, 1440x900, 1280x800, 1024x768, 768x1024, 390x844).
- [x] AC2: Theme audit (light, dark, system) with zero contrast violations and clear focus rings.
- [x] AC3: Edge states audit: empty regex, loading, syntax error, 150+ token cap, large NFA, 0 test strings, many test strings, stress timeout.
- [x] AC4: Full docs/DEMO.md end-to-end walkthrough verification.
- [x] AC5: Defect list with severity and fixes for all P0/P1 items.
- [x] AC6: Screenshots captured (S1–S15 re-captured + S16–S21).
- [x] AC7: Automated audit assertions in `tests/e2e.cjs` verifying 0 errors, 0 warnings, zero overflow.
- [x] AC8: Gates pass: `npm run check`, 0-byte engine seam diff, 5 clean e2e runs.
