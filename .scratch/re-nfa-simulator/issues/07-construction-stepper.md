# 07: Construction stepper

**What to build:** A student steps through the construction one postfix token at a time. Every fragment on the stack is drawn and what the step created is highlighted.

**Blocked by:** 02: Core construction; 06: Settings

**Status:** ready-for-agent

- [ ] Prev, Next, Play and Pause with adjustable speed, first and last, and the arrow keys work. `step-counter` reads `step k / n`. `step-log` lists each step with its rule in words, for example `union of fragments 0→1 and 2→3`.
- [ ] The Diagram seam draws any step's snapshot: all fragments on the stack, with the step's new states and transitions marked by colour, a thicker line and a text tag. ε-edges are dashed, the start has an arrow, the accept state is a double circle. Tests assert on the DOT.
- [ ] Clicking a postfix token jumps to its step. Hovering a state shows the step that created it.
- [ ] In merge mode the merging step shows both states and what they became.
- [ ] Plain Graphviz layout is acceptable here; stability is ticket 08.
- [ ] The browser smoke steps `(a|b)*a` to `step 6 / 6`.
