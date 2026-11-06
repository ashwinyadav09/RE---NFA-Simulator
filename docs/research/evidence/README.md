# Evidence index

Raw output of the experiments quoted in `../REPORT.md`. Environment: Node v22.22.2 (V8 12.4.254.21), Viz.js 3.31.0 (Graphviz 16.1.0), Chromium via Playwright 1.56.0. Timings vary by machine.

| File | What it shows |
| --- | --- |
| 00 | toolchain versions that were installed and tested together |
| 01 | M1 section 4.5 literals (35 checks) and the 29-case error comparison |
| 02 | front-end fuzz: 2.16 million inputs, validity and parse-tree agreement, error-code and position disagreement rates |
| 03 | baseline properties and the generator's size distribution |
| 04 | mutation matrix: 13 mutants by detection layer |
| 05a | wrapped versus naive RegExp translation on random expressions; (a?)^n a^n stress and NFA scaling |
| 05b | which pathological families are exponential in V8; one random expression over 2 s |
| 05c | stacked postfix operators in V8's RegExp versus the M1 reading |
| 06 | Viz.js features, layout drift across steps (plain versus pinned), render time by size |
| 07 | single-file build from file:// in Chromium; plain worker SecurityError |
