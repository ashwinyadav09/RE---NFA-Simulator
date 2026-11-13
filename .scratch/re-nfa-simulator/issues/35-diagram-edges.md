# 35: Transition arrows and edge labels match Stitch design

**What to build:** Align transition arrows and edge labels with the Stitch reference design (docs/design.md §5, §8). Configure Graphviz DOT parameters (`ranksep=0.55;`, `nodesep=0.45;`, `edge [arrowsize=0.85]`, `node [penwidth=1.5]`, `bgcolor="transparent"`) and SVG post-processing (`postProcessDiagramSvg`). Ensure ε-edges are dashed with pattern `4,3`, edge labels have background pills (`fill="var(--bg-canvas, #ffffff)"`) so crossing lines don't strike through text, and pills never obscure or touch arrowheads on symbol or ε edges. Generate before/after screenshots for `a`, `a|b`, `(a|b)*a`, `(a|b)*abb`, and `a*b`.

**Blocked by:** 34: Final NFA state labels, start is always q0, then q1, q2...

**Status:** done

- [x] AC1: DOT generator `toDot` outputs clean preamble matching Stitch (`ranksep=0.55;`, `nodesep=0.45;`, `edge [fontname="Helvetica", arrowsize=0.85];`, `node [shape=circle, fontname="Helvetica", penwidth=1.5];`, `bgcolor="transparent";`).
- [x] AC2: Pure SVG post-processing `postProcessDiagramSvg(svg: string): string` wraps edge labels in rounded `<rect class="edge-label-pill">` pills with `fill="var(--bg-canvas, #ffffff)"`.
- [x] AC3: Edge label pills never cover or overlap arrowhead polygons; clearance $\ge 3.5\text{px}$ maintained between pill boundaries and arrowhead polygons.
- [x] AC4: Epsilon edge paths standardized to `stroke-dasharray="4,3"`.
- [x] AC5: Graphviz white background polygon sanitized to transparent.
- [x] AC6: Unit tests in `tests/diagram.test.ts` verifying pill generation, arrowhead clearance, and dash formatting.
- [x] AC7: Before/after screenshots generated for `a`, `a|b`, `(a|b)*a`, `(a|b)*abb`, and `a*b`.
- [x] AC8: Mutants defined and killed in `tests/ui-mutants.cjs`.

