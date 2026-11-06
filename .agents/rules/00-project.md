# RE → NFA (Thompson) Simulator

A browser app: type a regular expression, watch Thompson's construction build the ε-NFA one operator at a time, simulate strings with ε-closure traces, and see the app validate itself. Static page, no backend, works offline from one HTML file.

Read first: `docs/SPEC.md` (what), `CONTEXT.md` (vocabulary), `docs/adr/` (why), `.agents/skills/thompson-rules/SKILL.md` (rules, fixtures, mutants).
Tickets: `.scratch/re-nfa-simulator/issues/`. Take the lowest-numbered `ready-for-agent` ticket whose blockers are all `done` (`/next-ticket` does this).
If a ticket contradicts `docs/SPEC.md`, stop and ask.

## Gate
`npm run check` (typecheck, tests, production build) must pass before anything is called done. `npm run e2e` is the browser smoke test. Ticket 01 creates both.

## Architecture
- `src/engine/` is pure TypeScript: no DOM, no import from `src/ui/`. It returns plain JSON-serialisable data and runs under Node.
- `src/ui/` renders what the engine returns and does no algorithmic work. Plain TypeScript, no UI framework unless a ticket says so.
- Diagrams: engine data → DOT text → Viz.js. Use `viz.render()`, which returns errors; `renderString()` throws on bad DOT.

## Tests (TDD, two seams only)
Write tests at the Engine seam (`src/engine/index.ts`) and the Diagram seam (`toDot`). Do not import engine internals from a test. One failing test, then the code to pass it, then the next.
Expected values come from `.agents/skills/thompson-rules/fixtures/` or the oracles, never from the code under test.
Keep the generator size-distribution test passing: fast-check's default expressions are tiny.

## Gotchas
- Import workers with `?worker&inline`. A separate worker file throws `SecurityError` from `file://`.
- Single-file build with `vite-plugin-singlefile`. Viz.js's browser global is `dist/viz-global.js` (`viz-standalone.js` is the old name).
- Never feed user syntax to `RegExp`. `a+?` is (a+)? here but a lazy `a+` there; `a**` is a SyntaxError there. Use the wrapping translator.
- The RegExp oracle can run for seconds on nested quantifiers. Run it in a worker with a 2 s cap; a timeout means skipped, not failed.
- Stress test: `(a*)*b` on `aⁿ`. The textbook `(a?)ⁿaⁿ` is not exponential in V8.
- State ids are creation order and stay stable. Merge mode leaves gaps. Never renumber in the engine.
- Step records hold copies, not references into the live NFA.
- Put `id` on every node and edge in the DOT; the UI finds SVG elements by those ids.
- Error positions are code-point indices into the source, whitespace included.
- Per-step diagrams are rendered with pinned positions from the master layout. Re-running `dot` on each step makes the picture jump.
- Never run `vitest` or `vite` in watch or dev mode in the foreground: use `vitest run` and `vite build`. The browser smoke test opens the built file from `file://` and needs no server.
- The toolchain is newer than most training data (TypeScript 7, Vite 8, Vitest 5). Copy configs from `research/toolchain-smoke/` instead of writing them from memory, and do not change package versions.

## When stuck
After three failed attempts at the same problem, or a command running longer than two minutes, stop. Write down the goal, what you tried (numbered), the exact failing output and your best hypothesis. Run one diagnostic that tells the hypotheses apart before trying another fix. If a decision is needed from the human, ask with the options and your recommendation.
Never edit a fixture or an expected value to make a test pass. If one looks wrong, stop and show the evidence.

## Conventions
Small commits, one ticket each, message `ticket NN: <title>`. Tick the acceptance criteria and set `Status: done` in the ticket file when finished.
