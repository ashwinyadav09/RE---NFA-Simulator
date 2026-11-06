# 06: Settings: textbook notation, merge mode, ε/∅ input, alphabet

**What to build:** A student switches notation and concatenation convention to match their notes, enters ε and ∅ by button or alias, and edits the alphabet.

**Blocked by:** 02: Core construction

**Status:** done

- [x] Textbook notation: `+` is union, one-or-more is unavailable, `|` gives NOT_AN_OPERATOR with a hint, `?` still works. The textbook golden cases pass. (`tests/engine.test.ts` `[T06-1]`, `[T06-2]`, `[T06-3]`, `[T06-4]`, `fixtures/error-cases.json`, `tests/e2e.cjs`)
- [x] Merge mode: `(a|b)*abb` has 11 states and 13 transitions and `(a|b)*a` has 9 and 11. Each concatenation step reports the merged pair, replay reproduces the final NFA, ids keep gaps and nothing is renumbered, and I1–I4 hold. (`tests/engine.test.ts` `[T06-5]`, `[T06-6]`, `[T06-7]`, `tests/diagram.test.ts`, `tests/e2e.cjs`)
- [x] `@` or `ε`, and `#` or `∅`, are accepted. The buttons insert them at the cursor. They never become alphabet symbols. Whitespace is ignored. (`tests/engine.test.ts` `[T06-9]`, `tests/e2e.cjs`)
- [x] The alphabet is inferred and editable. Added symbols can be simulated. Removing a symbol the expression uses is refused with a message. (`tests/engine.test.ts` `[T06-10]`, `[T06-11]`, `tests/e2e.cjs`)
- [x] `notation-select` and `concat-select` work, and changing either rebuilds. (`tests/e2e.cjs`)

## Notes
- make EPS a dedicated sentinel, not the string 'ε'

