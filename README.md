# RE → NFA (Thompson) Simulator

A browser app: type a regular expression, watch Thompson's construction build the ε-NFA one operator at a time, simulate strings with ε-closure traces, and see the app validate itself. Static page, no backend, works offline from one HTML file.

```
AGENTS.md                         always-on rules (short)
PROMPTS.md                        prompts to paste into Antigravity, step by step
CONTEXT.md                        vocabulary and concepts
docs/SPEC.md                      functional specification and user stories
docs/adr/                         architectural decision records
docs/BROWSER-CHECK.md             browser scope and verification record (Chromium only)
docs/research/REPORT.md           research findings and prototype evidence
.agents/skills/thompson-rules/    canonical rules, fixtures (JSON), mutation checklist
.scratch/re-nfa-simulator/issues/ the 15 project tickets
```

## Quick Start & Verification Gate

Prerequisites: Node.js 22+.

```bash
npm ci             # Clean dependency installation
npm run check      # Full quality gate: typecheck, vitest unit tests, and production build
npm run e2e        # Browser smoke test in Chromium loading dist/index.html over file://
```

## Evaluator Walkthrough (R3 Acceptance Rehearsal)

Open the built `dist/index.html` directly in a browser over `file://` (with network off if desired):

1. **Build `(a|b)*a`**:
   - Select or type `(a|b)*a` in `#regex-input` and click **Build** (or press Enter).
   - Expected: `#stats` reports **10 states** and **12 transitions** (matching `fixtures/worked-example.json`).
2. **Step through construction**:
   - Click the stepper controls (or use left/right arrow keys) up to step 6.
   - Expected: Stepper displays **step 6 / 6**. The diagram stays stable across steps with zero node jumping (pinned layout).
3. **Simulate test string `ba`**:
   - Enter `ba` in the simulation text area and click **Run**.
   - Expected: Verdict is **ACCEPT**. The trace displays:
     - Initial closure: `{0, 2, 4, 6, 7, 8}`
     - After `'b'`: `{0, 2, 3, 4, 5, 7, 8}`
     - After `'a'`: `{0, 1, 2, 4, 5, 7, 8, 9}`
4. **Merge Concatenation**:
   - Switch concatenation dropdown to **Merge** and click **Build**.
   - Expected: `#stats` reports **9 states** and **11 transitions**.
5. **Syntax Error Diagnostic**:
   - Type `(a|)` and click **Build**.
   - Expected: Diagnostic error: `Missing operand after '|' at position 2` with caret highlighting position 2.
6. **Built-in Suite & Differential Oracle Testing**:
   - In the Validation section, click **Run Suite**.
     - Expected: All 24 built-in test cases pass with green `PASS` badges.
   - Load `(a|b)*abb` and click **Run Differential Test**.
     - Expected: Tests strings up to computed limit `k` (e.g. `k = 8`, 511 strings) against 3 independent oracles with **ALL PASSED** and no mismatches.
7. **Stress Testing**:
   - In the Stress section, click **Run Stress Test**.
     - Expected: As $n$ increases, backtracking RegExp execution time grows steeply while Thompson NFA execution remains flat/linear. Cancelling halts execution immediately without UI freeze.
   - Click **Log scale** to toggle logarithmic scale for Panel A without re-running the benchmark. Points, ticks (down to `≤0.01 ms`), and any timeout ceiling markers adjust instantaneously.
   - Click **Copy CSV** to copy the stress benchmark table to clipboard in RFC 4180 format (with bare numeric milliseconds and empty time for timeouts/skipped runs) with visual status feedback.
   - Click **Export SVG** to download the standalone chart SVG with complete XML metadata and hex styling.
8. **Keyboard & Accessibility**:
   - Repeat steps 1 to 3 using keyboard alone (Tab, Enter, Arrow keys).
   - Polite live region (`#live-region`) announces verdicts upon running and step numbers with applied rules upon stepping. All indicators carry explicit textual labels (never colour-only).

## Canvas Navigation & Zoom/Pan Controls

When viewing NFA diagrams (step view, textbook view, or final view), navigation controls allow inspecting large constructions without clutter or page overflow:

- **Toolbar Buttons**:
  - `+` (Zoom In): Multiplies zoom by 1.2x centered on canvas.
  - `-` (Zoom Out): Multiplies zoom by 1/1.2x centered on canvas.
  - `Fit` (Fit to screen): Scales and centers the full diagram within the frame (reaches below 0.1 for very large diagrams).
  - `100%` (Reset): Resets zoom to 1.0x (100%).
- **Mouse & Trackpad**:
  - `Ctrl + Scroll` / `Cmd + Scroll`: Zooms continuously toward/away from the cursor position.
  - `Drag` (Left click + drag): Pans the diagram canvas smoothly with pointer capture.
  - `Shift + Scroll` or horizontal scroll: Pans horizontally.
  - Plain vertical scroll is preserved for native page scrolling.
- **Keyboard (when canvas is focused)**:
  - `+` or `=`: Zoom in.
  - `-` or `_`: Zoom out.
  - `0`: Reset zoom to 100%.
  - `f`: Fit entire diagram into canvas.
  - `Shift + ArrowLeft` / `Shift + ArrowRight` / `Shift + ArrowUp` / `Shift + ArrowDown`: Pan diagram by 10% of frame dimensions.
  - Plain `ArrowLeft` / `ArrowRight`: Step construction (previous/next step).

## Publishing & Static Hosting

The production build produced in `dist/index.html` is completely self-contained:
- All HTML, CSS, JavaScript, Web Workers, and Graphviz (Viz.js) engine routines are bundled into a single file (`dist/index.html`).
- **Zero runtime dependencies and zero server APIs**: works completely offline from local disk (`file://`) or any static web server.

### Deploying to Any Static Host

To publish the application, copy or upload `dist/index.html` as the root `index.html` on any static web hosting platform:
- **GitHub Pages**: Place `dist/index.html` in the repository root or docs/ directory and configure Pages publishing in repository settings.
- **Cloudflare Pages / Netlify / Vercel**: Configure deploy directory to `dist` (or drag and drop the `dist` folder into their web consoles).
- **AWS S3 / Google Cloud Storage / Azure Blob**: Upload `dist/index.html` to a public static website bucket.
- **Local HTTP server**: Run `npx serve dist` or `python -m http.server -d dist 8080`.

No build scripts, server-side containers, or deployment dependencies are required.

## Browser Support

See [`docs/BROWSER-CHECK.md`](docs/BROWSER-CHECK.md) for full browser verification status:
- **Chromium / Chrome**: Tested in Chromium over `file://` (automated smoke and headed walkthrough pass).
- **Firefox**: Not checked; other browsers are not verified (owner decision: Chromium only).
- **Safari**: best effort, not verified.
