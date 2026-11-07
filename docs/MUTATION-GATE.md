# Mutation Gate

This document records the design, repeatable command, and verified results for the 13-mutant gate of the Thompson NFA Simulator engine.

## Command

```bash
npm run test:mutants
```

Under the hood, this executes `node tests/mutation-gate.cjs`. It writes each mutant to an isolated temporary directory inside `node_modules/.tmp-mutation-gate` and runs Vitest directly with process spawning (no shell) using a generated temporary Vitest configuration with `--no-file-parallelism`, `--bail 1`, `--reporter=json`, and an engine-first deterministic `PathSequencer` sort order (`tests/engine.test.ts`, `tests/properties.test.ts`, `tests/diagram.test.ts`). The Vite plugin intercepts and redirects module resolution of `src/engine/index.ts` to the mutated file.

## Production Code Integrity

Production code in `src/engine/index.ts` is **never written or modified** by the mutation gate. It carries **no mutation switches**, environment variable checks, or debug hooks. Even if the process is terminated forcibly mid-run during mutant execution, `git status --porcelain` remains clean and `src/engine/index.ts` remains completely untouched.

## StrykerJS Trial

StrykerJS with Vitest runner was attempted once (`npx stryker --version`). Due to module incompatibility on the pinned modern toolchain (TypeScript 7, Vite 8, Vitest 5), it failed with:
```
Error: Cannot find module 'rx'
```
As specified by Ticket 12 and the project guidelines, debugging external toolchain mismatches was halted, and the plain text-substitution harness with Vite module redirection was implemented directly.

## Mutants and Results

The thirteen mutants are defined in Section 9 of `.agents/skills/thompson-rules/SKILL.md`.

| Mutant | Layer | Description | Status | Time | First Failing Test |
| --- | --- | --- | --- | ---: | --- |
| `star-no-back` | builder | drop `A.f -ε→ A.s` in STAR | **KILLED** | 909ms | `engine.test.ts > step-by-step construction for "(a\|b)*a" matches worked-example fixture exactly` |
| `star-no-skip` | builder | drop `s -ε→ f` in STAR | **KILLED** | 991ms | `engine.test.ts > step-by-step construction for "(a\|b)*a" matches worked-example fixture exactly` |
| `union-no-b-exit` | builder | drop `B.f -ε→ f` in UNION | **KILLED** | 925ms | `engine.test.ts > step-by-step construction for "(a\|b)*a" matches worked-example fixture exactly` |
| `plus-skip` | builder | add `s -ε→ f` to PLUS | **KILLED** | 889ms | `engine.test.ts > [T05-1] PLUS fragment for "a+" has 4 states, 4 transitions, invariants hold, correct language` |
| `opt-no-skip` | builder | drop `s -ε→ f` in OPT | **KILLED** | 866ms | `engine.test.ts > [T05-2] OPT fragment for "a?" has 4 states, 4 transitions, invariants hold, correct language` |
| `eps-as-empty` | builder | ε atom without its edge | **KILLED** | 906ms | `engine.test.ts > structural edge cases build correctly: #, @, nested groups, and stacked operators` |
| `empty-as-eps` | builder | ∅ atom with an ε edge | **KILLED** | 899ms | `engine.test.ts > structural edge cases build correctly: #, @, nested groups, and stacked operators` |
| `merge-no-move` | builder | merge deletes `B.s` without moving its transitions | **KILLED** | 903ms | `engine.test.ts > [T06-5] Merge mode: "(a\|b)*a" produces 9 states and 11 transitions, step 6 reports mergedPair {8, 7}, state ids keep gaps` |
| `assoc-right` | parser | binary operators right-associative | **KILLED** | 886ms | `engine.test.ts > [T05-5] parseTree matches Oracle 4 with left-nested binary operators and concat-over-union precedence` |
| `prec-swap` | parser | union binds tighter than concatenation | **KILLED** | 881ms | `engine.test.ts > [T05-5] parseTree matches Oracle 4 with left-nested binary operators and concat-over-union precedence` |
| `closure-one-step` | simulator | closure follows one ε step only | **KILLED** | 872ms | `engine.test.ts > analyzing "(a\|b)*a" produces final NFA, transition table, and initial ε-closure matching worked-example fixture` |
| `no-initial-closure` | simulator | simulation skips the first closure | **KILLED** | 887ms | `engine.test.ts > simulation on "(a\|b)*a" produces traces and verdicts matching worked-example fixture` |
| `no-closure-after-move` | simulator | no closure after each move | **KILLED** | 887ms | `engine.test.ts > simulation on "(a\|b)*a" produces traces and verdicts matching worked-example fixture` |

### Key Properties Verified

1. **Unmutated suite runs first**: aborts with non-zero exit code if baseline is red.
2. **All 13 mutants are killed** by assertion failures (0 survived, 0 errors).
3. **Right-associative parser mutant (`assoc-right`)** is killed specifically by the parse-tree check (`[T05-5] parseTree matches Oracle 4 with left-nested binary operators and concat-over-union precedence`).
4. **Deterministic engine-first test ordering**: `--no-file-parallelism` with custom `PathSequencer` ensures identical test ordering and results across multiple runs.
