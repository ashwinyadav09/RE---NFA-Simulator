# Prompts for building the simulator in Antigravity

The loop for every ticket: paste the **ticket prompt** (section 2) plus that ticket's **add-on** (section 3) → review the plan the agent writes → approve → let it work → review the result in a fresh conversation (section 6) → merge → next ticket. If the agent stalls, use a prompt from section 5.

## 0. Setup, once

- Unzip, open the folder as the workspace, run `git init` and commit the seed.
- Check the rules panel lists `AGENTS.md`. If it does not, copy it to `.agents/rules/00-project.md`.
- Terminal policy: let `npm`, `npx`, `node` and `git` run without prompting, so `npm run check` is a real gate. Keep plan review switched on for the first two tickets, then relax it for small ones.
- One conversation per ticket. State lives in `AGENTS.md` and the ticket files, never in the chat. Long conversations are the most common way agents get lost.
- Use the strongest model you have for tickets 01, 02, 07, 08, 11 and 12 (toolchain, core algorithm, layout, oracles, mutation harness).
- One git branch per ticket. Merge only after `npm run check` passes.

**What to look for in the plan before you approve it:** every test sits at the Engine seam or the Diagram seam; the first test is the smallest behaviour; nothing outside the ticket's acceptance criteria; no new dependency or framework.

## 1. Kickoff (once, new conversation, no code)

```
You will build the RE → NFA (Thompson) Simulator in this workspace. Do not write code or change files yet.

Read in this order: AGENTS.md, CONTEXT.md, docs/SPEC.md, .agents/skills/thompson-rules/SKILL.md, the three files in docs/adr/, and the title, "Blocked by" line and acceptance criteria of every ticket in .scratch/re-nfa-simulator/issues/.

Then answer:
1. What the product is, in two sentences of your own.
2. The two test seams, and what is never tested directly.
3. Which gotchas in AGENTS.md you are most likely to hit, and how you will avoid each.
4. The order you will take the tickets in, and which could run in parallel.
5. Anything in the spec, rules or tickets that is ambiguous or contradicts itself, with the lines quoted.
Stop after answering and wait for me.
```

## 2. The ticket prompt (every ticket; replace NN)

```
Work ticket NN in .scratch/re-nfa-simulator/issues/. Every ticket in its "Blocked by" line must already say Status: done; if not, stop and tell me.

Plan first. Read the ticket, the parts of docs/SPEC.md it relies on, CONTEXT.md, and for engine work .agents/skills/thompson-rules/SKILL.md. Write the plan as the ordered list of tests you will write, each at the Engine seam or the Diagram seam, plus the user-visible result. Wait for my approval.

Then work test-first, one test at a time: write one failing test, run it and see it fail for the right reason, write the least code that passes, repeat. Tests import only the two seam entry points. Expected values come from the fixtures or the oracles. Never edit a fixture or an expected value to make a test pass; if one looks wrong, stop and show me the evidence.

Do only what the ticket asks. Extra ideas go in a "later" list in your final message, not in the code.

If the ticket touches the page, extend the browser smoke test with this ticket's demo path.

Done means: `npm run check` passes (and `npm run e2e` if the page changed); every acceptance criterion is ticked with the test or command output that proves it; the ticket file says Status: done; one commit "ticket NN: <title>". Finish with a short walkthrough: what changed, the command output, anything that surprised you.

If you fail the same thing three times, or a command runs over two minutes, stop and follow "When stuck" in AGENTS.md.
```

## 3. Add-ons: paste under the ticket prompt for that ticket

Each one names the traps that cost time in the research.

**01 Walking skeleton**
```
Specifics for ticket 01:
- Copy package.json, tsconfig, the Vite config and the inline-worker setup from research/toolchain-smoke/. Keep the pinned versions exactly.
- Scripts: check = typecheck + `vitest run` + `vite build`. e2e = Playwright opening dist/index.html over file:// (run `npx playwright install chromium` if the browser is missing).
- Folders: src/engine, src/diagram, src/ui, tests. The renderer port has two adapters: Viz.js and an in-memory fake.
- Viz.js 3.31: `instance()` then `render()`. Reference: research/toolchain-smoke/src/main.ts.
- Build nothing beyond the single-symbol path.
```

**02 Core construction**
```
Specifics for ticket 02:
- Implement the rules table in .agents/skills/thompson-rules/SKILL.md exactly: state ids in creation order (start before accept), transitions logged in the table's order.
- Compare with fixtures/worked-example.json step by step before moving on. That file is the oracle.
- Keep tokenizer, concatenation insertion, shunting-yard and builder internal; export only through the engine entry point.
- No simulator in this ticket. Assert structure on the NFA data.
- Steps store copies, never references into the live NFA.
```

**03 Simulation**
```
Specifics for ticket 03:
- The trace holds the set after the initial closure plus one per symbol. Closure includes the starting set.
- Iterate the input with Array.from (code points, not UTF-16 units).
- Dead run: stop at the symbol that empties the set. A symbol outside the alphabet is an error at its position; a symbol in the alphabet that the expression never uses just empties the set.
- Expected traces are literal in fixtures/worked-example.json.
```

**04 Syntax errors**
```
Specifics for ticket 04:
- fixtures/error-cases.json is the spec. If a case looks wrong, ask; do not edit it.
- Implement the pre-validation as a two-state scan (expecting an operand / expecting an operator) over the tokens, before shunting-yard. Report the first violation, pointing at the offending token.
- Never report the implicit concatenation token. Positions are code-point indices into the original source, whitespace counted.
- Cases that need `+` or textbook notation are enabled by tickets 05 and 06; leave them disabled with a note.
```

**05 Plus, optional, parse views**
```
Specifics for ticket 05:
- Plus and optional are direct constructions from the rules table, not R R* or R|ε.
- `a+?` is (a+)?; `a**` is a star of a star. The parse tree comes from the postfix form and is left-nested for binary operators.
- Enable the error cases that need `+`.
```

**06 Settings**
```
Specifics for ticket 06:
- Merge mode: delete the second fragment's start and move its outgoing transitions to the first fragment's accept. Do not renumber; ids keep gaps. Record the merged pair in the step.
- Textbook notation: `|` is NOT_AN_OPERATOR, not a symbol; `+` is union.
- `@`/`ε` and `#`/`∅` are never alphabet symbols.
- Expected counts: `(a|b)*abb` is 14 states / 16 transitions in ε-link and 11 / 13 in merge; `(a|b)*a` is 10 / 12 and 9 / 11.
```

**07 Stepper**
```
Specifics for ticket 07:
- Each step's snapshot draws every fragment on the stack, not just the newest.
- Mark new elements by colour AND a thicker line AND a text tag.
- Use the SPEC's test ids. Test the DOT text at the Diagram seam, not the SVG.
- Plain `dot` layout is fine now; the next ticket pins positions.
```

**08 Stable layout**
```
Specifics for ticket 08:
- Reference: research/prototype/exp4.mjs. Compute the master layout once with `dot` (left to right) and `renderJSON` on the ε-link final NFA; read node positions from `pos`.
- Per-step render: engine `neato`, each node given `pos="x,y!"` in inches (points ÷ 72). The experiment gave 0.0 drift. The engines `nop` and `nop2` are an untested alternative.
- Measure render time at about 100 tokens and write the numbers in the ticket. Cache per-step SVG if any render exceeds 100 ms.
```

**09 Textbook view and caps**
```
Specifics for ticket 09:
- Collapsed fragments are record-shaped nodes with in and out ports. With left-to-right layout use braces so the box stays horizontal, and escape `|` in labels. See the collapsed-fragment sample in research/prototype/exp4.mjs.
- Put the caps (150 / 400 / 2,000) in one config object. Every message states its limit.
```

**10 Final NFA view**
```
Specifics for ticket 10:
- Compact labels are a display mapping only. Apply the same mapping to the table, the trace and the diagram. Never change engine ids.
```

**11 Oracles and property suite**
```
Specifics for ticket 11:
- Test support only; nothing here ships. Reuse the ideas in research/prototype/oracles.mjs and lib-props.mjs, but write it fresh.
- Wrap every operand in `(?:…)` when translating to RegExp. Run it in a worker with a 2 s cap; a timeout means skipped.
- The default fast-check generator is tiny (median 3 nodes). Tune it and assert the distribution.
- Keep the suite under 60 s. Print the seed and the shrunk source on failure.
```

**12 Mutation gate**
```
Specifics for ticket 12:
- The 13 mutants are the table in section 9 of .agents/skills/thompson-rules/SKILL.md.
- Try StrykerJS once. If it does not run on the pinned toolchain, stop debugging it and write a harness where each mutant is an exact find/replace applied to a temporary copy of src/engine.
- Never weaken a mutant to get it killed; strengthen the tests. Report the first failing test for each mutant.
```

**13 Validation panel**
```
Specifics for ticket 13:
- Built-in suite expected values are hand-written literals, not output of the NFA.
- Differential k: the largest k ≤ 8 with at most 50,000 strings in total (floor 3). Show the k.
- RegExp oracle in a capped worker; show "skipped (timeout)". The UI must not freeze.
```

**14 Stress panel**
```
Specifics for ticket 14:
- Families: `(a*)*b` on aⁿ and `(a+)+` on aⁿb. Not `(a?)ⁿaⁿ`: it is not exponential in V8.
- RegExp in an inline worker; terminate on timeout (8 s). Stop the series at the first timeout.
- The chart is inline SVG, no library.
```

**15 Packaging and polish**
```
Specifics for ticket 15:
- Work from a clean clone. Perform the evaluator walkthrough in a real browser and paste what you saw.
- Check Firefox by hand and record the result. Do not claim Safari.
```

## 4. Order and parallelism

Max two agents at a time, each on its own branch or worktree. Merge one at a time, rebase the other, rerun `npm run check`.

| Wave | Tickets | Why |
| --- | --- | --- |
| 1 | 01 | creates the toolchain; nothing else can start |
| 2 | 02 | the core everything builds on |
| 3 | 03 ∥ 04 | simulation and errors touch different engine areas (merge 03 first) |
| 4 | 05, then 06 | both change tokenizer, parser and builder: keep serial |
| 5 | 07 | needs merge mode |
| 6 | 08 ∥ 11 | layout versus test support |
| 7 | 09 ∥ 12 | diagram versus mutation harness |
| 8 | 10 ∥ 14 | final view versus stress panel |
| 9 | 13 | validation panel |
| 10 | 15 | packaging and polish |

## 5. When stuck

**S1 Generic**
```
Stop making changes. Write: (1) the goal of this step, (2) every approach you tried, numbered, with the exact error each produced, (3) your two most likely explanations. Then run ONE read-only diagnostic that tells them apart (print a value, run a single test, inspect a file) and show me the output. Only then propose a fix, and say which explanation it relies on.
```

**S2 The same test keeps failing**
```
This test has failed three times. Do not edit the test or any fixture yet. Re-read the acceptance criterion it encodes and the relevant section of the rules skill. Say which is wrong: the test, the code, or your reading of the rule. Prove it with a minimal reproduction: one input, expected versus actual, worked by hand from the rules table. Then fix exactly that.
```

**S3 Toolchain or config error**
```
Compare this project's package.json and configs with research/toolchain-smoke/, which was run end to end with the pinned versions. Do not upgrade, downgrade or swap any package, and do not write config from memory: these tools are newer than your training data. List every difference, revert each to the smoke project's version unless the ticket needs it, and rerun. If the error persists, paste the full message and stop.
```

**S4 Viz.js or Graphviz trouble**
```
You are using the Viz.js 3.31 API: `instance()`, then `render()` (returns errors) or `renderString()` (throws). `renderSVGElement` needs a DOM, so never call it in Node tests. The browser global is dist/viz-global.js. Use research/toolchain-smoke/src/main.ts and research/prototype/exp4.mjs as working references. Test DOT text at the Diagram seam; call Viz only in the adapter test and in the browser.
```

**S5 Worker or file:// problem**
```
A worker loaded from a separate file throws SecurityError from file://. Import workers inline (`?worker&inline`) so they become Blob workers; research/toolchain-smoke shows it working. Do not add a dev server, a CDN or a fetch to work around this.
```

**S6 A property test failed**
```
Take the shrunk counterexample and the seed that fast-check printed. First decide whether the expression is valid input. Then work out the expected answer by hand, from the rules table, for the shortest failing string. Compare the NFA, the enumerator, the derivative matcher and the wrapped RegExp on that one string: the odd one out is the bug. Replay with the printed seed and path before changing any code. After the fix, add the counterexample as a fixed example test.
```

**S7 Scope creep**
```
Revert anything the ticket's acceptance criteria do not require: added dependencies, frameworks, abstractions, options and files that no test or criterion needs. Put the ideas in a "later" list in your final message. Then rerun npm run check.
```

**S8 The ticket is too big**
```
This ticket does not fit in one context. Propose a split into two or three smaller tickets, each demoable and independently testable, with blocking edges. Do not start coding. I will approve the split and you will write them as ticket files.
```

**S9 Ambiguity**
```
Stop. State the ambiguity in one sentence. Quote the two lines that conflict, or name the missing rule. List at most three options with their consequences and your recommendation. Do not choose silently, and do not change docs/SPEC.md or a fixture.
```

**S10 A command hangs**
```
Cancel the running command. It is probably a watch or dev server. Use `vitest run` and `vite build`. For the browser test, open dist/index.html over file://; no server is needed. Rerun with a two-minute timeout.
```

**S11 "Done" without proof**
```
Verify instead of asserting. Run `npm run check` and show the full output. For each acceptance criterion name the test or command output that proves it, or say "unproven". Open the built file over file:// and show the real result of this ticket's demo path. Fix everything unproven before calling the ticket done.
```

**S12 A test reaches past a seam**
```
This test imports something other than the two seam entry points. Rewrite it to go through the seam and assert only what a user or the page could observe. If that is impossible, tell me which behaviour is missing from the data the seam returns.
```

**S13 Merge conflict between parallel agents**
```
Resolve the conflict by keeping both branches' tests and behaviour. Do not discard either side's tests. Rerun npm run check and the browser smoke test. If two changes disagree about behaviour, stop and show me both, with the ticket criteria each satisfies.
```

## 6. Review prompts

**R1 Per-ticket review (fresh conversation, after the ticket is done)**
```
You are reviewing ticket NN with no knowledge of how it was built. Do not change code. Read the ticket, the parts of docs/SPEC.md it cites, and the diff of its branch against main.
Report: (a) each acceptance criterion as met, not met or unproven, with evidence; (b) any test that reaches past the two seams; (c) any behaviour that is not in the ticket; (d) any gotcha from AGENTS.md that was ignored; (e) the three riskiest places for a hidden bug, with one test that would expose each. End with a verdict: merge, or fix first with the list.
```

**R2 Milestone check (after tickets 07, 10, 13, 15)**
```
Open the built dist/index.html over file:// in a browser. Walk SPEC user stories N to M one by one (07: 9–17, 10: 19–25, 13: 26–29, 15: all). For each, say pass, fail or not built, and what you saw. Do not change code. List the failures as candidate tickets.
```

**R3 Final acceptance rehearsal**
```
Act as the evaluator. Open dist/index.html over file:// with the network off.
1. Type (a|b)*a and Build. Expect 10 states and 12 transitions.
2. Step to the end. Expect "step 6 / 6", and the picture never moves between steps.
3. Run "ba". Expect ACCEPT, initial set {0,2,4,6,7,8}, then {0,2,3,4,5,7,8}, then {0,1,2,4,5,7,8,9}.
4. Switch concatenation to merge. Expect 9 states and 11 transitions.
5. Type (a|). Expect an error at position 2.
6. Run the built-in suite: every row passes. Run a differential test on (a|b)*abb: no mismatch, and the k used is shown.
7. Run the stress test: the backtracking time grows steeply with n and the NFA time stays small.
8. Repeat steps 1 to 3 using the keyboard alone.
Report each step as pass or fail with what you saw. Do not change code.
```

## 7. Pausing and resuming

**H1 Handoff (end of a session that is not finished)**
```
Stop coding. Append a "Progress notes" section to the ticket file: what is done (with test names), what is failing (exact output), what you tried that did not work, the next step, and the commands to resume. Commit it on the ticket branch.
```

**H2 Resume (new conversation)**
```
Resume ticket NN. Read the ticket file including its Progress notes, AGENTS.md, and the failing output. Run npm run check and show me the result before changing anything. Then continue test-first.
```
