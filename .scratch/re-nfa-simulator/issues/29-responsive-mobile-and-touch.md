# Ticket 29: Responsive Mobile & Touch

**Status:** done  
**Branch:** ui-redesign  
**Date:** 2026-11-13  

---

## 1. Summary & Scope
Implements Screen S9 mobile responsiveness and canvas touch gestures per `docs/design.md` §7.9 and §12:
1. **Mobile Viewport 390×844:** Ensures 0 horizontal page overflow (`document.documentElement.scrollWidth <= 390`).
2. **Single-column Grid Layout:** Collapses workbench rails and input strip to 1 column at `< 768px`.
3. **Canvas Touch Gestures:** Created `src/ui/canvas-touch.ts` (`attachTouchGestures`) supporting:
   - Single-finger touch pan (`onPan`)
   - Two-finger touch pinch zoom (`onPinch`) centered on gesture midpoint
   - Double-tap to fit zoom (`onDoubleTap`) within 350ms threshold
4. **Touch Targets & Sizing:** Minimum 44×44px control sizing under `@media (pointer: coarse)` with `touch-action: manipulation` for buttons and `touch-action: none` on `#canvas`.
5. **Horizontal Overflow Containment:** Scrollable table wrappers and panels remain strictly within container bounds without horizontal page drift.

---

## 2. Acceptance Criteria Checklist
- [x] **AC1 (Canvas Touch Gestures):** Single-finger touch drag smoothly pans diagram canvas; two-finger pinch adjusts zoom scale factor; quick double-tap triggers fit-to-viewport.
- [x] **AC2 (Mobile Viewport & 0 Horizontal Overflow):** At 390×844 mobile viewport, `document.documentElement.scrollWidth <= 390`, with responsive input card and table overflow containment.
- [x] **AC3 (Touch Target Sizing):** Coarse pointer media queries provide >= 44×44px interactive targets with `touch-action: manipulation`.
- [x] **AC4 (Unit & E2E Verification):** 4 vitest unit tests in `tests/canvas-touch.test.ts` pass; E2E smoke tests in `tests/e2e.cjs` verify scroll width, touch pan, and double-tap fit.
- [x] **AC5 (Pure Engine Seam & Single-file Production Gate):** `src/engine/` is 100% untouched; `dist/index.html` assignment pattern strictly contains `window.VizRenderer=` and `self.onmessage=`; 0 console errors.

---

## 3. UI Mutants Verification

| ID | Description | Status | First Failing Assertion | Location |
|---|---|---|---|---|
| CTRL-SURVIVE | Control: No-op comment added (must SURVIVE) | **SURVIVED** | `` | `` |
| CTRL-WRONG-KILLER | Control: Wrong expect string on real failure (must be WRONG-KILLER) | **WRONG-KILLER** | `E2E test failed: AssertionError [ERR_ASSERTION]: Ctrl+wheel focal point X must keep node center within 1 px, drift was 51.22856140136719` | `/Projects/Automata/tests/e2e.cjs:2846:3` |
| T29-AC1-1 | T29-AC1-1: Mutate onPan dx, dy to 0 in src/ui/canvas-touch.ts | **KILLED** | `E2E test failed: AssertionError [ERR_ASSERTION]: Touch drag must pan canvas viewport` | `/Projects/Automata/tests/e2e.cjs:4208:10` |
| T29-AC1-2 | T29-AC1-2: Mutate onDoubleTap invocation in src/ui/canvas-touch.ts | **KILLED** | `E2E test failed: AssertionError [ERR_ASSERTION]: Double tap on canvas must trigger fit` | `/Projects/Automata/tests/e2e.cjs:4254:10` |
| T29-AC2-1 | T29-AC2-1: Mutate pinch scaleFactor in src/ui/canvas-touch.ts | **KILLED** | `AssertionError: expected 1 to be close to 2, received difference is 1, but expected 0.05` | `tests/canvas-touch.test.ts:128:20` |
| T29-AC2-2 | T29-AC2-2: Mutate touch pointerType check to ignore touch in src/ui/canvas-touch.ts | **KILLED** | `E2E test failed: AssertionError [ERR_ASSERTION]: Touch drag must pan canvas viewport` | `/Projects/Automata/tests/e2e.cjs:4208:10` |

---

## 4. Visual Evidence
- `scratch/ticket29-mobile-light.png`: Light mode mobile 390×844 layout with diagram canvas and touch controls.
- `scratch/ticket29-mobile-dark.png`: Dark mode mobile 390×844 layout.

