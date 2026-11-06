# 03: Simulation with ε-closure trace

**What to build:** A student enters a string and sees the ε-closed active set after the initial closure and after each symbol, then ACCEPT or REJECT. Several strings at once give one verdict each.

**Blocked by:** 02: Core construction

**Status:** ready-for-agent

- [ ] Run returns the trace (the set after the initial closure and after each symbol) and the verdict. For `(a|b)*a` the traces of `ba`, `ab`, `a` and the empty string equal the worked-example fixture.
- [ ] When the active set becomes empty the run is reported dead at that position and stops.
- [ ] A symbol outside the alphabet is reported at its position with the trace so far. A symbol inside the alphabet that the expression never uses empties the set.
- [ ] Strings are processed by code point: an expression over a non-BMP symbol accepts the right strings.
- [ ] One string per line gives one verdict per line.
- [ ] The page shows `trace` and `verdict` from `test-input` and `run-button`. The browser smoke runs `ba`, sees ACCEPT and the two sets.
