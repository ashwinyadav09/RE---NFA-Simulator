# 19: NFA export, URL deep links, keyboard-shortcut help

**What to build:** Implement LATER items 5 (SVG/DOT export of the displayed NFA view/step), 6 (URL query deep links for regex, notation, concat, preset, alphabet, test string, view, step, compact) and 7 (accessible keyboard-shortcut help dialog).

**Blocked by:** 18: Stress panel upgrades

**Status:** ready-for-agent

- [ ] AC1 SVG export (flat step 2, textbook step, final view): filename, DOMParser 0 parsererror, exactly one XML declaration, xmlns/xlink, explicit width/height, white background rect, and the viewBox equals the on-screen SVG's (no zoom transform leaks, even after zooming). Mutants: declaration omitted; declaration duplicated; rect omitted; export taken from the DOM after a zoom.
- [ ] AC2 DOT export equals the DOT the render recorder saw (rendered views); for a >400-token build the node count equals the #stats state count. Mutants: wrong filename; exports the wrong view's DOT.
- [ ] AC3 Button states: disabled at load, during a build in flight, after a syntax error, after a >2,000-token refusal; a >400-token build has DOT enabled and SVG disabled; a normal build enables both. Mutants: SVG enabled when capped; DOT disabled when capped; not disabled in flight.
- [ ] AC4 No stale export: after rebuilding a different expression the exported DOT/SVG belong to the new build; after a refused build both are disabled. Mutants: buttons not reset in clearResults(); cache key ignores the build.
- [ ] AC5 URL codec (unit): round trip of every special character, limits, invalid values reported, unknown keys ignored. Mutants: + not encoded; notation always standard; limit removed.
- [ ] AC6 Deep link load (fresh page): auto-build, controls set, #stats, preset restore, input restores and shows the verdict, view/step restore with clamping, invalid params show #link-notice while valid ones apply. Mutants: build skipped; preset skipped; view skipped; notice omitted.
- [ ] AC7 XSS: a malicious regex param shows escaped text and window.__pwned stays undefined. Mutant: error text set via innerHTML.
- [ ] AC8 Copy Link: clipboard text equals the expected URL, "Link copied!" in #copy-link-status clears after 2 s without a sleep, nothing in #live-region; opening the copied URL in a fresh page reproduces the same state. Mutants: timer omitted; link missing the query; live-region write added.
- [ ] AC9 Help dialog: `?` opens it; `?` typed into #regex-input inserts the character and does not open it; Ctrl+? and Alt+? do not open it; arrows do not step while it is open; Esc closes; focus returns to the opener; the shortcut list contains every key in D8. Mutants: input guard removed; open-guard on the arrow handler removed; focus return omitted; one list row removed.
- [ ] AC10 Hygiene: dist assignment-pattern check still only self.onmessage and window.VizRenderer; waitForTimeout count still 2; src/engine diff empty.
