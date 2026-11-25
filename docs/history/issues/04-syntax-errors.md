# 04: Syntax errors with exact positions

**What to build:** A student who mistypes sees the reason and the exact position highlighted in the input, and the last good build stays on screen. Empty input shows a hint, not an error.

**Blocked by:** 02: Core construction

**Status:** done

- [x] Every case in the error-case fixture that uses only syntax available so far (symbols, ε, ∅, union, concatenation, star, parentheses, standard notation) returns the listed code and position (code-point index, whitespace counted). (`tests/engine.test.ts` fixture runner)
- [x] The cases that need `+` or textbook notation stay disabled with a note that ticket 05 or 06 enables them. (`tests/engine.test.ts` skipping with note)
- [x] The first violation scanning left to right is reported. End-of-input checks run in the documented order. (`tests/engine.test.ts`)
- [x] The valid expressions in the fixture build without error, where the syntax exists. (`tests/engine.test.ts`)
- [x] Empty or whitespace-only input shows a hint and no error. (`tests/engine.test.ts`, `tests/e2e.cjs`)
- [x] No error refers to the implicit concatenation, and every error except the empty-input hint carries a position. (`tests/engine.test.ts`)
- [x] The page shows `error-message` with the reason and marks the position in `regex-input`. The browser smoke types `(a|)`, sees the error at position 2, then fixes it. (`tests/e2e.cjs`)
- [x] If a golden case looks wrong, stop and ask. The fixture is not edited. (Confirmed: `fixtures/error-cases.json` untouched)
