# 0006 Stress panel upgrades: retained row model, log scale, and zero-dependency exports

Status: accepted, Nov 2026

## Context
Ticket 14 introduced the stress panel to contrast exponential backtracking RegExp runtime on pathological inputs against linear-time Thompson ε-NFA simulation. While functional, the stress panel suffered from several limitations identified in LATER items 4 and 5:
1. Panel A used a fixed linear Y-axis $[0, 8000]\text{ ms}$. Because early iterations and NFA execution times are small (often $<1\text{ ms}$), points bunched at the bottom axis, making comparison difficult.
2. Benchmark results were not retained in structured memory; re-rendering the chart required re-running the entire benchmark.
3. No export mechanisms existed for extracting benchmark data into spreadsheets or standalone vector graphics.

Per project constraints (Chromium-only, single offline distribution file, zero runtime dependencies, pure engine untouched, zero new `window.*` globals per ADR 0004), these upgrades must be implemented client-side without external visualization or serialization libraries.

## Decision

### 1. Retained Row Model as Single Source of Truth
We define a module-level retained row model `currentStressRows: StressRow[]` holding structured benchmark records:
```ts
export interface StressRow {
  family: string;
  n: number;
  inputLength: number;
  regExpTimeMs: number | null;
  regExpVerdict: RegExpVerdict;
  nfaTimeMs: number;
  nfaVerdict: NfaVerdict;
}
```
- `currentStressRows` feeds the table, chart points, and CSV serializer.
- It is cleared only when a new benchmark run starts.
- It is retained upon cancel or completion, allowing re-rendering the chart and exporting data at any time without re-running the benchmark.

### 2. Log Scale for Panel A
- Linear scale remains the default; scale state is kept in module state (not `localStorage`).
- Floor is set to $0.01\text{ ms}$ ($10^{-2}$). Values $\le 0.01\text{ ms}$ map to the bottom axis ($y = 265\text{ px}$), with the bottom tick labeled `"≤0.01 ms"`.
- Fixed tick set: decades 0.01 to 1000 plus the 8000 ms ceiling (`[0.01, 0.1, 1, 10, 100, 1000, 8000]` ms).
- At $8000\text{ ms}$, the ceiling and timeout marker (`#panelA-timeout`) coincide with the linear ceiling ($y = 50\text{ px}$).
- Panel B remains linear $[0, 10]\text{ ms}$ over domain $[0, 1000]$.
- Control: STABLE button label `"Log scale"`, flipping `aria-pressed="true"|"false"`. Container carries `data-scale="linear|log"`.

### 3. Pure RFC 4180 CSV Serializer & Clipboard Strategy
- Pure function `formatStressCsv(rows: StressRow[]): string` in `src/ui/csv.ts`.
- RFC 4180 quoting: fields containing comma, quote, or newline are enclosed in double quotes, with internal quotes escaped as `""`.
- Header: `family,n,string_length,regexp_time_ms,nfa_time_ms,regexp_verdict,nfa_verdict`.
- Line endings: strict CRLF (`\r\n`) with trailing CRLF. Time columns contain bare numbers formatted with the shared formatters (1 decimal place for RegExp time, 2 decimal places for NFA time, matching the precision of the table cells without the " ms" suffix); timeouts, skipped runs, and errors produce empty time fields (e.g. `star-star-b,12,12,1.1,0.40,REJECT,REJECT`).
- Copy-only (no file download for CSV). Uses `navigator.clipboard.writeText` with a hidden `<textarea>` + `document.execCommand('copy')` fallback for compatibility.
- Visual feedback is directed solely to `#stress-copy-status` (`role="status"`, `data-copied="true"|"false"`), auto-clearing after 2 seconds. In accordance with ADR 0004, it never writes to `#live-region`.

### 4. Standalone SVG Export
- The chart generator `renderStressChartSvg` in `src/diagram/index.ts` accepts `standalone: boolean`.
- Standalone mode produces a self-contained XML document:
  - XML declaration: `<?xml version="1.0" encoding="UTF-8"?>`
  - Explicit numeric dimensions: `width="760" height="320"` (replacing `width="100%"`), `viewBox="0 0 760 320"`
  - XML-escaped `<title>` and `<desc>`
  - Hex colors only, no CSS variables, no `<script>`, and no external references
- Download trigger: `Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })` with `a[download="stress-chart-<family>-<scale>.svg"]`. The object URL is revoked after a 1000 ms delay to prevent premature disposal in Chromium.

### 5. Automated UI Mutant Runner
To verify that every test kills its mutant on its own, `tests/ui-mutants.cjs` runs automated mutation checks:
- Verifies clean git working tree before execution.
- Mutates source files, compiles with `npm.cmd run build`, and executes test suites.
- Captures first failing assertion message and file:line verbatim.
- Reverts mutations in a `finally` block with `git checkout -- <file>`.
- Evaluates self-test controls (`CTRL-SURVIVE`, `CTRL-WRONG-KILLER`) to guard against false positives.

## Consequences
- Zero external runtime dependencies added; `dist/index.html` size remains ~1.45 MB.
- Chart and table seamlessly toggle between linear and logarithmic representations in ~0 ms without re-running long-running worker benchmarks.
- Clean separation between pure formatting logic (`src/ui/csv.ts`, `src/diagram/index.ts`) and DOM event wiring (`src/ui/main.ts`).
- Full test coverage with vitest unit tests and Playwright browser smoke tests across all Acceptance Criteria.
