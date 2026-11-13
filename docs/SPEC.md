# Spec: RE → NFA (Thompson) Simulator

Status: draft for approval · 3 Nov 2026
Inputs: M1 design document v0.1 (25 Oct 2026), `docs/research/REPORT.md`, evidence in `docs/research/evidence/`.
Vocabulary: `CONTEXT.md`. Construction rules, fixtures and mutants: `.agents/skills/thompson-rules/SKILL.md`.

## Problem Statement

Thompson's construction is usually taught from static figures. A student sees the finished NFA but not how the expression decomposes, how each operator wires smaller automata together, or why a string is accepted. The tools found in the research either leave the ε-wiring to the user, show only accept or reject, or never check their own output, so the student cannot tell whether a drawn automaton is correct. Whoever builds the simulator (a coding agent) needs a precise, testable description, because the construction has many small cases (ε, ∅, stacked operators, two concatenation conventions) that are easy to get subtly wrong.

## Solution

A static web page, usable offline from one HTML file, that:

- takes a regular expression, reports syntax errors with the exact position, and shows the tokens, the postfix form and the parse tree;
- builds the ε-NFA one postfix token at a time, drawing every fragment currently held and highlighting what the step created, with a stable picture that does not jump between steps;
- shows the final NFA as a diagram and a transition table with size statistics;
- simulates strings and shows the ε-closed active set after every symbol, and the verdict;
- validates itself: structural invariants, a size formula, a step-log completeness check, differential tests against three independent oracles, a built-in expected-versus-generated suite, and a stress test against a backtracking engine.

All algorithmic work happens in a pure TypeScript engine that also runs under Node. The page only renders what the engine returns.

## User Stories

**Input and settings**
1. As a student, I type a regular expression and press Build (or Enter) to see its NFA.
2. As a student, I pick from presets of classic expressions (such as `(a|b)*a`, `(a|b)*abb`, `a*b`) so I can start without typing.
3. As a student, when my expression has a syntax error I see the reason and the exact position, highlighted in the input, so I can fix it. Nothing else on the page changes.
4. As a student, I switch between standard notation (`|` is union, `+` is one-or-more) and textbook notation (`+` is union) so the tool matches my notes.
5. As a student, I switch concatenation between ε-link and merge so the figures match my textbook.
6. As a student, I enter ε and ∅ with on-screen buttons or by typing `@` or `#` (or pasting `ε` or `∅`), so I never need a special keyboard layout.
7. As a student, I see the alphabet inferred from my expression and can add symbols to it to test strings over a larger alphabet.
8. As a student, spaces in my expression are ignored and never become symbols.

**Parsing views**
9. As a student, I see the token list, the postfix form and the parse tree so I understand how the expression decomposes.
10. As a student, I click a postfix token and the construction jumps to the step that handled it.

**Construction**
11. As a student, I see one step per postfix token, each naming the rule applied (for example "union of fragments 0→1 and 2→3").
12. As a student, at each step the canvas shows every fragment currently on the stack, and what this step created is marked by colour, a thicker line and a text tag, so colour is never the only cue.
13. As a student, I step with Prev and Next buttons or the arrow keys, play and pause at an adjustable speed, and jump to the first or last step.
14. As a student, existing states do not move when a step adds elements.
15. (Removed in Ticket 33 / ADR 0009) Textbook view composite sub-boxes removed; two views remain: NFA (step-by-step) and Final NFA.
16. As a student, I hover a state to see the step that created it. ε-edges are dashed, the start state has an incoming arrow, the accept state is a double circle.
17. As a student in merge mode, the step that merges two states shows both and what they became.
18. As a student, an expression above the stepping cap still builds: I get the final NFA, the table and the tests, plus a message saying why stepping is off.

**Final NFA and simulation**
19. As a student, I see the final NFA as a diagram and as a transition table, with state and transition counts.
20. As a student, I toggle compact state labels; the table, the trace and the diagram always use the same labels.
21. As a student, I run any string and see the active set after the initial ε-closure and after each symbol, then ACCEPT or REJECT.
22. As a student, I step through the trace and see the active states highlighted on the diagram.
23. As a student, when the active set becomes empty the trace says the run is dead and stops there.
24. As a student, a symbol outside the alphabet is reported at its position, with the trace so far.
25. As a student, I paste several strings, one per line, and get every verdict at once.

**Validation**
26. As a student or evaluator, after every build I see I1–I4, the size formula and the step-log completeness check, each marked pass or fail with a one-line explanation.
27. As an evaluator, I run the built-in suite (at least 20 expressions) and see expected versus generated results, pass or fail per row.
28. As an evaluator, I run a differential test of my expression against the oracles on every string up to length k. If the alphabet makes that too large, k is reduced and I am told.
29. As an evaluator, if the RegExp oracle takes too long, its row says "skipped (timeout)", never "failed".
30. As an evaluator, I run the stress test and see time against n for a backtracking RegExp and for the NFA, without the page freezing.

**Delivery and quality**
31. As an evaluator, I open the app from a link, or from one HTML file on disk, with no network.
32. As a student, the app was tested in Chromium over file://; other browsers are not verified (owner decision: Chromium only).
33. As a student, I can do everything by keyboard, verdicts and step changes are announced to screen readers, and colour is never the only signal.
34. As an evaluator, I see the hand-solved example `(a|b)*a` reproduced step by step with the numbers in the design document.

**Maintainer**
35. As the maintainer, the engine runs under Node with no DOM, so all algorithm tests run without a browser.
36. As the maintainer, the suite fails if any of the thirteen named mutants survives.
37. As the maintainer, a failing property test prints a shrunk counterexample as a source string I can paste into the app.
38. As the maintainer, one command runs typecheck, tests and the production build.

## Implementation Decisions

### Modules and seams
- **Engine** (deep module). One public entry with three operations. *Analyze* takes source and options (notation, construction mode) and returns either the compiled result (tokens with positions, postfix, parse tree, steps, the final NFA, statistics, inferred alphabet) or a single error with code, position, message and hint. *Run* takes an NFA, an alphabet and a string and returns the trace and verdict, or a dead or out-of-alphabet status with its position. *Validate* takes a compiled result and a configuration and returns the invariant results, the size-formula and replay checks, and the differential results with each oracle's status. Tokenizing, concatenation insertion, shunting-yard, the builder and the closure are internal.
- **Diagram** (deep module). A pure function from a snapshot (fragments on the stack or the final NFA), a highlight set, a view mode and pinned positions to DOT text (adding `splines=true;` when pins are given). Helper function `computeMasterLayout` is part of the Diagram seam (extractNodePositions is an internal helper). A renderer port has a Viz.js adapter and an in-memory fake.
- **Layout.** Once per build, lay out the ε-link final NFA with `dot` left to right and keep the node positions (it is a superset of every state ever created, so merge mode uses it too). Every per-step render pins those positions. In the experiment this gave zero drift at every step, against up to 574 points of drift when `dot` re-ran on each step.
- **UI.** Plain TypeScript, no framework, a handful of small view modules wired by one controller. It holds no algorithm.
- **Workers.** Imported inline (see ADR 0002).
- **Test support, not shipped:** the oracles, a second recursive-descent front-end, and the fast-check generators.

### Behaviour decided
- Fragment rules, invariants, size formulas, lexical and grammar rules are in the rules skill and are binding. The M1 defaults stand: browser app, `|` union with a `+` textbook mode, ε-link concatenation with a merge option, NFA → DFA only as a stretch goal.
- Each step stores copies and carries the merged pair (merge mode) and a snapshot of every fragment on the stack, so any step's picture can be rebuilt from the step log alone.
- In textbook notation `|` is an error, not a symbol. `ε` and `∅` are accepted as aliases for `@` and `#`. Whitespace is ignored. Symbols and positions are code points.
- Errors follow the proposed taxonomy in the rules skill: a pre-validation pass names the first violation and points at the offending token. The M1 pipeline decides validity correctly, so the pass only improves diagnostics.
- A symbol in the alphabet that the expression never uses empties the active set (dead run); a symbol outside the alphabet is an error.
- Differential testing uses three oracles: the bounded-language enumerator (primary), Brzozowski derivatives, and the browser's RegExp through the wrapping translator in a worker with a 2 s cap. The derivative matcher is no longer a stretch goal.
- The differential run tests every string up to the largest k ≤ 8 for which the total stays at or below 50,000 strings (down to a floor of 3), and tells the user the k it used.
- The stress test uses `(a*)*b` on `aⁿ` and `(a+)+` on `aⁿb`, not `(a?)ⁿaⁿ`: in V8 12.4 the textbook pattern stayed flat (under 1 ms at n = 30) while `(a*)*b` took 4.9 s at n = 26 and did not finish in 6 s at n = 28. Run n = 12 to 30 in steps of 2, stop at the first run over 8 s, and show the NFA's time for the same n and for n up to 1,000.

### Budgets and caps (defaults, adjustable in one config object)
- Engine limit: 2,000 tokens (symbols plus operators); beyond that, a clear message.
- Stepping in NFA view: up to 400 postfix tokens (with pinned master layout up to 150). Beyond 400 the diagram is off but the table and tests still work.
- Measured Graphviz render times (dot, left to right, median of 5, Node): 49 ms at 219 postfix tokens (280 states), 147 ms at 549 tokens, 516 ms at 1,099 tokens (1.2 MB of SVG). Per-step pinned rendering has been shown correct on a 14-state NFA but not timed at scale: the stable-layout ticket must measure it and cache rendered SVG per step if a render exceeds 100 ms.
- Simulation: 342 ms for a 4,800-state NFA on a length-800 string in unoptimised plain JavaScript; no budget problem.

### Build and delivery
Vite, TypeScript, Vitest, fast-check, Viz.js, `vite-plugin-singlefile`, Playwright for the browser smoke test. Versions verified together on 3 Nov 2026: `@viz-js/viz` 3.31.0 (Graphviz 16.1.0), `typescript` 7.0.2, `vite` 8.3.5, `vitest` 5.1.0, `fast-check` 4.10.2, `@fast-check/vitest` 0.5.0, `vite-plugin-singlefile` 2.3.4. Pin exact versions. The single-file build is about 1.36 MB (490 KB gzipped) and worked from `file://` in headless Chromium.

### UI contract (stable test ids)
`regex-input`, `build-button`, `notation-select`, `concat-select`, `error-message`, `token-list`, `postfix-view`, `tree-view`, `step-prev`, `step-next`, `step-play`, `step-counter`, `step-log`, `canvas`, `layout-note`, `view-toggle`, `transition-table`, `stats`, `test-input`, `run-button`, `trace`, `verdict`, `inv-I1` … `inv-I4`, `inv-size`, `inv-replay`, `run-suite`, `suite-table`, `stress-run`, `stress-table`.

## Testing Decisions

- **Seams:** the Engine seam and the Diagram seam only. Proposed for confirmation; no test is written until they are confirmed. No other module is imported by a test.
- **A good test** states what a student or the UI could observe: an error with a position, a step's new transitions, a trace's sets, a DOT string's nodes and ids. It survives any internal refactor.
- **Expected values** come from the fixtures (the verified hand-solved example, the classic `(a|b)*abb` sizes, the error golden cases) or from an oracle. Never from the code being tested.
- **Properties** (fast-check, over generated expressions, both construction modes, both notations): the three oracles agree with each other; the NFA's language equals the enumerator's on every string up to length 6; I1–I4, the size formula and step-log replay hold; the parse tree from the postfix equals the tree from the independent front-end; merge and ε-link agree on the language and differ by exactly the number of concatenations; the two front-ends accept and reject the same inputs.
- **Generator:** weight composites up and add a test asserting the size distribution. The default generator's median is 3 nodes.
- **Mutation gate:** the thirteen mutants in the rules skill must each make at least one test fail. Report which test killed which. Implemented by `npm run test:mutants` and documented in `docs/MUTATION-GATE.md`.
- **Diagram seam:** DOT for the final `(a|b)*a`: node and edge counts, ids on every element, dashed ε-edges, double circle on the accept state, start arrow; highlight set marks exactly the new elements; pinned positions appear when given with `splines=true;`; `computeMasterLayout` is part of the seam (extractNodePositions is an internal helper); invalid DOT surfaces as an error value, not an exception.
- **Browser smoke (Playwright, from `file://`):** build `(a|b)*a`, see 10 states and 12 transitions; step to 6/6; run `ba` and see ACCEPT; open the validation panel and see all checks pass; run the stress test and see a row appear. A mistyped expression shows the error and its position.
- **Prior art in the repo:** none; this is a new project. Prototype code in `research/prototype/` is a reference for oracles, not code to copy.

## Out of Scope

Backreferences, lookarounds, capture groups, lazy and possessive quantifiers, anchors, character classes, multi-character symbols and escape sequences, performance work on very large expressions, saving or sharing sessions, localisation. NFA → DFA conversion and minimisation are stretch goals to be ticketed only after the core is done.

## Further Notes

**Changes to the M1 document that this spec makes** (evidence numbers refer to `docs/research/evidence/`):
- D6 The stress-test pattern changes (05a, 05b).
- D7 Validation uses three oracles; derivatives are promoted from stretch; the RegExp oracle runs in a capped worker (05a, 05b, 05c).
- D8 Error diagnostics are specified by a taxonomy with a pre-validation pass; the recursive-descent parser is test support (02, 01).
- D9 Steps carry the merged pair and the stack snapshot and store copies (01, 03).
- D10 Stable layout from a master layout (up to 150 tokens); caps at 400 (06; textbook view removed in Ticket 33 / ADR 0009).
- D11 Single-file offline delivery with inline workers; pinned, verified toolchain; browser smoke test (07, 00).
- D12 Plain TypeScript UI and a stable test-id contract.
- D13 `|` is an error in textbook mode; `ε` and `∅` aliases; whitespace ignored.
- D14 Differential cap of 50,000 strings with automatic k.
- D15 Thirteen-mutant gate (04).

**Open questions:** (1) which union notation and concatenation convention the course notes use (M1 next step 3); the defaults stay until you check. (2) Resolved per ADR 0002 (8 Nov 2026): tested in Chromium over file://; other browsers are not verified (owner decision: Chromium only; Firefox not checked). (3) Where the page is hosted, if anywhere.

**Building with Antigravity.** The repository seed is arranged for it: `AGENTS.md` for always-on rules, `.agents/skills/` for on-demand knowledge, `.agents/workflows/` for the `/next-ticket` command. See the README for what was and was not verified about Antigravity's behaviour.
