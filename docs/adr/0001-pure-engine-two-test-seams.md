# 0001 Pure engine, two test seams, thin UI

Status: proposed, 3 Nov 2026

## Context
The simulator has an algorithmic core (parse, build, simulate, validate) and a presentation layer (diagrams, controls). An agent will build all of it. Tests written against every small function (tokenizer, shunting-yard, builder, closure) break on each refactor and prove little.

## Decision
- The engine is pure TypeScript with no DOM. It returns plain data and runs under Node.
- Tests are written at exactly two seams: the **Engine seam** (analyze, run, validate) and the **Diagram seam** (data to DOT text). The Viz.js call sits behind a one-method renderer port with a real adapter and an in-memory fake.
- The UI is plain TypeScript, kept thin, and is covered by a few browser smoke tests, not unit tests.

## Consequences
- The tokenizer, normaliser, shunting-yard, builder and closure can be reshaped freely while the engine suite stays green.
- Anything the UI needs (step snapshots, merged pairs, positions) must be in the engine's returned data. If the UI needs a computation, it moves into the engine.
- Bugs that live only in the glue (event wiring, DOM) are found by the browser smoke tests or by hand.
