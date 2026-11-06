# 01: Walking skeleton

**What to build:** A student opens one HTML file from disk, types `a`, presses Build, and sees the 2-state NFA drawn with its state and transition counts. Behind that: the toolchain, the two test seams, the single-file build with Viz.js inlined, an inline worker proved to run, and the two commands every later ticket relies on.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `npm run check` runs typecheck, tests and the production build, and passes. Package versions are pinned exactly as in the verified smoke setup.
- [ ] At the Engine seam, analyzing `a` returns an NFA with two states, one `a` transition, a start and an accept; a test proves it.
- [ ] At the Diagram seam, that NFA becomes DOT text with an id on every node and edge, a double-circle accept state and a start arrow; a test proves it.
- [ ] The Viz.js call sits behind a one-method renderer port with two adapters (Viz.js and an in-memory fake). Invalid DOT comes back as an error value, never as an exception; a test proves it with both adapters.
- [ ] The production build is one HTML file with Viz.js inlined. `npm run e2e` opens it from `file://` with no network, types `a`, presses Build and sees 2 states and 1 transition (`stats`, `canvas`).
- [ ] A worker imported inline runs a round trip inside that same built file from `file://`, and the smoke test checks it.
- [ ] The engine has no DOM dependency and runs under Node. Nothing beyond the single-symbol path is built.
