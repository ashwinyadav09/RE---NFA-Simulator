# 0002 Offline single-file build, inline workers

Status: proposed, 3 Nov 2026

## Context
Evaluators should be able to open the simulator from a link or from one HTML file on disk. The stress test and the JavaScript RegExp oracle can run for seconds and must not freeze the page, so they need workers. In headless Chromium, a page opened from `file://` throws `SecurityError` when it creates a worker from a separate file (`docs/research/evidence/07-browser-file-protocol.txt`).

## Decision
- Ship one HTML file built with Vite and `vite-plugin-singlefile`. Viz.js and its WebAssembly are inlined (about 1.36 MB, 490 KB gzipped in the smoke build).
- Workers are imported with `?worker&inline` so they become Blob workers, which work from `file://` (verified in the same evidence file).
- Never fetch anything at runtime. No CDN, no remote fonts.

## Consequences
- The page works offline and from `file://` in Chromium. Firefox and Safari are not yet verified; a ticket must check them.
- The bundle is large for a static page. Accepted: the WebAssembly is the layout engine.
- A hosted copy (GitHub Pages or similar) is the same file, so there is one build to test.
