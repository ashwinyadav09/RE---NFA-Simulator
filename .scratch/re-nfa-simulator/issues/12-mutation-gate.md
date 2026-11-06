# 12: Mutation gate

**What to build:** The maintainer can show that the suite can fail: thirteen deliberately broken versions of the engine are each caught.

**Blocked by:** 11: Oracles and property suite

**Status:** ready-for-agent

- [ ] A repeatable command applies each of the thirteen mutants from the rules skill to a temporary copy of the engine, runs the suite, and reports per mutant whether it was killed and which test failed first. Production code carries no mutation switches.
- [ ] All thirteen are killed. The right-associative parser mutant is killed by the parse-tree check specifically.
- [ ] If any mutant survives, tests are strengthened; mutants are never weakened.
- [ ] StrykerJS with the Vitest runner is tried once. If it does not run on the pinned toolchain, a plain text-substitution harness is used instead.
- [ ] The command and its output table are documented.
