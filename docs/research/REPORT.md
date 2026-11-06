# Research report: building the RE → NFA (Thompson) simulator

3 Nov 2026 · for the "full simulator build" · companion to `docs/SPEC.md`

## 1. Summary

The M1 design is sound. Its hand-solved example reproduces exactly, its invariants and size formulas hold on thousands of random expressions, and its algorithm choices are the standard ones. Research turned up **seven things to change before building**, one of which would have made a planned test meaningless:

1. **The stress test pattern is wrong for browsers.** Cox's `(a?)ⁿaⁿ` on `aⁿ` stays flat in V8 (under 1 ms at n = 30). `(a*)*b` on `aⁿ` takes 4.9 s at n = 26 and does not finish in 6 s at n = 28. Use that instead.
2. **Error messages are accidental.** The M1 pipeline accepts and rejects exactly the same inputs as an independent parser (0 disagreements in 2.16 million inputs), but for many invalid inputs it names a different error and points at a synthetic token or no position at all. Specify the error table.
3. **Validation needs three oracles, and invariants alone are not enough.** In a mutation test, structural invariants caught 1 of 13 deliberately broken builders. The language oracle caught 12; one mutant that only changes associativity is caught only by a parse-tree check.
4. **Pasting user syntax into `RegExp` is unsafe.** 27% of random expressions are SyntaxErrors there and `a+?` silently changes language. A wrapping translator was wrong on 0 of 4,999. One random expression still ran past 2 s, so the oracle needs a capped worker.
5. **Diagrams jump between steps unless positions are pinned.** Re-running Graphviz per step drifted up to 574 points on a 14-state NFA; pinning positions from one master layout gave 0.0 at every step.
6. **Offline delivery needs inline workers.** A plain worker file throws `SecurityError` from `file://`; an inline Blob worker works. The single-file build (Viz.js WebAssembly included) is 1.36 MB.
7. **The step record is missing fields** (the merged pair in merge mode, the stack of fragments) that the UI needs.

Everything needed to start is in the seed: spec, rules with fixtures, thirteen-mutant checklist, verified toolchain pins, agent rules for Antigravity.

## 2. Method and evidence labels

I wrote a throwaway prototype that follows M1's pseudocode A1–A4 literally (`research/prototype/`), then used it to test M1's claims. Labels used below: **[computed]** run here, raw output in `docs/research/evidence/`; **[cited]** from a source I read (section 7); **[unverified]** not checked, or only a hypothesis. Environment: Node 22.22.2 (V8 12.4), Graphviz 16.1.0 (inside Viz.js 3.31.0), headless Chromium via Playwright 1.56.0. Timings vary a little run to run; the saved files are the record.

## 3. Findings by question

**Q1. Is the construction as specified correct and consistent with the literature?**
- [computed] All 35 literal checks of the M1 §4.5 example pass: postfix, 10 states and 12 transitions, every step's new transitions and fragment, the full transition table, S₀ = {0,2,4,6,7,8}, four traces, merge mode giving 9 and 11 (evidence 01). `(a|b)*abb` gives 14 states with ε-links and 11 with merging. The size formula, invariants I1–I4 and step-log replay held on 4,000 random expressions in both modes (03).
- [cited] Bille's version adds a new start and accept state for concatenation as well (so his bound is 2m states, 4m transitions); M1's is smaller, with no new states per concatenation. Both satisfy "at most 2m states and 4m transitions". Dragon-book style lecture notes merge the accepting and start states at concatenation; M1's `merge` option is that variant and gives the classic 11-state figure.
- [unverified] Which convention your course uses (M1's own next step 3).

**Q2. Will the planned parser give good errors?**
- [computed] Exhaustive plus random fuzz of 1,411,110 standard-notation and 747,870 textbook-notation inputs: 0 validity disagreements with a recursive-descent parser, 0 parse-tree disagreements on valid inputs, 0 crashes (02).
- [computed] On invalid inputs the error code differs in 72% (standard) and 67% (textbook) of cases and the position in 50% and 48%. Part of that is legitimate ambiguity in my comparison parser, which is exactly the point: nothing in M1 says which answer is right. Examples (01): `()` and the empty string give `INVALID_EXPRESSION` with no position; `a(|b)c` is blamed on position 1 (the implicit concatenation before `(`) when the culprit is the `|` at position 2; in `a|*b` the dangling `*` is blamed on `|`.
- Consequence: add a pre-validation pass with a specified taxonomy (rules skill §6, golden cases in `fixtures/error-cases.json`). The shunting-yard path stays because the postfix form is part of the teaching.

**Q3. How should the output be validated, and can the validation fail?**
- [computed] Three oracles that never build an NFA (bounded-language enumerator, Brzozowski derivatives, wrapped RegExp) agree with each other on 2,500 random expressions × 127 strings (03).
- [computed] Thirteen deliberately broken versions (star without back edge, union missing an exit, merge that forgets to move transitions, right-associative parsing, a simulator with no initial closure, and so on). All 13 were killed, each within 19 property runs. By layer: invariants + size + replay caught 1; the language oracle caught 12; the parse-tree check caught 2, including the only one nothing else sees (`assoc-right`, same language) (04).
- [computed] fast-check's default generator is tiny: median 3 nodes for both `depthSize: 'small'` and `'large'` (90th percentile 8 and 22). The mutants were easy enough to die anyway; subtler bugs would need bigger expressions, so the spec asks for a tuned generator and a distribution test.
- Counterexamples shrink well (`#`, `a*`), which is what makes them pasteable into the app.

**Q4. Is the planned stress test valid, and what are the RegExp traps?**
- [computed] In V8 12.4 `(a?)ⁿaⁿ` on `aⁿ` is flat: 0.2 ms at n = 12, under 1 ms at n = 30. [unverified] I suspect V8's minimum-length pruning, but did not confirm the mechanism. Exponential families do exist: `(a*)*b` on `aⁿ` (0.3 ms at n = 12, 72 ms at 20, 4.9 s at 26, over 6 s at 28); `(a+)+` on `aⁿb` (3.0 s at 26); `(a|aa)+` on `aⁿb` grows about 1.6× per extra character (125 ms at 30). The same NFA runs a length-1000 string in 0.6 to 9 ms (05b).
- [computed] NFA simulation grows roughly quadratically in n for `(a?)ⁿaⁿ` (4.3 ms at n = 100, 342 ms at n = 800), as the O(nm) bound predicts (05a).
- [computed] Pasting syntax into `RegExp`: of nine stacked postfix pairs, six are SyntaxErrors, `a*?` and `a??` are lazy but accept the same language, and `a+?` silently changes the language (a+ instead of a\*) (05c). On 1,500 random expressions the naive paste was a SyntaxError 27.1% of the time and a different language 1.4% of the time; the wrapping translator was wrong on 0 of 4,999 (05a, 05b).
- [computed] 1 of 5,000 random expressions (`((a|a)?|(#|a*)+)+++`, 13 nodes) ran past 2 s on strings of length ≤ 6. A hung oracle must not be reported as a failure.

**Q5. Can Viz.js deliver the diagrams, with stable layout, at the needed sizes?**
- [cited] Viz.js 3 exposes `instance()`, then `render`, `renderString`, `renderSVGElement`, `renderJSON`. [computed] The current package is 3.31.0 with Graphviz 16.1.0; the browser global build is `dist/viz-global.js` (M1 assumed a "UMD" build; older material calls it `viz-standalone.js`). `instance()` takes about 30 ms. `renderString` throws on bad DOT; `render` returns `status: failure` with messages (06).
- [computed] Everything the design needs works: `id` attributes survive into the SVG for nodes and edges; ε labels; dashed edges; double-circle accept state; record-shaped boxes with ports (the textbook view); clusters; `renderJSON` returns node positions (06).
- [computed] Layout stability: plain `dot` per step drifts up to 574 points from the final layout; `neato` with positions pinned from one master layout drifts 0.0 at all 10 steps of `(a|b)*abb` (06). The engine list also contains `nop` and `nop2` (no layout, positions as given), which may be simpler; untested. Per-step pinned timing at scale is [unverified].
- [computed] Render time (dot, median of 5): 49 ms for 219 postfix tokens (280 states, 232 KB SVG), 147 ms for 549, 516 ms for 1,099 (1.2 MB). The practical limit is legibility and SVG weight, not speed, hence the stepping caps.

**Q6. Can it ship as one offline page, and with what toolchain?**
- [computed] A smoke project with TypeScript 7.0.2 (`tsc` exit 0), Vitest 5.1.0 (3 tests, including `@fast-check/vitest` and Viz.js under Node), Vite 8.3.5 and `vite-plugin-singlefile` 2.3.4 builds a single 1.36 MB file. Opened from `file://` in headless Chromium it rendered an SVG through the WebAssembly and ran an inline worker, with no console errors, ready in 258 ms. A plain worker file threw `SecurityError` (07, 00).
- [unverified] Firefox, Safari, and Playwright versions newer than 1.56.

**Q7. What exists already, and is the gap real?**
- [cited] JFLAP uses `+` for union and `!` for the empty string, and its guided conversion also offers automatic Do Step and Do All, so M1's "the user adds ε-transitions by hand" is incomplete. There are two Virtual Labs implementations (IIIT Hyderabad's, which M1 cites, and an Amrita one that builds the expression from a click panel). A student project, RegExtoNFA, shows a parse tree, automaton statistics and a step-by-step simulation with highlighting.
- I found no tool that combines per-token construction, ε-closure state sets, invariant checks and differential testing, but that is absence of evidence, not proof. Phrase the gap as "I did not find one", and do not rest the project on novelty. [unverified] Hands-on checks of any of these tools.

**Q8. What changes because Antigravity will build it?**
- [cited] Google's own codelab documents workspace rules in `.agents/rules/`, workflows in `.agents/workflows/` (run as slash commands) and skills in `.agents/skills/` (a `SKILL.md` with name and description, loaded on demand), plus plan, task-list and walkthrough artifacts, review and terminal-execution policies, and slash commands such as `/goal` and `/grill-me`. Antigravity 2.0 (19 May 2026) runs several agents in parallel. Third-party guides say `AGENTS.md` has been read natively since March 2026 builds (v1.20.x), and disagree on the exact version and on precedence against `GEMINI.md`.
- Consequences for the seed: a short `AGENTS.md` (always loaded) carries only what cannot be found by reading the code; bulky rules sit in a skill so they load when needed; tickets form a dependency graph so independent ones can go to parallel agents; every ticket ends in a command that either passes or fails (`npm run check`, `npm run e2e`) instead of an agent's opinion.
- [unverified] Your Antigravity version, whether it lists `AGENTS.md` in its rules panel, and whether its browser agent is available. The Playwright smoke test is the deterministic fallback.

## 4. Design review of the M1 document

| # | Where | Finding | Severity |
| --- | --- | --- | --- |
| 1 | §4.6 V4, §2.3 | `(a?)ⁿaⁿ` is not exponential in V8, so the stress test would show no contrast. Use `(a*)*b` and `(a+)+` (05b). | High |
| 2 | §4.2 A1–A3, §3.4 | Validity is right but error codes and positions are accidental; empty input and `()` have no position (02, 01). | Medium |
| 3 | §3.3 Step, A3 | Step lacks the merged pair and the stack snapshot; merge-mode rewiring changes transitions already logged unless copies are stored (design hazard; the prototype stores copies and replay passes). | Medium |
| 4 | §4.6 V3 | "Stacked quantifiers are errors or lazy" is only partly true: six of nine pairs error, two are harmless, `a+?` changes the language (05c). Say so precisely. | Medium |
| 5 | §4.6 V4 | The in-app JavaScript oracle must run in a capped worker; 1 in 5,000 random expressions exceeded 2 s (05b). | Medium |
| 6 | §3.1, §3.5 | Step diagrams jump unless positions are pinned (06). | Medium |
| 7 | §2.1 | Tool-limit claims need softening: JFLAP has Do Step/Do All; a second Virtual Labs lab and RegExtoNFA exist (cited). | Medium |
| 8 | §2.3 | "UMD build from a plain script tag" is outdated; the package ships `dist/viz-global.js`. `renderString` throws; use `render` (06). | Low |
| 9 | §2.2 item 5 | Zero-install from a file needs inline workers (07). | Low |
| 10 | §1.4 | Bille's construction adds start and accept states per concatenation; M1's is smaller. Same bounds (cited). | Low |
| 11 | §4.6 V5 | Test generator is tiny by default; add a size-distribution test (03, 04). | Low |

**What looks good.** The fragment invariants I1–I4; the size formulas (exact, now also given for transitions); the hand-solved example; the three-layer validation plan; the pure-engine architecture; the complexity analysis (O(nm) time matches the measured quadratic growth); the explicit scope boundaries.

**Verdict: approve with changes** (items 1–6 before building; 7–11 are wording and housekeeping).

## 5. Alternatives considered

| Question | Options | Choice and why |
| --- | --- | --- |
| Diagram engine | Viz.js (Graphviz WebAssembly); d3-graphviz (animated transitions, also Graphviz); ELK.js; a custom compositional layout (Thompson fragments are series-parallel, so one is possible) | **Viz.js.** Every feature needed was verified, it inlines into one file, and pinning fixes jumping. d3-graphviz and ELK were not tested. The custom layout is a possible stretch and a hypothesis, not a finding. |
| Parser | Shunting-yard only; recursive descent only; shunting-yard + pre-validation, recursive descent as test oracle | **The third.** Postfix is taught content; two independent front-ends give a free differential test; specified errors come from the pre-validation pass. |
| Oracles | RegExp only; add derivatives; add the bounded-language enumerator | **All three.** The enumerator is the semantics of M1 §1.4 run literally and cannot be wrong in the same way as the others. |
| UI | React or Vue; plain TypeScript | **Plain TypeScript.** The UI holds no algorithm, so a framework buys little and adds moving parts for an agent to get wrong. Revisit if a ticket needs it. |
| Delivery | Hosted single-page app; one offline HTML file | **One file**, which can also be hosted unchanged. |
| Per-step drawing | Re-layout each step; pinned layout; custom | **Pinned layout** (measured). |

## 6. Risks and what is not verified

- Pinned per-step rendering has not been timed on large graphs; the stable-layout ticket must measure it and cache.
- Only Chromium was exercised. Firefox and Safari are open.
- RegExp timings are V8's; other engines differ, so the stress panel measures the user's own browser.
- TypeScript 7 is new; I tested `tsc`, Vite and Vitest only, not linters or other plugins.
- JFLAP, Virtual Labs and RegExtoNFA were read about, not used.
- Antigravity behaviour on your version is unverified (Q8).
- The prototype and the seed's fixtures come from the same code that passed M1's literal numbers; the independent checks are the M1 literals, the three oracles and the second parser, not the prototype itself.

## 7. Sources

- P. Bille, "New Algorithms for Regular Expression Matching", ICALP 2006: https://www.arxiv.org/pdf/cs/0606116
- R. Cox, "Regular Expression Matching Can Be Simple And Fast": https://swtch.com/~rsc/regexp/regexp1.html
- T. Mogensen, comp.compilers, 2004 (invariants and merging): https://compilers.iecc.com/comparch/article/04-04-071
- Dragon-book style merge at concatenation: https://cs2.uco.edu/~trt/cs4173/L007.pdf and https://gamedev.net/tutorials/programming/general-and-gameplay-programming/algorithmic-forays-part-4-r2106
- Viz.js API and 2.x→3.x differences: https://viz-js.com/api/ and https://www.github.com/mdaines/viz-js/wiki/Differences-between-Viz.js-2.x-and-3.x
- fast-check recursive structures: https://fast-check.dev/docs/core-blocks/arbitraries/combiners/recursive-structure/
- JFLAP guide (University of Split): https://mapmf.pmfst.unist.hr/~milica/Matem_teorija_r/MTR_web/JFLAPupute.pdf ; UMN lab: https://personal.morris.umn.edu/~elenam/3501fall2014/psets/lab9.html
- Virtual Labs: https://afl1-iiith.vlabs.ac.in/exp/re-to-nfa/ and https://fla-amrt.vlabs.ac.in/exp/convert-re-to-nfa/
- RegExtoNFA: https://github.com/lrreverence/RegExtoNFA
- Google Codelab, "Getting Started with Antigravity IDE": https://codelabs.developers.google.com/getting-started-agy-ide
- Antigravity 2.0 and CLI: https://en.wikipedia.org/wiki/Google_Antigravity
- AGENTS.md support (third-party): https://thepromptshelf.dev/blog/google-antigravity-agents-md-rules-guide-2026 and https://agentpedia.codes/blog/antigravity-agents-md-guide
