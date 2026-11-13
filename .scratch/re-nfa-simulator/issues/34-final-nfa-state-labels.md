# 34: Final NFA state labels, start is always q0, then q1, q2...

**What to build:** In the Final NFA view, the start state is always $q_0$, then $q_1, q_2 \dots$ with no gaps. Display-only: engine state IDs stay as they are. Pure module `normalizeStateLabels(nfa)` computes BFS mapping from start with ties broken by construction ID; accept state is always last $q_{n-1}$; unreachable states come after reachable ones in construction order with accept still last. Merge mode (IDs with gaps) also produces contiguous labels. Used in Final NFA graph nodes, transition table, simulation traces, tooltips, ARIA labels, exported SVG, and validation messages. Step-by-step NFA view retains construction-order labels with a badge. "built as N" shown in tooltips/table.

**Blocked by:** 33: Remove textbook view and export dot, fix view toggle layout shift

**Status:** done

- [x] AC1: Pure module `src/ui/state-labels.ts` implements `normalizeStateLabels(nfa: NFA): Map<number, string>` where start state is `q0`, reachable states numbered via BFS breaking ties by construction ID (ascending), unreachable states placed in construction order, accept state is strictly last `q(n-1)`. Contiguous labels with no gaps across epsilon-link and merge modes.
- [x] AC2: Comprehensive unit test suite in `tests/state-labels.test.ts` covering independently hand-checked fixtures: `(a|b)*a` (`6->q0, 4->q1, 7->q2, 0->q3, 2->q4, 8->q5, 1->q6, 3->q7, 5->q8, 9->q9`), `a`, `a|b`, `(a|b)*abb`, `@`, `#`, and merge mode.
- [x] AC3: Final NFA diagram nodes and tooltips display normalized labels (`q0`, `q1`...) and "built as X".
- [x] AC4: Step-by-step NFA view retains construction-order labels with badge: "construction numbering, Final NFA renumbers so start = q0".
- [x] AC5: Transition table displays normalized labels in Final NFA view with "built as X" info, and construction labels in NFA step-by-step view.
- [x] AC6: Simulation traces, active set chips, aria-labels, and live region announcements use normalized state labels in Final NFA mode.
- [x] AC7: Exported SVG reflects the active view's state labels.
- [x] AC8: Mutants defined and killed in `tests/ui-mutants.cjs`.

