# 0004 Harness-side test instrumentation via init script

Status: accepted, Nov 2026

## Context
E2E browser tests need to observe asynchronous completion (`__buildDone`, `__runDone`, `__suiteDone`, `__diffDone`, `__stressDone`), inspect internal layout coordinates (`__masterPositions`), and inject test faults / delays (`__testRenderDelay`, `__testForcePinnedRenderFailure`, `__e2eWorkerDelay`). Previously, these hooks were defined directly in `src/ui/main.ts` and shipped inside `dist/index.html`.

Shipping test hooks in production builds adds dead code, pollutes the global namespace, and leaves test instrumentation in production artifacts.

## Decision
- Production code in `src/` defines no `__` test hooks or test override switches. `dist/index.html` ships clean with zero test-hook identifiers.
- Production UI exposes the pure renderer constructor `(window as any).VizRenderer = VizRenderer` as a public capability so the test harness can wrap or instrument it.
- All test hooks, observers (DOM MutationObservers on `#run-status`, `#suite-status`, `#diff-status`, `#stress-status`), and method wrappers (`Worker`, `VizRenderer`) are injected by Playwright at the harness seam via `page.addInitScript()` before page scripts evaluate.
- E2E smoke tests enforce this with an assertion verifying that `dist/index.html` contains no forbidden test-hook identifiers.

## Consequences
- `dist/index.html` contains no test instrumentation.
- Production code cannot accidentally rely on test flags or hooks.
- Tests test the exact production binary rather than a separate test build.
- Playwright's `addInitScript` transparently provides all synchronization and fault injection without requiring mock builds or development server switches.
