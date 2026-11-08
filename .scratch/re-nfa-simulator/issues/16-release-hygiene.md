# 16: Release hygiene (test hooks out of dist, stale status after early-return builds)

**What to build:** Test hooks must not ship in dist/index.html, and stale status must not linger after early-return builds.

**Blocked by:** 15: Packaging and polish

**Status:** done

- [x] AC1 The hook inventory is recorded in the ticket file.
  - *Proof:* Recorded in Section "## Hook Inventory" with 16 production test hooks, 3 harness-only hooks, and bundled library / DOT identifiers.
- [x] AC2 dist contains no test hooks other than the allowlisted seam VizRenderer; production code may assign self.onmessage in the inline worker.
  - *Proof:* `node tests/e2e.cjs` asserts none of the 16 hook identifiers or `__force` exist in `dist/index.html`. Mutant test (re-adding `(window as any).__ready = true;` to `src/ui/main.ts`) failed alone with `AssertionError: dist/index.html must not contain test hook "__ready"`.
- [x] AC3 Every previous e2e scenario still runs (state before and after counts). Hooks are injected by the harness or a test build only.
  - *Proof:* All 41+ E2E scenario checks (initial render, stepping, race conditions, textbook/merge views, compact labels, validation suite, differential/stress tests, presets, live regions, rebuild clears, early-return clears) passed green using harness-injected hooks via `page.addInitScript()`.
- [x] AC4 #verdict, #trace and #run-status are cleared on every handleBuild path, including capped and early-return builds, with an e2e case proving it.
  - *Proof:* `tests/e2e.cjs` Scope C checks capped build (>400 tokens), engine token limit (>2,000 tokens), and syntax error (`(a|`). Verified #verdict, #trace, #run-status, #step-counter, and canvas attributes are cleared. Mutant test (commenting out `#step-counter` reset in `src/ui/main.ts`) failed alone at `tests/e2e.cjs:2030`.
- [x] AC5 docs/LATER.md exists (docs-only commit).
  - *Proof:* Created in commit `5ab4bc3` (`ticket 16: initialize ticket and docs/LATER.md`).
- [x] AC6 src/engine is untouched. The mutation gate is run only if it was touched.
  - *Proof:* `git diff b87339c -- src/engine` is completely empty.

## Hook Inventory

### 1. Test Hooks in Production Code (`src/ui/main.ts` / `dist/index.html`)

| Hook Identifier | Defined | Read | In dist? | Role | E2E Usage |
|---|---|---|---|---|---|
| `window.__ready` | `src/ui/main.ts:1760` | `tests/e2e.cjs:63` | Yes | State exposure | Wait for initial app readiness |
| `window.__workerResult` | `src/ui/main.ts:62` | `tests/e2e.cjs:66-67` | Yes | State exposure | Test inline worker ping round-trip |
| `window.__workerError` | `src/ui/main.ts:140` | None | Yes | State exposure | Unused |
| `window.__masterPositions` | `src/ui/main.ts:393, 870, 956, 1032` | `tests/e2e.cjs:933` | Yes | State exposure | Assert master layout skipped >150 tokens |
| `window.__testRenderDelay` | `tests/e2e.cjs:767, 781` | `src/ui/main.ts:583-584` | Yes | Override | Delay step 2 render for cache race |
| `window.__testForcePinnedRenderFailure` | `tests/e2e.cjs:831, 844` | `src/ui/main.ts:589` | Yes | Override | Force pinned render failure |
| `window.__buildDone` | `src/ui/main.ts:871, 957, 1033` | `tests/e2e.cjs:78, 178, ...` | Yes | State exposure | Wait for build completion |
| `window.__testForceLayoutFailure` | `tests/e2e.cjs:737, 752` | `src/ui/main.ts:995` | Yes | Override | Force master layout failure |
| `window.__runDone` | `src/ui/main.ts:1152, 1196` | `tests/e2e.cjs:249, 264, ...` | Yes | State exposure | Wait for run simulation completion |
| `window.__suiteDone` | `src/ui/main.ts:1424` | `tests/e2e.cjs:1298` | Yes | State exposure | Wait for suite completion |
| `window.__suiteResults` | `src/ui/main.ts:1425` | `tests/e2e.cjs:1301` | Yes | State exposure | Inspect suite results |
| `window.__diffDone` | `src/ui/main.ts:1444, 1530` | `tests/e2e.cjs:1324, 1345, ...` | Yes | State exposure | Wait for diff completion |
| `window.__diffResult` | `src/ui/main.ts:1531` | `tests/e2e.cjs:1330, 1335, 1353` | Yes | State exposure | Inspect diff results |
| `window.__stressDone` | `src/ui/main.ts:1594, 1753` | `tests/e2e.cjs:1459, 1488, ...` | Yes | State exposure | Wait for stress test completion |
| `window.__stressRowAdded` | `src/ui/main.ts:1595, 1680` | `tests/e2e.cjs:1437, 1479` | Yes | State exposure | Wait for stress table row addition |
| `window.__stressPoints` | `src/ui/main.ts:1754` | None | Yes | State exposure | Unused |

### 2. Harness-Only Hooks (`tests/e2e.cjs`)

| Hook Identifier | Defined | Read | In dist? | Role | E2E Usage |
|---|---|---|---|---|---|
| `window.__e2eWorkerMode` | `tests/e2e.cjs:1322, ...` | `tests/e2e.cjs:34, 38` | No | Override | Simulate worker timeout/error |
| `window.__e2eWorkerDelay` | `tests/e2e.cjs:1361, 1389` | `tests/e2e.cjs:46, 49` | No | Override | Inject worker postMessage delay |
| `window.__liveMutations` | `tests/e2e.cjs:1623` | `tests/e2e.cjs:1640, 1648` | No | State exposure | Track live region mutations |

### 3. Bundled Library / DOT Identifiers with `__` (Not Test Hooks)

- Graphviz DOT identifiers: `__start`, `__start_`, `__anchor_ll`, `__anchor_ur`
- Viz.js / Emscripten symbols: `__clusternodes`, `__indirect_function_table`, `__220__shared_ptr_emplace...`, etc.
