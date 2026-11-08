# 0004 Harness-side test instrumentation via init script

Status: accepted, Nov 2026

## Context
E2E browser tests need to observe asynchronous completion (`__buildDone`, `__runDone`, `__suiteDone`, `__diffDone`, `__stressDone`), inspect internal layout coordinates (`__masterPositions`), and inject test faults / delays (`__testRenderDelay`, `__testForcePinnedRenderFailure`, `__e2eWorkerDelay`). Previously, these hooks were defined directly in `src/ui/main.ts` and shipped inside `dist/index.html`.

Shipping test hooks in production builds adds dead code, pollutes the global namespace, and leaves test instrumentation in production artifacts.

## Decision
- Production code in `src/` defines no `__` test hooks or test override switches.
- Exactly one test seam is exposed globally: `window.VizRenderer` (`src/ui/main.ts:34`). This documented seam provides a render-time fault-injection point (`__testRenderDelay`, `__testForcePinnedRenderFailure`, `__testForceLayoutFailure`) required for E2E fallback testing. It is caught by an `Object.defineProperty` setter on `window.VizRenderer` in Playwright's `page.addInitScript()` before scripts evaluate.
- Option B (an injectable renderer covered by unit tests, removing the global entirely) was considered and deferred because removing the global seam would drop or weaken browser-level E2E coverage of SVG layout fallback behaviour under Viz.js engine errors and render races.
- In production workers, assigning `self.onmessage` in `src/ui/worker.ts` is standard worker initialization and is explicitly permitted.
- All test hooks, observers (DOM MutationObservers on `#run-status`, `#suite-status`, `#diff-status`, `#stress-status`), and method wrappers (`Worker`, `VizRenderer`) are injected by Playwright at the harness seam via `page.addInitScript()` before page scripts evaluate.
- E2E smoke tests enforce this with a pattern check asserting that `dist/index.html` contains no assignments to `window`, `globalThis`, or `self` except for the allowlisted entries (`VizRenderer` and `self.onmessage`). Note: aliased assignments (e.g. `const w = window; w.x = 1`) are not detected by static pattern checks.

## Consequences
- `dist/index.html` contains no test instrumentation.
- Production code cannot accidentally rely on test flags or hooks.
- Tests test the exact production binary rather than a separate test build.
- Playwright's `addInitScript` transparently provides all synchronization and fault injection without requiring mock builds or development server switches.

