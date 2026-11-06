# 06: Settings: textbook notation, merge mode, ε/∅ input, alphabet

**What to build:** A student switches notation and concatenation convention to match their notes, enters ε and ∅ by button or alias, and edits the alphabet.

**Blocked by:** 02: Core construction

**Status:** ready-for-agent

- [ ] Textbook notation: `+` is union, one-or-more is unavailable, `|` gives NOT_AN_OPERATOR with a hint, `?` still works. The textbook golden cases pass.
- [ ] Merge mode: `(a|b)*abb` has 11 states and 13 transitions and `(a|b)*a` has 9 and 11. Each concatenation step reports the merged pair, replay reproduces the final NFA, ids keep gaps and nothing is renumbered, and I1–I4 hold.
- [ ] `@` or `ε`, and `#` or `∅`, are accepted. The buttons insert them at the cursor. They never become alphabet symbols. Whitespace is ignored.
- [ ] The alphabet is inferred and editable. Added symbols can be simulated. Removing a symbol the expression uses is refused with a message.
- [ ] `notation-select` and `concat-select` work, and changing either rebuilds.
