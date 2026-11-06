# 08: Stable layout across steps

**What to build:** The diagram does not move between steps: new elements appear in place and existing ones stay where they are.

**Blocked by:** 07: Construction stepper

**Status:** done

- [x] One master layout is computed per build on the ε-link final NFA, and every per-step render pins those positions. For the fixture expressions the drift between consecutive steps is zero (within 0.5 point) in both construction modes, checked through the real Viz.js adapter in a test. (`tests/diagram.test.ts` `[T08-3]`, `[T08-4]`, `tests/e2e.cjs`)
- [x] In merge mode the merged state appears at the surviving state's position. (`tests/diagram.test.ts` `[T08-5]`, `tests/e2e.cjs`)
- [x] Per-step render time is measured on an expression of about 100 tokens and reported in the ticket. If any render exceeds 100 ms, the rendered SVG is cached per step. Measured on `((a|b)*abb)` x 10 (109 postfix tokens, 140 states): master layout 76.1 ms; per-step render min 0.67 ms, median 12.39 ms, mean 181.08 ms, max 1354.90 ms; 30 steps exceeded 100 ms; rendered SVG is cached per step. (`src/ui/main.ts`)
- [x] If layout fails, the page falls back to unpinned rendering with a visible note rather than a blank canvas. (`tests/diagram.test.ts` `[T08-6]`, `tests/e2e.cjs`)
- [x] A Diagram seam test shows that pinned positions appear in the DOT when they are given. (`tests/diagram.test.ts` `[T08-1]`)

