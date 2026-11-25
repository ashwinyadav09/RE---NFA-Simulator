# RE → NFA (Thompson) Simulator

A high-assurance, interactive educational workbench and regular expression engine. Type any regular expression, watch Thompson's construction compile the $\varepsilon$-NFA step-by-step with stable Graphviz layout coordinates, simulate test strings with detailed $\varepsilon$-closure traces, and inspect formal invariant checks and differential oracles.

Packaged as a completely self-contained, single-file HTML application (`dist/index.html`) that runs 100% offline from local disk (`file://`) or any static web host with zero backend dependencies.

---

## Features

- **Interactive Thompson Construction**:
  - Step-by-step animation of NFA fragment synthesis for symbols, concatenation, alternation/union, Kleene star, plus, and optional operators.
  - Supports both canonical $\varepsilon$-link concatenation and state-merging concatenation.
  - Supports standard regex notation (`|`, `*`, `+`, `?`) and textbook notation (`+`, `*`, implicit concatenation).
  - Stable Graphviz layouts: node coordinates are pinned from the master layout so the diagram never jumps between construction steps.
- **Visual NFA & AST Exploration**:
  - Interactive SVG diagram canvas with hardware-accelerated pan, continuous wheel zoom, zoom-to-fit, and full-screen view.
  - Rich AST parse tree and postfix token timeline with synchronized visual scrubbing.
  - Full state transition table with active state highlighting during simulation.
- **Execution & Simulation Dock**:
  - Step-by-step string simulation displaying exact $\varepsilon$-closure sets after each input symbol.
  - Instant acceptance/rejection diagnostics with dead-state early termination.
  - Custom alphabet editor with automatic validation against expression symbols.
- **Formal Invariants & Self-Validation Panel (`#validation`)**:
  - Verifies structural invariants: $I_1$ (distinct start/accept), $I_2$ (no incoming transitions to start), $I_3$ (no outgoing transitions from accept), and $I_4$ (degree constraints).
  - Verifies state and transition counts against closed-form Thompson size formulas.
  - Verifies step-log replay reproducing final automata.
  - 24-case built-in regression test suite.
  - Differential testing against 3 independent oracles: string enumerator, Brzozowski derivatives, and JavaScript RegExp engine (running in an isolated Web Worker).
- **Polynomial vs Exponential Stress Benchmarks (`#stress`)**:
  - Live benchmark comparing Thompson NFA linear execution ($O(m \cdot n)$) against native JavaScript RegExp backtracking on pathological expressions (e.g. `(a*)*b`).
  - Interactive vector performance charts with linear and logarithmic scale toggles.
  - RFC 4180 CSV export and standalone chart SVG export.
- **Deep Linking & Sharing**:
  - Encodes complete application state (regex, notation, concatenation mode, test input, active step, view) in shareable URLs.
  - Safe sanitization against script injection with graceful handling of unknown query parameters.
- **Accessibility & Keyboard Navigation**:
  - Full keyboard shortcuts (`Enter` to build, arrows to step, canvas zoom/pan, `?` for shortcuts modal).
  - ARIA attributes, semantic roles, and polite live regions (`#live-region`) for screen reader announcements.

---

## Quickstart

### Prerequisites
- [Node.js](https://nodejs.org/) `>= 22.0.0`
- `npm`

### Installation & Verification

```bash
# Install dependencies
npm ci

# Run the complete quality gate (typecheck, unit tests, and production build)
npm run check

# Run end-to-end browser tests (headless Chromium over file://)
npm run test:e2e

# Run the canonical mutation test gate
npm run test:mutants
```

### Local Development & Preview

```bash
# Start local Vite development server
npm run dev

# Preview the built single-file bundle locally
npm run preview
```

---

## Project Structure

```
├── src/
│   ├── engine/           # Pure TypeScript core: lexer, parser, Thompson builder, simulation, invariants
│   ├── diagram/          # Graphviz DOT generator, layout coordinate pinner, SVG chart renderer
│   └── ui/               # View controllers (main, stress, validation, scrubber, viewport, router)
├── tests/
│   ├── fixtures/         # Canonical JSON test fixtures and worked examples
│   ├── engine.test.ts    # Unit tests at Engine seam
│   ├── diagram.test.ts   # Unit tests at Diagram seam
│   ├── properties.test.ts# Fast-Check property-based tests
│   ├── e2e.cjs           # Playwright end-to-end browser test suite (792 assertions)
│   ├── mutation-gate.cjs # Canonical 13-mutant engine mutation gate runner
│   └── ui-mutants.cjs    # UI behavior mutation runner
├── docs/
│   ├── ARCHITECTURE.md   # Architectural design, seams, and execution model
│   ├── SPEC.md           # Product specification and user stories
│   ├── BROWSER-CHECK.md  # Chromium target verification record
│   ├── history/          # Archived design documents, research reports, and tickets
│   └── adr/              # Architectural Decision Records (ADRs)
└── dist/
    └── index.html        # Production artifact: 100% self-contained single-file HTML bundle
```

For detailed architectural seams, data flows, and design decisions, see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Offline & Static Deployment

The production build (`dist/index.html`) is completely self-contained:
- All HTML, CSS, JavaScript, Web Workers, and Graphviz (Viz.js WASM) binaries are bundled into a single file.
- Works offline by double-clicking `dist/index.html` or opening via `file://`.
- Can be deployed directly to GitHub Pages, Cloudflare Pages, Netlify, Vercel, or any S3-compatible static storage bucket.

---

## Browser Support

Per [ADR 0002](docs/adr/0002-offline-single-file-build-inline-workers.md), the simulator targets modern **Chromium-based desktop browsers** (Google Chrome, Microsoft Edge, Brave, Opera):
- Automated E2E verification is executed against Chromium using Playwright over `file://`.
- For scope details and verification rationale, refer to [`docs/BROWSER-CHECK.md`](docs/BROWSER-CHECK.md).

---

## License

This project is licensed under the [MIT License](LICENSE).

Copyright (c) 2026 Ashwin Yadav.
