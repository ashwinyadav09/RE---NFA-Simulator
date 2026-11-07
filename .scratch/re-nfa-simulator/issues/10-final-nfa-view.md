# 10: Final NFA view

**What to build:** A student studies the finished NFA: diagram, table, counts, compact labels, and the active states of a trace highlighted on the diagram.

**Blocked by:** 03: Simulation; 07: Construction stepper

**Status:** done

- [x] The final view shows the diagram, `transition-table` and `stats`. (`tests/e2e.cjs` via `npm run e2e`)
- [x] A compact-labels toggle (0 to n−1 in id order) applies identically to table, trace and diagram. The engine's ids do not change. (`tests/engine.test.ts` `[T10-2]`, `tests/diagram.test.ts` `[T10-5]`, `[T10-6]`, `[T10-7]`, `tests/e2e.cjs`)
- [x] Stepping through a trace highlights the active states on the diagram. A dead run is shown as dead. (`tests/diagram.test.ts` `[T10-3]`, `[T10-4]`, `[T10-6]`, `tests/e2e.cjs`)
- [x] Diagram seam tests cover active-state highlighting. (`tests/diagram.test.ts` `[T10-3]`, `[T10-4]`, `[T10-6]`)
- [x] The browser smoke runs `ba` and sees the highlighted sets. (`tests/e2e.cjs` via `npm run e2e`)

