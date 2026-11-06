# 03: Simulation with ε-closure trace

**What to build:** A student enters a string and sees the ε-closed active set after the initial closure and after each symbol, then ACCEPT or REJECT. Several strings at once give one verdict each.

**Blocked by:** 02: Core construction

**Status:** done

- [x] Run returns the trace (the set after the initial closure and after each symbol) and the verdict. For `(a|b)*a` the traces of `ba`, `ab`, `a` and the empty string equal the worked-example fixture. (`tests/engine.test.ts` matching `worked-example.json`)
- [x] When the active set becomes empty the run is reported dead at that position and stops. (`tests/engine.test.ts` testing `'cab'` and `'bc'`)
- [x] A symbol outside the alphabet is reported at its position with the trace so far. A symbol inside the alphabet that the expression never uses empties the set. (`tests/engine.test.ts` testing `'bx'` and `'x'` vs `'c'`)
- [x] Strings are processed by code point: an expression over a non-BMP symbol accepts the right strings. (`tests/engine.test.ts` testing `'🚀'` and `'🚀x'`)
- [x] One string per line gives one verdict per line. (`tests/engine.test.ts` testing `runLines`)
- [x] The page shows `trace` and `verdict` from `test-input` and `run-button`. The browser smoke runs `ba`, sees ACCEPT and the two sets. (`tests/e2e.cjs` via `npm run e2e`)

