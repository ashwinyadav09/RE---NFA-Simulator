# 17: Zoom and pan for diagram canvases

**What to build:** Zoom and pan on the step canvas and textbook canvas (LATER item 3 / T08/T09), mitigating cluttered diagrams and overflow on large regular expressions.

**Blocked by:** 16: Release hygiene

**Status:** ready-for-agent

- [ ] AC1 Pure maths (unit): clampZoom, zoomAt, panBy, fitToContainer, initialView, sameFrame.
- [ ] AC2 No page overflow: documentElement.scrollWidth <= clientWidth at 1280x800 and 1920x1080 for the 161-token final view, the 400-token (cap) final view, and the textbook last step at the cap.
- [ ] AC3 Initial view modes per D4: 161-token final = start, zoom 1, start state fully inside the frame; a moderately oversized diagram (pick an expression with fitZoom >= 0.5) = fit with the whole svg rect inside the frame rect; a small diagram = zoom 1 centred.
- [ ] AC4 Fit reaches a full fit below 0.1: after #zoom-fit-btn on the 161-token final view, svg rect is inside the frame, data-zoom is within 1% of frameWidth/contentWidth, mode fit.
- [ ] AC5 The real transform matches the state: getComputedStyle(#canvas-viewport).transform matrix equals data-zoom/pan-x/pan-y, and a state node's getBoundingClientRect moves as the maths predicts after a button zoom.
- [ ] AC6 Buttons: x1.2 in, /1.2 out, 100%, about the canvas centre (the point under the centre does not move), #zoom-level text, disabled at limits.
- [ ] AC7 Wheel: Ctrl+wheel zooms about the cursor (a state node under the cursor stays within 1 px); dispatch a plain vertical WheelEvent and assert defaultPrevented is false and data-zoom unchanged; a horizontal or Shift+wheel pans x and is defaultPrevented.
- [ ] AC8 Drag pan moves pan-x/pan-y by exactly the mouse delta, no text selected afterwards.
- [ ] AC9 Persistence per D5: flat pinned stepping keeps zoom/pan (same viewBox); textbook stepping and compact toggle (viewBox changes) apply the initial view; step/final toggle follows the same rule.
- [ ] AC10 Resets and stale state: rebuild, notation, concatenation and preset reset the view; capped and refused builds remove data-zoom, data-pan-x, data-pan-y, data-viewport-mode and disable the toolbar. One mutant per cleared line.
- [ ] AC11 Keyboard: with #canvas focused each key in D7 works; plain ArrowRight still steps; Shift+ArrowRight pans and does NOT step; Alt+ArrowLeft is not defaultPrevented.
- [ ] AC12 Hit-testing and tooltips survive transforms: after zoom and pan, document.elementFromPoint at a state's centre lands inside that g.node, and the node still has its title and data-created-by-step.
- [ ] AC13 Zero re-renders: the harness's render-call count is unchanged across zoom, pan, fit and keyboard actions (use the existing harness recorder).
- [ ] AC14 The layer survives every replacement: after stepping, view toggles, a cap message, a refused build and then a valid build, exactly one #canvas-viewport exists and the toolbar still works.
- [ ] AC15 Visual proof (not a test): attach screenshots of the 161-token final view at start mode, after Fit, and at 10x on a state label. Report whether label edges are crisp at 10x.
