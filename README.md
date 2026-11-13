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
.scratch/re-nfa-simulator/issues/ the 20 project tickets
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
   - Navigate to the **Validation** page (`#validation`) via the header navigation and click **Run Suite**.
     - Expected: All 24 built-in test cases pass with green `PASS` badges.
   - Load `(a|b)*abb` and click **Run Differential Test**.
     - Expected: Tests strings up to computed limit `k` (e.g. `k = 8`, 511 strings) against 3 independent oracles with **ALL PASSED** and no mismatches.
7. **Stress Testing**:
   - Navigate to the **Stress** page (`#stress`) via the header navigation and click **Run Stress Test**.
     - Expected: As $n$ increases, backtracking RegExp execution time grows steeply while Thompson NFA execution remains flat/linear. Cancelling halts execution immediately without UI freeze.
   - Click **Log scale** to toggle logarithmic scale for Panel A without re-running the benchmark. Points, ticks (down to `≤0.01 ms`), and any timeout ceiling markers adjust instantaneously.
   - Click **Copy CSV** to copy the stress benchmark table to clipboard in RFC 4180 format (with bare numeric milliseconds and empty time for timeouts/skipped runs) with visual status feedback.
   - Click **Export SVG** to download the standalone chart SVG with complete XML metadata and hex styling.
8. **NFA Diagram & DOT Exports**:
   - In the canvas toolbar, click **Export SVG** (`#export-svg-btn`) to download `nfa-step-6-step.svg` (or `nfa-final.svg` on final view). The exported SVG contains full XML declaration and namespaces, explicit dimensions, an opaque white backdrop (`<rect width="100%" height="100%" fill="#ffffff"/>`), and preserves clean viewBox coordinates unpolluted by on-screen zoom/pan transforms.
   - Click **Export DOT** (`#export-dot-btn`) to download the Graphviz DOT source `nfa-step-6-step.dot` (or `nfa-final.dot`).
   - For expressions exceeding the diagram cap (>400 postfix tokens), SVG export is disabled while DOT export remains enabled for external rendering.
9. **URL Deep Links & Sharing**:
   - Click **Copy Link** (`#copy-link-btn`). The button displays `"Link copied!"` in `#copy-link-status` without writing to `#live-region`.
   - Open a fresh browser tab with a shared query string (e.g. `?regex=(a|b)*abb&input=abb&view=final`). The page restores input controls, automatically runs the build and simulation, displays the verdict, and sets the view.
   - Any invalid or unrecognized parameters are cleanly ignored while valid parameters apply, accompanied by an informative `#link-notice` banner (e.g. `"Ignored link parameters: view, step"`).
10. **Keyboard Shortcuts & Help Dialog**:
   - Press `?` (when not typing in an input field) or click **⌨ Shortcuts** (`#keyboard-help-btn`) to open the native `<dialog id="keyboard-help-dialog">`.
   - The dialog lists all 9 navigation and control shortcuts. Canvas navigation and arrow stepping are suspended while the dialog is active.
   - Press `Esc` or click **Close** (`#keyboard-help-close`) to dismiss; focus returns automatically to the opener element.
   - Polite live region (`#live-region`) announces verdicts upon running and step numbers with applied rules upon stepping. All indicators carry explicit textual labels (never colour-only).

## NFA Diagram & DOT Exports

In the diagram canvas toolbar (`#canvas-toolbar`), two dedicated export buttons allow extracting the currently displayed NFA:

- **Export SVG (`#export-svg-btn`)**:
  - Exports a standalone, fully self-contained vector graphic (`nfa-step-<k>-<view>.svg` or `nfa-final.svg`).
  - Idempotently formatted via `src/ui/export.ts`: includes `<?xml version="1.0" encoding="UTF-8"?>`, `xmlns="http://www.w3.org/2000/svg"`, `xmlns:xlink="http://www.w3.org/1999/xlink"`, explicit width/height dimensions (derived from viewBox when missing), and an opaque `<rect width="100%" height="100%" fill="#ffffff"/>` backdrop for clean embedding in documents or image viewers.
  - Sourced directly from the cached SVG string generated by Graphviz, ensuring that on-screen zoom levels, pan offsets, and interactive hover highlights never leak into the downloaded artifact.
- **Export DOT (`#export-dot-btn`)**:
  - Exports the exact Graphviz DOT source (`nfa-step-<k>-<view>.dot` or `nfa-final.dot`) used to render the displayed view or step.
  - Sourced directly from `toDot()` with pinned layout coordinates and state identifiers intact.
- **Disabled State & Size Cap Handling**:
  - Buttons remain disabled at initial page load, during in-flight asynchronous builds, after syntax errors, and when expressions exceed the 2,000-token engine refusal limit.
  - For large constructions exceeding the 400 postfix token diagram cap, the SVG export button is disabled (as no diagram is rendered), but the DOT export button remains fully enabled so users can export large graphs for external CLI tools (`dot`, `neato`, `sfdp`).
- **Safe File Naming**: Filenames follow a strict machine-readable format (`nfa-final.svg`, `nfa-final.dot`, `nfa-step-<k>-step.svg`, `nfa-step-<k>-textbook.svg`). User regex strings are never placed into filenames to avoid path traversal, encoding issues, or filesystem errors.

## URL Deep Links & State Sharing

The simulator supports shareable URLs that capture the full configuration and view state in the URL query string:

### Query Parameters

| Parameter | Type / Values | Description |
|-----------|---------------|-------------|
| `regex` | string (max 2,000 chars) | Regular expression source |
| `notation` | `standard` | `textbook` | Notation flavor (`standard` with `|`, or `textbook` with `+`) |
| `concat` | `epsilon` | `merge` | Concatenation mode (ε-transitions or state-merge) |
| `preset` | string | Active preset name (e.g. `(a|b)*a`, `a+?`, `(a*)*b`) |
| `alphabet` | comma-separated symbols | Custom alphabet (only serialized when customized) |
| `input` | string (max 1,000 chars) | Test string for immediate simulation execution |
| `view` | `step` | `textbook` | `final` | Displayed diagram view tab |
| `step` | integer (1-based) | Active construction step index (clamped to `[1, totalSteps]`) |
| `compact` | `1` | `0` | Compact state numbering toggle |

### Hash Routing & Three Dedicated Pages

The simulator splits functionality into three discrete hash-routed pages, accessible from local `file://` or web hosting without external routing libraries:
- `#workbench` (default): Regular expression input strip, timeline, parse tree, interactive diagram canvas with pan/zoom, step log, transition table, and test dock with simulation traces.
- `#validation`: 4-card metric strip, formal invariants (I1–I4, size formula, step replay), built-in 24-case test suite, and differential oracle runner.
- `#stress`: Benchmark controls, polynomial vs exponential performance chart, benchmark results table, CSV clipboard export, and SVG chart export.

Legacy hash anchors (`#validation-panel`, `#stress-section`) automatically route to the corresponding pages and are canonicalized via `history.replaceState` without bounce. Deep links and the **Copy Link** button preserve the active page hash (e.g. `?regex=(a|b)*a&step=3#validation`).

### Important: Textbook Union Operator (`+`) Encoding
In standard URL query strings, the `+` character decodes to a whitespace character (` `) per the `application/x-www-form-urlencoded` specification.
When sharing expressions in **textbook mode** where `+` represents the union operator:
- **Always encode `+` as `%2B`** in query parameters (e.g., `?regex=(a%2Bb)*a&notation=textbook`).
- The **Copy Link** button (`#copy-link-btn`) automatically handles all URI encoding correctly using `encodeURIComponent`.
- If a raw `+` is entered in a hand-typed URL, it decodes to a space (`' '`), which the lexer treats as whitespace between symbols, parsing as implicit concatenation (`a . b`) rather than textbook union. Always use `%2B` for `+` in hand-typed links.

### Safety, Validation, and Diagnostics
- **Limits & Sanitization**: URLs are capped at 4,096 characters total (regex $\le$ 2,000, input $\le$ 1,000). All parameters are treated as untrusted input and set safely via DOM `.value` and `.textContent` properties (preventing XSS).
- **Graceful Degradation**: Unknown query keys are silently ignored. If individual parameters contain invalid values (e.g., unrecognized view mode or unparseable step), they are skipped while valid parameters continue to be restored, and an accessible `#link-notice` (`role="status"`) warns the user (e.g. `"Ignored link parameters: view, step"`).
- **Local File Note**: When running locally via `file:///`, copied links reflect local filesystem paths (`file:///...`). To share deep links across machines, host `dist/index.html` on a public static host (see [Publishing & Static Hosting](#publishing--static-hosting)).

## Keyboard Shortcuts Reference

The simulator provides a comprehensive suite of accessible keyboard shortcuts:

| Shortcut | Scope | Action |
|----------|-------|--------|
| `Enter` | Expression input (`#regex-input`) | Build NFA from regular expression |
| `←` / `→` (`ArrowLeft` / `ArrowRight`) | Global | Step construction backward / forward |
| `+` or `=` | Canvas focused | Zoom in diagram (1.2x) |
| `-` or `_` | Canvas focused | Zoom out diagram (1/1.2x) |
| `0` | Canvas focused | Reset zoom to 100% |
| `f` | Canvas focused | Fit entire diagram into viewport |
| `Shift + Arrows` | Canvas focused | Pan diagram canvas by 10% |
| `?` | Global (outside text inputs) | Open keyboard shortcuts help modal |
| `Esc` | Modal open | Close keyboard shortcuts help modal and return focus to opener |

The modal dialog can also be toggled at any time by clicking the **Keyboard shortcuts** button (`#keyboard-help-btn`) in the controls toolbar. While the modal is open, canvas navigation and arrow stepping shortcuts are suspended to prevent accidental background actions.

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

Per [ADR 0002](docs/adr/0002-offline-single-file-build-inline-workers.md), the application targets modern **Chromium-based desktop browsers** (Google Chrome, Microsoft Edge):
- **Chromium / Chrome**: Primary target. Automated E2E test suite runs headlessly against Chromium over `file://`, and manual walkthroughs are verified in Chrome.
- **Other Browsers (Firefox, Safari)**: Untested and unverified per project scope (owner decision: Chromium desktop only; see [`docs/BROWSER-CHECK.md`](docs/BROWSER-CHECK.md)).
