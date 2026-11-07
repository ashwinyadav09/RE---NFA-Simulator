# 12: Mutation gate

**What to build:** The maintainer can show that the suite can fail: thirteen deliberately broken versions of the engine are each caught.

**Blocked by:** 11: Oracles and property suite

**Status:** done

- [x] A repeatable command applies each of the thirteen mutants from the rules skill to a temporary copy of the engine, runs the suite, and reports per mutant whether it was killed and which test failed first. Production code carries no mutation switches. (`npm run test:mutants`, `tests/mutation-gate.cjs`, verified by `[T12-1]`)
- [x] All thirteen are killed. The right-associative parser mutant is killed by the parse-tree check specifically. (13/13 killed; `assoc-right` killed by `[T05-5] parseTree matches Oracle 4 with left-nested binary operators and concat-over-union precedence`, verified by `[T12-2]`)
- [x] If any mutant survives, tests are strengthened; mutants are never weakened. (0 survived; tests strengthened with `[T12-1]`, `[T12-2]`, `[T12-3]`)
- [x] StrykerJS with the Vitest runner is tried once. If it does not run on the pinned toolchain, a plain text-substitution harness is used instead. (StrykerJS failed with `Cannot find module 'rx'`, text-substitution harness used in `tests/mutation-gate.cjs`)
- [x] The command and its output table are documented. (`docs/MUTATION-GATE.md`, referenced in `docs/SPEC.md`)
