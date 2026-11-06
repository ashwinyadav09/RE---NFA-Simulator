# Research prototype (throwaway)

Follows the M1 pseudocode A1-A4 literally so the experiments test the design, not a better implementation. It is shallow on purpose and is not the architecture to build (see docs/adr/0001).

- `engine.mjs`  tokenizer, concatenation insertion, shunting-yard, builder (with mutation hooks), simulator, invariants, step-log replay, recursive-descent parser
- `oracles.mjs` bounded-language enumerator, Brzozowski derivatives, wrapping RegExp translator, printer, generators' helpers
- `lib-props.mjs` fast-check generator and the three detectors (invariants, language, parse tree)
- `exp1` M1 literals and error cases · `exp2a` front-end fuzz · `exp2b` baseline properties · `exp2c` mutation matrix
- `exp3a` stacked quantifiers · `exp3b`/`exp3c` RegExp pitfalls and stress families · `exp4` Viz.js
- `gen-fixtures.mjs` writes the JSON fixtures used by `.agents/skills/thompson-rules/fixtures`
- `e2e-file-protocol.cjs` Playwright check of the single-file build from `file://` (paths point at the smoke project; adjust before running)

Reusable ideas for test support: the enumerator, the derivative matcher, the translator, the second parser, the detectors.
