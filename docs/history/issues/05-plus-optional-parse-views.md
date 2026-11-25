# 05: Plus, optional, stacked operators, parse views

**What to build:** A student uses `+` (one or more) and `?`, stacks operators (`a**`, `a+?`), and sees the token list, the postfix form and the parse tree.

**Blocked by:** 02: Core construction

**Status:** done

- [x] Plus and optional follow the rules table as direct constructions. Sizes match the formulas and I1–I4 hold. (`tests/engine.test.ts` lines 563-618: T05-1, T05-2 pass)
- [x] `a+?` means (a+)? and `a**` is a star of a star; both build. (`tests/engine.test.ts` lines 620-642: T05-3 pass)
- [x] Analyze returns the parse tree built from the postfix form. Binary operators are left-nested (`abc` and `a|b|c`). (`tests/engine.test.ts` lines 644-708: T05-4, T05-5 pass against Oracle 4 `parseRD`)
- [x] The page shows the token list, `postfix-view` and `tree-view`. (`tests/e2e.cjs` steps 15–18 pass: token list, postfix, tree view rendered and asserted)
- [x] The error-case fixture cases that need `+` are enabled and pass. (`tests/engine.test.ts` lines 465-498 pass: standard `+a` error case and `a**`, `a+?`, `a?*` valid cases enabled)
