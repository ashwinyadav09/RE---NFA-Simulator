---
description: Take the next ready ticket and complete it test-first
---

1. List `.scratch/re-nfa-simulator/issues/`. Pick the lowest-numbered ticket with `Status: ready-for-agent` whose "Blocked by" tickets are all `Status: done`. If there is none, say so and stop.
2. Read the ticket, the parts of `docs/SPEC.md` it cites, and `CONTEXT.md`. If the ticket touches `src/engine/`, read `.agents/skills/thompson-rules/SKILL.md` too.
3. Write the implementation plan: the tests you will write, in order, each at the Engine seam or the Diagram seam. Stop for review if the review policy asks for it.
4. Work red-green, one test at a time: write one failing test, run it and confirm it fails for the right reason, write the least code that passes, repeat. Tests never import engine internals. Refactor only while green.
5. Run `npm run check`. If the ticket touches the UI, also run `npm run e2e`. Both must pass.
6. If the ticket names oracles or mutants, run the mutation checklist from the rules skill and report which mutants were killed.
7. Tick the ticket's acceptance criteria, set `Status: done`, and commit as `ticket NN: <title>`. Report what changed, the test output, and anything that surprised you.
