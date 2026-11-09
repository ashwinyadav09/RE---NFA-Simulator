# 18: Stress panel upgrades

**What to build:** Stress panel upgrades implementing LATER item 4 (log/linear toggle for stress Panel A) and the stress portions of item 5 (copy-as-CSV for the stress table and standalone SVG export of the stress chart).

**Blocked by:** 17: Zoom and pan for diagram canvases

**Status:** done

- [x] AC1 Pure CSV serialization & RFC 4180 escaping (unit): `formatStressCsv` outputs correct header, CRLF line endings, table-identical time formatting, real verdicts, empty times for timeout/skipped runs, and quotes fields containing comma, quote, or newline.
  - Proof: `tests/csv.test.ts:4-72`. Mutant: `T18-M-AC1` (LF instead of CRLF in CSV header) killed at `tests/csv.test.ts:7`.
- [x] AC2 Diagram seam: log-scale math and standalone SVG export (unit): `renderStressChartSvg` supports `scale: 'log'` with bottom tick `≤0.01 ms`, ceiling timeout marker at $y=50$, monotonic decade scaling, and `standalone: true` with XML declaration, `<title>`, `<desc>`, explicit dimensions, and no external references.
  - Proof: `tests/diagram.test.ts:1222-1296`. Mutant: `T18-M-AC2` (bottom tick label drops `≤` prefix) killed at `tests/diagram.test.ts:1234`.
- [x] AC3 Log scale toggle control & DOM attribute: `#stress-scale-toggle` button has stable label `"Log scale"`, flips `aria-pressed="true"|"false"`, and updates `data-scale="linear|log"` on `#stress-chart-container`.
  - Proof: `tests/e2e.cjs:1808-1845`. Mutant: `T18-M-AC3` (`aria-pressed` update omitted) killed at `tests/e2e.cjs:1820`.
- [x] AC4 Point retention across scale toggles: toggling log scale re-renders retained data points instantaneously without re-running benchmark or modifying table.
  - Proof: `tests/e2e.cjs:1830`. Mutant: `T18-M-AC4` (scale toggle clears `currentStressRows`) killed at `tests/e2e.cjs:1830`.
- [x] AC5 Timeout marker preserved in log mode: `#panelA-timeout` remains positioned at ceiling in log mode when timeout occurs.
  - Proof: `tests/e2e.cjs:2104-2108`. Mutant: `T18-M-AC5` (timeout marker suppressed in log mode) killed at `tests/e2e.cjs:2106`.
- [x] AC6 Copy CSV action & feedback UX: `#stress-copy-csv` copies table to clipboard in RFC 4180 format; `#stress-copy-status` displays `'Copied!'` with `data-copied="true"`; `#live-region` is untouched.
  - Proof: `tests/e2e.cjs:1840-1865`. Mutant: `T18-M-AC6` (`data-copied` attribute omitted on copy status) killed at `tests/e2e.cjs:1850`.
- [x] AC7 Transient status clearing & button state lifecycle: `#stress-copy-status` clears after 2 s without fixed sleeps; `#stress-copy-csv` and `#stress-export-svg` are disabled at 0 rows and enabled when $\ge 1$ rows exist.
  - Proof: `tests/e2e.cjs:1756,1863-1865,1935-1940`. Mutant: `T18-M-AC7` (`#stress-copy-csv` initially enabled) killed at `tests/e2e.cjs:1756`.
- [x] AC8 Standalone SVG export & XML validity: `#stress-export-svg` triggers download with filename `stress-chart-<family>-<scale>.svg`; downloaded SVG parses without `parsererror` in DOMParser, has `<title>`, `<desc>`, explicit 760x320 dimensions, and starts with XML declaration.
  - Proof: `tests/e2e.cjs:1867-1925`. Mutant: `T18-M-AC8` (wrong download filename) killed at `tests/e2e.cjs:1878`.
