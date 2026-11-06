# 14: Stress panel

**What to build:** An evaluator runs the stress test and sees backtracking time against NFA time as n grows.

**Blocked by:** 03: Simulation

**Status:** ready-for-agent

- [ ] Two families: `(a*)*b` on `aⁿ` and `(a+)+` on `aⁿb`, for n = 12 to 30 in steps of 2, stopping at the first run over 8 seconds. The RegExp runs in an inline worker that is terminated on timeout. The NFA time is shown for the same n and for n up to 1,000.
- [ ] `stress-table` shows the numbers and a simple inline-SVG chart shows time against n. No chart library.
- [ ] The page stays responsive during a run: a control still works.
- [ ] At the Engine seam the NFA gives the correct verdict on both families.
- [ ] The panel shows which browser it ran in, because engines differ.
- [ ] The browser smoke starts a run and sees a row appear.
