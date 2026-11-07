# Mutation Gate

This document records the design, repeatable command, and verified results for the 13-mutant gate of the Thompson NFA Simulator engine.

## Command

```bash
npm run test:mutants
```

Under the hood, this executes `node tests/mutation-gate.cjs`. It applies text substitutions to a temporary copy of `src/engine/index.ts`, runs the test suite with Vitest (`--bail 1 --reporter=json`), collects the first failing test per mutant, and restores the engine file.

## Production Code Integrity

Production code carries **no mutation switches**, environment variable checks, or debug hooks. The mutations are applied purely out-of-band by the harness and immediately reverted.

## StrykerJS Trial

StrykerJS with Vitest runner was attempted once (`npx stryker --version`). Due to module incompatibility on the pinned modern toolchain (TypeScript 7, Vite 8, Vitest 5), it failed with:
```
Error: Cannot find module 'rx'
```
As specified by Ticket 12 and the project guidelines, debugging external toolchain mismatches was halted, and the plain text-substitution harness was implemented directly.

## Mutants and Results

The thirteen mutants are defined in Section 9 of `.agents/skills/thompson-rules/SKILL.md`.

| Mutant | Layer | Description | Status | Time | First Failing Test |
| --- | --- | --- | --- | ---: | --- |
| `star-no-back` | builder | drop `A.f -ε→ A.s` in STAR | **KILLED** | 1997ms | `engine.test.ts > step-by-step construction for "(a\|b)*a" matches worked-example fixture exactly` |
| `star-no-skip` | builder | drop `s -ε→ f` in STAR | **KILLED** | 2039ms | `diagram.test.ts > [T08-7] step 2 of (a\|b)*a with pinned positions keeps SVG viewBox height within master layout bounds` |
| `union-no-b-exit` | builder | drop `B.f -ε→ f` in UNION | **KILLED** | 2034ms | `engine.test.ts > step-by-step construction for "(a\|b)*a" matches worked-example fixture exactly` |
| `plus-skip` | builder | add `s -ε→ f` to PLUS | **KILLED** | 2094ms | `engine.test.ts > [T05-1] PLUS fragment for "a+" has 4 states, 4 transitions, invariants hold, correct language` |
| `opt-no-skip` | builder | drop `s -ε→ f` in OPT | **KILLED** | 2092ms | `engine.test.ts > [T05-2] OPT fragment for "a?" has 4 states, 4 transitions, invariants hold, correct language` |
| `eps-as-empty` | builder | ε atom without its edge | **KILLED** | 2096ms | `engine.test.ts > structural edge cases build correctly: #, @, nested groups, and stacked operators` |
| `empty-as-eps` | builder | ∅ atom with an ε edge | **KILLED** | 2134ms | `engine.test.ts > structural edge cases build correctly: #, @, nested groups, and stacked operators` |
| `merge-no-move` | builder | merge deletes `B.s` without moving its transitions | **KILLED** | 2106ms | `engine.test.ts > [T06-5] Merge mode: "(a\|b)*a" produces 9 states and 11 transitions, step 6 reports mergedPair {8, 7}, state ids keep gaps` |
| `assoc-right` | parser | binary operators right-associative | **KILLED** | 2104ms | `engine.test.ts > [T05-5] parseTree matches Oracle 4 with left-nested binary operators and concat-over-union precedence` |
| `prec-swap` | parser | union binds tighter than concatenation | **KILLED** | 1999ms | `engine.test.ts > [T05-5] parseTree matches Oracle 4 with left-nested binary operators and concat-over-union precedence` |
| `closure-one-step` | simulator | closure follows one ε step only | **KILLED** | 2021ms | `engine.test.ts > analyzing "(a\|b)*a" produces final NFA, transition table, and initial ε-closure matching worked-example fixture` |
| `no-initial-closure` | simulator | simulation skips the first closure | **KILLED** | 2005ms | `engine.test.ts > simulation on "(a\|b)*a" produces traces and verdicts matching worked-example fixture` |
| `no-closure-after-move` | simulator | no closure after each move | **KILLED** | 2010ms | `engine.test.ts > simulation on "(a\|b)*a" produces traces and verdicts matching worked-example fixture` |

### Key Properties Verified

1. **All 13 mutants are killed** by the existing test suite (0 survived).
2. **Right-associative parser mutant (`assoc-right`)** is killed specifically by the parse-tree check (`[T05-5] parseTree matches Oracle 4 with left-nested binary operators and concat-over-union precedence`).
3. Total gate runtime is ~27 seconds on Node v24.
