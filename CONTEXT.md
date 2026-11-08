# Context: RE → NFA (Thompson) Simulator

Words used in the spec, tickets, tests and code. Use these terms; avoid the ones listed under "Avoid".

**Source** The regular expression exactly as typed. Positions are code-point indices into it. _Avoid:_ pattern, regex string.

**Notation** How `+` and `|` are read. *Standard*: `|` is union, `+` is one-or-more. *Textbook*: `+` is union, one-or-more is unavailable, `|` is an error.

**Token** One classified unit of the source (symbol, ε, ∅, parenthesis, union, concatenation, star, plus, optional). The implicit concatenation token is inserted by the normaliser.

**Postfix** The tokens in postfix order, produced by shunting-yard. The Thompson builder scans it.

**Parse tree** The tree of the expression, shown next to the construction. Built from the postfix form.

**Fragment** A partly built automaton with exactly one start and one accept state. Atoms make fragments; operators combine them.

**Stack** The fragments the builder is holding. After a step it can hold more than one; the canvas draws all of them. _Avoid:_ pending list.

**Step** One postfix token's effect: the rule applied, states and transitions created, the merged pair (merge mode), the fragment produced, and the stack afterwards. There is one step per token.

**ε-NFA** The finished automaton: states, alphabet, transitions (symbol or ε), one start, one accept. ε is a dedicated constant, never a character.

**Construction mode** How concatenation joins fragments. *ε-link* adds one ε-transition (default). *Merge* identifies the first fragment's accept state with the second's start state. State ids keep gaps in merge mode.

**State id** The creation-order number of a state. Stable for the whole build; never renumbered by the engine. *Compact labels* are a display-only relabelling of the final NFA.

**Invariants (I1–I4)** The four structural properties every fragment keeps (see the rules skill). Checked after every build.

**ε-closure** All states reachable from a set by ε-moves, including the set itself.

**Active set** The set of states the simulator could be in after reading some prefix, after ε-closure.

**Trace** The active set after the initial closure and after each input symbol, plus the verdict. A run is *dead* when the active set becomes empty.

**Alphabet** The symbols that appear in the source, plus any the user adds. A symbol outside it is an error when simulating.

**Oracle** An independent way to decide whether a string is in the language, used to check the NFA: the bounded-language enumerator, Brzozowski derivatives, or the browser's RegExp through the wrapping translator. A RegExp timeout means *skipped*, never *failed*.

**Engine seam / Diagram seam** The two places tests are written. Engine: analyze, run, validate. Diagram: data → DOT text. Nothing else is tested directly.

**Master layout** Node positions computed once per build by Graphviz `dot` on the ε-link final NFA, then used to pin every per-step render so the picture does not jump.

**Flat view / Textbook view** Flat draws every state. Textbook draws finished sub-automata as labelled boxes and expands only the newest operator.

**Final view** Displays the complete finished NFA. Run switches the view to Final; stepper buttons in Final view return to flat.

**Canvas viewport** The transformable layer (`#canvas-viewport`) hosted inside the fixed diagram container (`#canvas`). Rendered SVG elements sit inside the viewport, allowing CSS transform-based zoom and pan without re-rendering Graphviz diagrams or altering SVG coordinate definitions.

**Viewport mode** The layout positioning mode indicated by `data-viewport-mode`: *fit* (diagram fits inside canvas frame), *start* (anchored at start state at 1.0x scale when fit zoom is below legible threshold 0.5), or *manual* (user interacted via zoom/pan controls).

**Mutant** A deliberately broken copy of a rule used to prove the tests can fail. The suite must kill all thirteen listed in the rules skill.

**Test hooks** State and completion flags (`window.__*`) used by Playwright E2E tests for observation and fault injection. Injected strictly harness-side via `page.addInitScript()`; never present in `dist/index.html`.

