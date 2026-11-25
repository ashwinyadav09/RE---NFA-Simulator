# 13: Validation panel

**What to build:** An evaluator sees every check pass or fail, runs the built-in suite, and runs a differential test of their own expression.

**Blocked by:** 03: Simulation; 11: Oracles and property suite

**Status:** done

- [x] After each build `inv-I1` to `inv-I4`, `inv-size` and `inv-replay` each show pass or fail with a one-line explanation. A hand-made broken NFA is shown failing at the Engine seam. (Verified by `tests/engine.test.ts` `[T13-01]`, `[T13-02]`, and `tests/e2e.cjs`)
- [x] The built-in suite has at least 20 expressions: a single symbol, ε and ∅; union chains; nested and stacked operators including `((a|b)*)*` and `a**`; the textbook examples `(a|b)*a`, `(a|b)*abb` and `a*b`; error cases with the expected code; both notations. For `(a|b)*abb`, abb, aabb and babb are accepted and abab, ab and the empty string are rejected. Expected values are hand-written, never computed by the NFA. `run-suite` fills `suite-table` with expected versus generated and pass or fail per row. (Verified by `tests/engine.test.ts` `[T13-03]` and `tests/e2e.cjs`)
- [x] The differential run tests every string up to the largest k ≤ 8 whose total stays at or below 50,000 (floor 3), tells the user the k, uses the three oracles, shows `skipped (timeout)` for a capped RegExp, and lists any mismatching string. (Verified by `tests/engine.test.ts` `[T13-04]`, `[T13-05]`, and `tests/e2e.cjs`)
- [x] The page never freezes during a differential run. (Verified by async execution and worker timeout cap in `src/ui/main.ts` and `src/ui/worker.ts`)
- [x] The browser smoke shows all checks passing for `(a|b)*a`. (Verified by `tests/e2e.cjs`)
