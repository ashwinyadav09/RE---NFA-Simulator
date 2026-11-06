# 02: Core construction: symbols, ε, ∅, union, concatenation, star

**What to build:** A student types `(a|b)*a`, presses Build, and sees the postfix form, the final NFA diagram and the transition table with the numbers of the hand-solved example (10 states, 12 transitions, start 6, accept 9). The same path handles ε, ∅, parentheses and implicit concatenation, in standard notation with ε-link concatenation.

**Blocked by:** 01: Walking skeleton

**Status:** ready-for-agent

- [ ] Analyze returns the tokens, the postfix form, one step per postfix token, the final NFA and statistics for expressions built from symbols, ε, ∅, union, implicit concatenation, star and parentheses.
- [ ] For `(a|b)*a`, every step's new states, new transitions and produced fragment, the final transition table and the initial ε-closure equal the worked-example fixture.
- [ ] Each step stores copies and the stack of fragments after it. Replaying the step log reproduces the final NFA exactly.
- [ ] For the fixture expressions the size formulas for states and transitions and invariants I1–I4 hold. `(a|b)*abb` has 14 states and 16 transitions.
- [ ] Structural edge cases build: `#` is two states and no transition; `@` is two states and one ε-transition; nested and stacked groups work.
- [ ] The page shows `postfix-view`, `canvas`, `transition-table` and `stats`. The browser smoke builds `(a|b)*a` and sees 10 states and 12 transitions.
- [ ] Simulation is not part of this ticket.
