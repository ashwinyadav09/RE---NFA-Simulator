# 17: Zoom and pan for diagram canvases

**What to build:** Zoom and pan on the step canvas and textbook canvas (LATER item 3 / T08/T09), mitigating cluttered diagrams and overflow on large regular expressions.

**Blocked by:** 16: Release hygiene

**Status:** done

- [x] AC1 Pure maths (unit): clampZoom, zoomAt, panBy, fitToContainer, initialView, sameFrame.
  - Proof: `tests/viewport.test.ts:1-120` (7 vitest unit tests cover clampZoom, zoomAt, panBy, fitToContainer, initialView, sameFrame).
- [x] AC2 No page overflow: documentElement.scrollWidth <= clientWidth at 1280x800 and 1920x1080 for the 161-token final view, the 399-token real worst case final view, the 799-token above-cap message view, and the textbook last step at the cap.
  - Proof: `tests/e2e.cjs:2247,2263,2289,2306`. Mutant: remove `overflow: hidden` from `#canvas` CSS rule killed at `tests/e2e.cjs:2247`.
- [x] AC3 Initial view modes per D4: 161-token final = start, zoom 1, start state fully inside the frame; a moderately oversized diagram (pick an expression with fitZoom >= 0.5) = fit with the whole svg rect inside the frame rect; a small diagram = zoom 1 centred.
  - Proof: `tests/e2e.cjs:2313,2326,2338`. Mutants: never uses fit mode (`initialView` returns `mode: 'start'` in both branches) killed at `tests/e2e.cjs:2313`; small diagram centering omitted (`panX: 0`) killed at `tests/e2e.cjs:2338`.
- [x] AC4 Fit reaches a full fit below 0.1: after #zoom-fit-btn on the 161-token final view, svg rect is inside the frame, data-zoom is within 1% of frameWidth/contentWidth, mode fit.
  - Proof: `tests/e2e.cjs:2353`. Mutant: `minZoom` fixed at 0.1 instead of dynamic `Math.min(0.1, fitZoom)` killed at `tests/e2e.cjs:2353`.
- [x] AC5 The real transform matches the state: getComputedStyle(#canvas-viewport).transform matrix equals data-zoom/pan-x/pan-y, and a state node's getBoundingClientRect moves as the maths predicts after a button zoom.
  - Proof: `tests/e2e.cjs:2386,2409`. Mutant: transform skipped on zoom-in button (`applyViewport()` omitted on button click) killed at `tests/e2e.cjs:2409`.
- [x] AC6 Buttons: x1.2 in, /1.2 out, 100%, about the canvas centre (the point under the centre does not move), #zoom-level text, disabled at limits.
  - Proof: `tests/e2e.cjs:2421,2422,2426,2430,2441`. Mutants: zoom-out button multiplies by 1.2 instead of dividing killed at `tests/e2e.cjs:2426`; `#zoom-level` text update omitted killed at `tests/e2e.cjs:2422`; zoom-in button not disabled at max zoom 10.0 killed at `tests/e2e.cjs:2441`.
- [x] AC7 Wheel: Ctrl+wheel zooms about the cursor (a state node under the cursor stays within 1 px); dispatch a plain vertical WheelEvent and assert defaultPrevented is false and data-zoom unchanged; a horizontal or Shift+wheel pans x and is defaultPrevented.
  - Proof: `tests/e2e.cjs:2476,2477,2478,2500,2501,2515,2527`. Mutant: ignore frame offset on cursor conversion (`focal = { x: e.clientX, y: e.clientY }`) killed at `tests/e2e.cjs:2500`.
- [x] AC8 Drag pan moves pan-x/pan-y by exactly the mouse delta, no text selected afterwards.
  - Proof: `tests/e2e.cjs:2543,2544,2546`. Mutant: inverted drag pan delta (`dx = -(e.clientX - lastPointerX)`) killed at `tests/e2e.cjs:2543`.
- [x] AC9 Persistence per D5: persist zoom/pan when the new SVG's viewBox is identical, including flat pinned stepping and compact toggle when it does not change the viewBox; otherwise re-initialise to initial view (e.g. textbook stepping or view toggle with different viewBox).
  - Proof: `tests/e2e.cjs:2563,2582,2604,2605`. Mutants: always re-initialise (`if (false)` replaces sameFrame check) killed at `tests/e2e.cjs:2563`; always persist (`sameFrame || currentView === 'textbook'`) killed at `tests/e2e.cjs:2582`.
- [x] AC10 Resets and stale state: rebuild, notation, concatenation and preset reset the view; capped and refused builds remove data-zoom, data-pan-x, data-pan-y, data-viewport-mode and disable the toolbar. One mutant per cleared line.
  - Proof: `tests/e2e.cjs:2194-2198,2621-2664`. Mutants: skip viewport reset on rebuild killed at `tests/e2e.cjs:2621`; `data-zoom` not cleared killed at `tests/e2e.cjs:2194`; `data-pan-x` not cleared killed at `tests/e2e.cjs:2195`; `data-pan-y` not cleared killed at `tests/e2e.cjs:2196`; `data-viewport-mode` not cleared killed at `tests/e2e.cjs:2197`; toolbar disabled omitted killed at `tests/e2e.cjs:2198`.
- [x] AC11 Keyboard: with #canvas focused each key in D7 works; plain ArrowRight still steps; Shift+ArrowRight pans and does NOT step; Alt+ArrowLeft is not defaultPrevented.
  - Proof: `tests/e2e.cjs:2688,2692,2697,2702,2706,2712,2718,2724,2728,2734,2740`. Mutants: remove `altKey` guard killed at `tests/e2e.cjs:2740`; canvas keydown intercepts plain `ArrowRight` without stepping killed at `tests/e2e.cjs:2728`.
- [x] AC12 Hit-testing and tooltips survive transforms: after zoom and pan, document.elementFromPoint at a state's centre lands inside that g.node, and the node still has its title and data-created-by-step.
  - Proof: `tests/e2e.cjs:2766`. Mutant: `pointer-events: none` on `#canvas-viewport` killed at `tests/e2e.cjs:2766`.
- [x] AC13 Zero re-renders: the harness's render-call count is unchanged across zoom, pan, fit and keyboard actions (use the existing harness recorder).
  - Proof: `tests/e2e.cjs:2777,2803`. Mutant: trigger `renderer.render` on zoom-in button click killed at `tests/e2e.cjs:2803`.
- [x] AC14 The layer survives every replacement: after stepping, view toggles, a cap message, a refused build and then a valid build, exactly one #canvas-viewport exists and the toolbar still works.
  - Proof: `tests/e2e.cjs:2826,2828`. Mutant: cap message replaces `#canvas` content destroying `#canvas-viewport` killed at `tests/e2e.cjs:2826`.
- [x] AC15 Visual proof (not a test): attach screenshots of the 161-token final view at start mode, after Fit, and at 10x on a state label. Report whether label edges are crisp at 10x.
  - Proof: Screenshots generated in `.scratch/re-nfa-simulator/screenshots/` (`ac15_161_start.png`, `ac15_161_fit.png`, `ac15_161_10x.png`). Labels remain crisp vector outlines at 10x.
