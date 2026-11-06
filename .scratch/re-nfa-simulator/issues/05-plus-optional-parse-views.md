# 05: Plus, optional, stacked operators, parse views

**What to build:** A student uses `+` (one or more) and `?`, stacks operators (`a**`, `a+?`), and sees the token list, the postfix form and the parse tree.

**Blocked by:** 02: Core construction

**Status:** ready-for-agent

- [ ] Plus and optional follow the rules table as direct constructions. Sizes match the formulas and I1–I4 hold.
- [ ] `a+?` means (a+)? and `a**` is a star of a star; both build.
- [ ] Analyze returns the parse tree built from the postfix form. Binary operators are left-nested (`abc` and `a|b|c`).
- [ ] The page shows the token list, `postfix-view` and `tree-view`.
- [ ] The error-case fixture cases that need `+` are enabled and pass.
