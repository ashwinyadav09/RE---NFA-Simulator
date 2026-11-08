# 0005 Canvas zoom and pan via CSS transform

Status: accepted, Nov 2026

## Context
Thompson NFA diagrams grow rapidly with expression complexity. For example, a 161-postfix-token regular expression produces an automaton over 15,000 points wide (~20,200 rendered CSS pixels). Without zoom and pan, large diagrams overflow the browser viewport and force document-level horizontal scrolling, while small sub-automata cannot be closely inspected during step-by-step construction.

Client-side viewport control is required to zoom and pan diagrams smoothly. Three implementation options were evaluated:
1. CSS 2D transform on a persistent `#canvas-viewport` container inside `#canvas`.
2. SVG `viewBox` attribute manipulation on rendered `<svg>` elements.
3. Vendoring an existing client-side library such as `svg-pan-zoom`.

Furthermore, Graphviz renders diagrams at substantial compute cost (~55-63 ms per render). Zoom and pan operations must never re-run Graphviz.

## Decision
- We use **Option 1**: A persistent `#canvas-viewport` element inside `#canvas` with CSS 2D transform (`transform: translate(Xpx, Ypx) scale(S); transform-origin: 0 0;`).
- `#canvas` acts as the framing viewport with `position: relative`, `overflow: hidden`, and `height: var(--canvas-height)` (held in custom property `clamp(360px, 60vh, 640px)`).
- We do **not** set `will-change: transform`, preventing Chromium from freezing bitmap rasterization and blurring text at high zoom levels.
- Viewport mathematics are encapsulated in a pure, DOM-free module (`src/ui/viewport.ts`) covered by fast unit tests.
- Viewport state is reflected on DOM attributes on `#canvas` (`data-zoom`, `data-pan-x`, `data-pan-y`, `data-viewport-mode`) conforming to ADR 0004 without adding any new `window.*` globals.

### Alternatives Considered & Rejected
- **Option 2 (SVG `viewBox` manipulation)**: Rejected. Graphviz outputs inline SVGs with explicit point dimensions (e.g. `width="15151pt" height="134pt"`). Merely modifying `viewBox` without invasive width/height string rewriting fails to prevent container overflow in the browser. In addition, user space coordinate translation (converting mouse deltas in screen pixels to SVG points across dynamic aspect ratios) adds unnecessary complexity, and the transform would have to be re-computed on every step replacement.
- **Option 3 (`svg-pan-zoom` library)**: Rejected. Minified `svg-pan-zoom` adds ~36.5 KB to `dist/index.html`, violating our single offline file constraint. Because the stepper replaces `canvasEl.innerHTML` on every step, `svg-pan-zoom` instances would have to be destroyed and reinitialized on each step, risking memory leaks and losing viewport continuity.

## Consequences
- Zero external runtime dependencies added; production bundle size increases by under 2 KB.
- Zoom and pan operations are pure CSS matrix transforms taking ~0 ms, completely decoupled from Graphviz rendering.
- Native browser hit-testing, state hover tooltips, and click handlers function reliably under 2D CSS transforms.
- State labels remain crisp and vector-sharp up to 10x magnification in Chromium.
