# 0008 Three hash-routed pages and shared control tokens

Status: accepted, Nov 2026

## Context

Prior to Tickets 31 and 32, the simulator rendered all primary features—the construction workbench, validation suite, and stress benchmark panel—on a single vertically scrolling page. The header navigation bar only performed in-page smooth scrolling to anchor IDs (`#workbench`, `#validation-panel`, `#stress-section`). In addition, inputs, buttons, and selects across the application had divergent heights, inconsistent horizontal padding, and varying font sizes (13px to 16px), causing vertical misalignment and uneven row baselines across desktop and mobile screens.

Usability requirements called for:
1. **Three discrete pages**: Workbench, Validation, and Stress, with only one page visible at a time.
2. **Offline-safe hash routing**: Full back/forward navigation and deep-link preservation operating from `file://` URIs without path routing, `pushState`, or external router packages.
3. **Legacy alias compatibility**: Preserving old links and demo references (`#validation-panel`, `#stress-section`) without creating history bounce loops.
4. **Unified control sizing and alignment**: Strict geometric consistency across all inputs, selects, and buttons ($\pm 1\text{px}$ alignment and height match across 6 viewports).
5. **Full-width in-flow error messaging**: Placing alphabet error messages on a dedicated grid row that collapses when empty and expands in-flow without clipping or overlapping controls.

All changes must adhere to core project invariants:
- Pure TypeScript engine seam (`src/engine/`) untouched (0 bytes diff).
- Static single-file offline distribution (`dist/index.html`).
- Zero backend, zero external runtime dependencies.
- Zero global namespace pollution: only `self.onmessage=` and `window.VizRenderer=` permitted in distribution output (ADR 0004).

## Decision

### 1. Hash-Based Pure Client Router (`src/ui/router.ts`)

- **Route Representation & Routing Strategy**:
  - Three canonical routes: `#workbench` (default), `#validation`, and `#stress`.
  - Empty hash, unrecognized hashes, or malformed fragments automatically fallback to `workbench`.
  - Implemented as a pure TypeScript module (`src/ui/router.ts`) exporting `parseRoute`, `formatRoute`, `isLegacyAlias`, and `getRouteTitle`.
- **Legacy Alias Normalization**:
  - `#validation-panel` maps to `validation`; `#stress-section` maps to `stress`.
  - Canonicalization uses `history.replaceState` rather than `location.hash` assignment. This updates the displayed URL fragment to canonical format without pushing a duplicate history entry, preventing Back-button bounces.
- **State & DOM Preservation via `hidden` Attribute**:
  - Page containers (`#page-workbench`, `#page-validation`, `#page-stress`) use the HTML `hidden` attribute.
  - Elements remain mounted in the DOM. Transitions, canvas SVG layers, running stress benchmarks, and table contents are never destroyed or re-instantiated upon page switches.
- **Accessible Page Navigation**:
  - Navigating between pages scrolls to the top of the window, moves keyboard focus to the target page's `tabindex="-1"` heading, announces page changes to `#live-region`, and sets `aria-current="page"` on the active header navigation link.
  - Page navigation announcements and focus shifting occur strictly on navigation events, never during the initial page load.
- **Scoped Stepper Shortcuts**:
  - Global arrow-key stepping shortcuts (`ArrowLeft`, `ArrowRight`, `Home`, `End`) are active only when the Workbench page is visible.
  - The `?` shortcut opening the keyboard help modal dialog remains universally available across all pages.
- **Deferred Canvas Fit Calculation**:
  - When an expression is loaded via a deep link ending in `#validation` or `#stress`, `#page-workbench` is hidden and its container measures $0 \times 0$, which would corrupt zoom/pan fit computations.
  - Initial canvas fit and viewport calculation are deferred until `#page-workbench` is first revealed.
- **Validation Page Empty State**:
  - When no NFA is built, the Validation page displays an empty state banner with a "Go to Workbench" action button while hiding NFA-dependent cards.
  - The built-in 24-case regression suite remains fully operable independently of whether an NFA has been built.
- **Deep Links & Copy Link**:
  - The URL codec and Copy Link utility preserve the active page hash (e.g. `?regex=(a|b)*a#validation`).

### 2. Standardized Control Tokens & Grid Alignment

- **Design System Control Tokens (`:root`)**:
  - `--control-h: 36px`
  - `--control-h-touch: 44px`
  - `--control-pad-x: 10px`
  - `--control-font-size: 14px`
  - `--control-radius: var(--radius-sm)`
  - `--control-border: 1px solid var(--border-strong)`
- **Universal Form Control Application**:
  - All standard `input`, `select`, `button`, `.btn`, and `.btn-secondary` elements inherit `--control-h`, `--control-font-size`, and `box-sizing: border-box`.
  - `#regex-input` uses 16px monospace as the sole documented exception for legible regular expression editing, while strictly maintaining the 36px height and row alignment.
- **Standalone Insert Buttons**:
  - `#insert-eps` and `#insert-empty` are normal standalone buttons (`class="btn btn-secondary"`) at `--control-h`.
  - Nested 28px ghost buttons inside `#regex-input` are eliminated, ensuring all buttons satisfy the minimum 44x44 touch-target criteria on touchscreens.
- **Responsive Mobile & Touch Elevation**:
  - `@media (pointer: coarse), (max-width: 640px)` elevates `--control-h` to `--control-h-touch` (44px), automatically adapting all buttons, inputs, and selects for touch devices.
- **Dedicated In-Flow Error Row**:
  - `#alphabet-message` is positioned on its own grid row (`grid-column: 1 / -1; grid-row: 3;`) in `.input-strip`.
  - Collapses to 0 height when empty and renders cleanly in-flow when validation errors occur, preventing vertical overlapping or horizontal clipping.
- **Geometric Verification**:
  - Automated Playwright E2E assertions verify height, font size, and vertical center alignment within $\pm 1\text{px}$ across 6 standard viewports: 1440x900 (wide), 1280x800 (desktop), 1024x768 (laptop), 768x1024 (tablet), 640x480 (mobile landscape), and 390x844 (mobile portrait).

## Consequences

- **Positive**:
  - Clear user mental model separating construction, formal verification, and performance stress testing into dedicated views.
  - Seamless back/forward browser history and shareable URLs that preserve both configuration parameters and active page view.
  - Perfectly aligned, touch-friendly UI controls without layout jumping or truncated error messages.
  - Zero performance regression: benchmark runs continue uninterrupted in background tabs while browsing Workbench.
- **Negative / Neutral**:
  - Users navigating from Validation or Stress must switch back to Workbench to inspect the interactive canvas diagram.
  - Requires maintaining the pure `router.ts` module and geometry E2E tests across any future UI controls.
