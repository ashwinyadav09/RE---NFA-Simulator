# 08: Stable layout across steps

**What to build:** The diagram does not move between steps: new elements appear in place and existing ones stay where they are.

**Blocked by:** 07: Construction stepper

**Status:** ready-for-agent

- [ ] One master layout is computed per build on the ε-link final NFA, and every per-step render pins those positions. For the fixture expressions the drift between consecutive steps is zero (within 0.5 point) in both construction modes, checked through the real Viz.js adapter in a test.
- [ ] In merge mode the merged state appears at the surviving state's position.
- [ ] Per-step render time is measured on an expression of about 100 tokens and reported in the ticket. If any render exceeds 100 ms, the rendered SVG is cached per step.
- [ ] If layout fails, the page falls back to unpinned rendering with a visible note rather than a blank canvas.
- [ ] A Diagram seam test shows that pinned positions appear in the DOT when they are given.
