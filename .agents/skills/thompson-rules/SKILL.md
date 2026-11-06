---
name: thompson-rules
description: Canonical rules for the RE → NFA simulator - lexical and grammar rules, Thompson fragment rules, invariants I1-I4, size formulas, simulation semantics, proposed error taxonomy, test fixtures, oracles and the mutation checklist. Read before touching anything in src/engine/ or writing engine tests.
---

# Thompson rules (canonical)

Source: M1 design document sections 1.4, 1.5, 4.2, 4.5, verified by the research prototype (`research/prototype/`, evidence in `docs/research/evidence/`). Where this file and `docs/SPEC.md` disagree, stop and ask.

## 1. Lexical rules

Positions are **code-point indices into the original source string** (whitespace counts). Iterate with `Array.from`, never by UTF-16 unit.

| Character | standard notation | textbook notation |
| --- | --- | --- |
| `(` `)` | group | group |
| `\|` | UNION | error `NOT_AN_OPERATOR` (hint: use `+`) |
| `+` | PLUS (postfix, one or more) | UNION |
| `*` `?` | STAR, OPT (postfix) | same |
| `@` or `ε` | EPSILON atom | same |
| `#` or `∅` | EMPTY atom | same |
| whitespace | ignored | ignored |
| anything else | SYMBOL (one code point) | same |

ε is a dedicated constant inside the engine, never a character. `@`/`#` are never alphabet symbols.

## 2. Grammar

```
union   := concat ( UNION concat )*
concat  := postfix+                       // implicit concatenation
postfix := atom ( STAR | PLUS | OPT )*    // stacked postfix operators allowed: a** , a+? = (a+)?
atom    := SYMBOL | EPSILON | EMPTY | '(' union ')'
```

Precedence, tightest first: postfix, concatenation, union. Binary operators are left-associative.

## 3. Fragment rules (ε-link concatenation, the default)

Every fragment has one start `s` and one accept `f`, `s ≠ f`. States get ids in creation order, `s` before `f`. Log transitions in the order shown.

| Token | Pops | New states | New transitions | Pushes |
| --- | --- | --- | --- | --- |
| SYMBOL a | 0 | s, f | s -a→ f | (s, f) |
| EPSILON | 0 | s, f | s -ε→ f | (s, f) |
| EMPTY | 0 | s, f | none | (s, f) |
| CONCAT | B, A | none | A.f -ε→ B.s | (A.s, B.f) |
| UNION | B, A | s, f | s -ε→ A.s, s -ε→ B.s, A.f -ε→ f, B.f -ε→ f | (s, f) |
| STAR | A | s, f | s -ε→ A.s, A.f -ε→ f, s -ε→ f, A.f -ε→ A.s | (s, f) |
| PLUS | A | s, f | s -ε→ A.s, A.f -ε→ f, A.f -ε→ A.s | (s, f) |
| OPT | A | s, f | s -ε→ A.s, A.f -ε→ f, s -ε→ f | (s, f) |

**Merge mode** (CONCAT only): no transition is added; `B.s` is deleted and every transition that left `B.s` now leaves `A.f`. Safe because of I2 and I3. State ids keep gaps; never renumber inside the engine.

PLUS and OPT are direct constructions (not `RR*` / `R|ε`). Strict-textbook desugaring is a stretch option.

A step is recorded for every token: index, token, rule name, new states, new transitions, merged pair (merge mode: `{removed, into}`), the fragment produced, and a snapshot of **all fragments on the stack** after the step. Store **copies**, never references into the live NFA. Postfix tokens carry their source position; the implicit CONCAT token takes the position of the operand that follows it.

## 4. Invariants and size

- I1 one start, one accept (distinct). I2 no transition enters the start. I3 no transition leaves the accept. I4 each state has either exactly one outgoing symbol transition and no ε, or no symbol transition and at most two ε.
- Also check: no dangling edges; **step-log replay** (add new states, apply merged renames, add new transitions) reproduces the final NFA exactly.
- States = 2 × (atoms + unions + unary operators), minus the number of concatenations in merge mode. Atoms are symbols, ε and ∅; unary are star, plus, optional.
- Transitions = symbol atoms + ε atoms + 4 × unions + 4 × stars + 3 × (plus + optional) + concatenations (ε-link only).
- Check: `(a|b)*abb` has 14 states / 16 transitions (ε-link) and 11 / 13 (merge). `(a|b)*a` has 10 / 12 and 9 / 11.

## 5. Simulation

`closure(T)` adds every state reachable by ε-moves (T included). `move(T, a)` follows `a`-transitions. Start with `closure({start})`; for each code point `a`: `closure(move(S, a))`. Accept iff the accept state is in the final set. The trace holds the set after the initial closure and after each symbol.
If a set becomes empty the run is **dead**: stop, report the position. A symbol outside the alphabet (inferred symbols plus user additions) is an error at that position, with the trace so far. A symbol inside the alphabet that the expression never mentions simply empties the set.

## 6. Error taxonomy (PROPOSED, pending approval)

Scan left to right with two states (expecting an operand / expecting an operator). Report the **first** violation, always pointing at the offending token. End-of-input checks run in this order: missing right operand, then unclosed parenthesis.

| Code | When | Position |
| --- | --- | --- |
| `EMPTY_INPUT` | no tokens | none; show a hint, not an error |
| `EMPTY_GROUP` | `(` immediately followed by `)` | the `(` |
| `MISSING_OPERAND` | binary operator with nothing usable on its left or right | the operator |
| `NOTHING_TO_REPEAT` | `*` `+` `?` where an operand is expected | the postfix operator |
| `UNBALANCED_LPAREN` | `(` never closed | the unmatched `(` |
| `UNBALANCED_RPAREN` | `)` with no open `(` | the `)` |
| `NOT_AN_OPERATOR` | `\|` in textbook mode | the `\|` |

Golden cases: `fixtures/error-cases.json`. The literal M1 pipeline (A1-A3) accepts and rejects exactly the same inputs as an independent recursive-descent parser (0 disagreements in 2.16 million fuzzed inputs), but for many invalid inputs it names a different error than that parser does, and for some it reports the position of the synthetic CONCAT token or no position at all. A pre-validation pass that implements this table is therefore required.

## 7. Fixtures (expected values come from here, never from the code under test)

- `fixtures/worked-example.json`: `(a|b)*a`, every step, the table, the initial closure, four traces, merge-mode counts.
- `fixtures/classic-abb.json`: `(a|b)*abb` sizes in both modes and accepted/rejected strings.
- `fixtures/error-cases.json`: proposed golden error cases and a list of valid edge expressions.

## 8. Oracles (test support; the first two also ship in the in-app validator)

1. **Bounded-language enumerator**: the semantics of M1 section 1.4 executed literally, all strings up to length k; star by fixpoint under the length bound. Primary oracle.
2. **Brzozowski derivatives** with smart constructors (union dedupe, ∅/ε simplification).
3. **JS RegExp via a translator** that wraps every operand: symbol (escaped), ε → `(?:)`, ∅ → `(?!)`, union `(?:A|B)`, concatenation `(?:AB)`, postfix `(?:A)*`, `(?:A)+`, `(?:A)?`; anchor `^…$`. Run it in a worker with a 2 s cap; **a timeout means "skipped", never "failed"**. Never paste user syntax into `RegExp`: `a+?` is a lazy `a+` there but (a+)? here, and `a**` is a SyntaxError.
4. **A second front-end** (recursive descent, tests only) that produces the AST independently of the shunting-yard path. Assert the parse tree from the postfix equals it.

## 9. Mutation checklist (the suite must kill every one)

Temporarily apply each change, confirm at least one test fails, revert. In the prototype each was killed within 19 property runs (`docs/research/evidence/04-mutation-matrix.txt`).

| Mutant | Change | Caught by |
| --- | --- | --- |
| star-no-back | drop `A.f -ε→ A.s` in STAR | language oracle |
| star-no-skip | drop `s -ε→ f` in STAR | language oracle |
| union-no-b-exit | drop `B.f -ε→ f` in UNION | language oracle |
| plus-skip | add `s -ε→ f` to PLUS | language oracle |
| opt-no-skip | drop `s -ε→ f` in OPT | language oracle |
| eps-as-empty | ε atom without its edge | language oracle |
| empty-as-eps | ∅ atom with an ε edge | language oracle |
| merge-no-move | merge deletes `B.s` without moving its transitions | invariants and language |
| assoc-right | binary operators right-associative | **parse-tree check only** (same language) |
| prec-swap | union binds tighter than concatenation | language and parse tree |
| closure-one-step | closure follows one ε step only | language oracle |
| no-initial-closure | simulation skips the first closure | language oracle |
| no-closure-after-move | no closure after each move | language oracle |

Invariants alone catch only `merge-no-move`. Do not drop the language oracle or the parse-tree check.

## 10. Generators

The default `fc.letrec` + `fc.oneof({ depthSize })` generator produces tiny expressions (median 3 nodes for both `'small'` and `'large'`; 90th percentile 8 and 22). Weight composites up, and keep a test that asserts the size distribution. Shrunk counterexamples must print as source strings that can be pasted into the app.
