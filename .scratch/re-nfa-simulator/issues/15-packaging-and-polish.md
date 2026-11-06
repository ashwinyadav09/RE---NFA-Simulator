# 15: Packaging and polish

**What to build:** An evaluator opens one file or link, tries presets, uses the keyboard alone, and trusts what they see.

**Blocked by:** 04: Syntax errors; 09: Textbook view; 10: Final NFA view; 12: Mutation gate; 13: Validation panel; 14: Stress panel

**Status:** ready-for-agent

- [ ] At least eight presets, in both notations, including the classic examples.
- [ ] Everything works by keyboard (tab order, arrow keys, Enter to build). Verdicts and step changes are announced through a live region. Colour is never the only cue.
- [ ] From a clean clone, `npm run check` and `npm run e2e` pass and the browser console is clean.
- [ ] The single file works from `file://` in Chromium (smoke) and in Firefox (manual check recorded). Safari is noted as best effort.
- [ ] The README's evaluator walkthrough is performed in a real browser and matches: `(a|b)*a` gives 10 states and 12 transitions, `ba` is ACCEPT with the two sets from the fixture, the suite passes, a differential run reports no mismatch.
- [ ] A hosted copy, if wanted, is the same file; how to publish it is documented.
