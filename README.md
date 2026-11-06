# RE → NFA (Thompson) Simulator: build seed

Everything an agent needs to build the full simulator test-first, plus the research behind it. Written 3 Nov 2026 for building with Antigravity.

```
AGENTS.md                         always-on rules (short)
PROMPTS.md                        the prompts to paste into Antigravity, step by step
CONTEXT.md                        vocabulary
docs/SPEC.md                      what to build (user stories, decisions, testing, scope)
docs/adr/                         three decision records
docs/research/REPORT.md           research findings, design review of the M1 document, alternatives
docs/research/evidence/           raw output of every experiment the report quotes
.agents/skills/thompson-rules/    canonical rules, fixtures (JSON), mutation checklist
.agents/workflows/next-ticket.md  /next-ticket: take the next ready ticket, work it test-first
.scratch/re-nfa-simulator/issues/ the 15 tickets, one file each, with blocking edges
research/prototype/               throwaway prototype and experiments (reference only)
research/toolchain-smoke/         the verified Vite + Vitest + Viz.js single-file setup
```

Start with `PROMPTS.md`.

## Starting in Antigravity

1. Open this folder as the workspace. Check the rules panel lists `AGENTS.md`. If it does not, copy it to `.agents/rules/00-project.md`.
2. Let the terminal policy run `npm` and `npx` without prompting, so `npm run check` is a real gate.
3. Run the first ticket on its own: it creates the toolchain. After that, give independent unblocked tickets to separate agents. Each ticket ends with `npm run check` passing.
4. Ask for the walkthrough with the test output at the end of every ticket.

## What is verified and what is not

Verified here (see the report): the M1 hand-solved example, the invariants and size formulas, the oracles, the mutation checklist, Viz.js 3.31.0 features and layout pinning, the single-file build from `file://` in headless Chromium, and the toolchain versions together.

Not verified: Firefox and Safari; pinned per-step rendering on large graphs; how your Antigravity version treats `AGENTS.md` (the official codelab documents `.agents/rules`, workflows and skills; native `AGENTS.md` support comes from third-party sources).

## Reproducing the experiments

```
cd research/prototype && npm install && node exp1.mjs      # M1 literals and error cases
node exp2b.mjs && node exp2c.mjs                           # properties, mutation matrix
node exp3a-stacked.mjs && node exp3b.mjs && node exp3c.mjs # RegExp pitfalls, stress families
node exp4.mjs                                              # Viz.js
```
Needs Node 22. Timings differ by machine; the saved outputs are in `docs/research/evidence/`.
