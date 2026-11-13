# 0009 Display-only numbering, removal of textbook view, and layout stability

Status: accepted, Nov 2026

## Context

During early development, the simulator provided two visual rendering modes for stepping through Thompson's construction:
1. **Flat view**: Directly laid out the live ε-NFA states and transitions at each operator step, using a master-layout pinning algorithm to preserve geometric state stability.
2. **Textbook view**: Rendered composite sub-boxes with input and output port nodes (representing sub-expressions) surrounded by new wrapper states, styled to emulate static textbook figures.
When expressions exceeded 150 postfix tokens, the app automatically disabled flat stepping and fell back to textbook view, before disabling diagrams entirely at 400 postfix tokens.

In practice and classroom user testing, this dual-rendering model exhibited several major issues:
- **Pedagogical confusion**: Students found the composite sub-box abstraction jarring and disconnective compared to seeing the actual underlying states and transitions grow step by step.
- **Architectural complexity & dual-engine drift**: Maintaining two distinct Graphviz DOT generation pathways (`toDot` and `toTextbookDot`) created maintenance overhead, edge-label overlap defects (Graphviz port routing edge cases), and a complex two-tiered threshold system (150 vs 400 tokens).
- **View-toggle layout shift**: Switching between stepping view and "Final NFA" view caused severe layout shift in the stepper toolbar across viewports. The `#step-counter` element expanded from 80px to over 280px to display detailed text (`Final NFA (10 states, 12 transitions)`), forcing surrounding controls and the scrubber to wrap or jump by up to 200px.
- **Redundant Export DOT**: The `#export-dot-btn` allowed downloading raw Graphviz DOT source text. Instructors and students needed vector graphics (SVG) for lecture slides and assignments, not raw DOT text. Exposing two export buttons cluttered the canvas toolbar.

All modifications were subject to core project invariants:
- The pure TypeScript engine seam (`src/engine/`) must remain byte-identical (0 bytes diff against commit `b87339c`). Note that `notation: 'textbook'` (representing `+` as union syntax from Ticket 06) and `CAPS.textbookStepping` (400 limit) reside in the engine and remain untouched.
- Static single-file offline distribution (`dist/index.html`).
- Zero external runtime dependencies, zero network requests.
- Zero layout shift ($\le \pm 0.5\text{px}$) across all six target viewports (1920×1080, 1440×900, 1280×800, 1024×768, 768×1024, 390×844).

## Decision

### 1. Complete Removal of Textbook View
- **Two Visual Views**:
  - The `#view-toggle` dropdown now offers exactly two options: `<option value="flat">NFA</option>` (step-by-step construction) and `<option value="final">Final NFA</option>` (complete machine with simulation state overlays).
- **Elimination of Composite Box Generator**:
  - Removed `toTextbookDot` and `escapeRecordLabel` from `src/diagram/index.ts`. All diagram generation now flows through the unified, pinned `toDot` pipeline.
- **Simplified Diagram Caps**:
  - The diagram cap mode is simplified from `'flat' | 'textbook' | 'off'` to `'flat' | 'off'`.
  - Expressions with $\le 400$ postfix tokens support full NFA stepping and Final NFA rendering. Expressions exceeding 400 postfix tokens display a clear notice while keeping the transition table, simulation test dock, and validation suites fully active. The 150-token warning bar and fallback were eliminated.
- **Backward-Compatible URL Decoding**:
  - In `src/ui/url.ts`, legacy deep links and stored settings containing `view=textbook` are mapped to `view: 'flat'` ("NFA") without throwing errors or displaying spurious warning notices.

### 2. View-Toggle Layout Stability ($\pm 0.5\text{px}$)
- **Stable Counter Geometry**:
  - In `index.html`, `#step-counter` is assigned strict, fixed-width flexbox styles: `width: 80px; min-width: 80px; max-width: 80px; flex: 0 0 80px; box-sizing: border-box; text-align: center; overflow: hidden; text-overflow: ellipsis;`.
- **Concise Labeling in Final NFA View**:
  - In Final NFA view, `#step-counter` displays the concise label `Final NFA`. Detailed state and transition counts are surfaced in the element's accessible `title` tooltip (e.g. `Final NFA (10 states, 12 transitions)`).
- **Persistent Stepper Controls**:
  - Inapplicable stepper controls (`#step-first`, `#step-prev`, `#step-play`, `#step-next`, `#step-last`, `#step-scrubber`, `#step-speed`) are never hidden (`display: none`) in Final NFA view. Instead, they remain mounted with `aria-disabled="true"` and an informative title (`Switch to NFA view to step through construction`).
  - This guarantees that relative bounding box coordinates for all controls in `#stepper-controls` match between "NFA" and "Final NFA" with a measured drift of **0.00px** across all six responsive viewports.

### 3. Removal of Export DOT & Preservation of Standalone Export SVG
- **Export DOT Removal**:
  - `#export-dot-btn` was removed from `index.html`.
  - All button references, click handlers, and disabled state manipulations were removed from `src/ui/main.ts`.
  - `getExportFilename` in `src/ui/export.ts` now produces SVG filenames only (`nfa-step-<k>.svg` or `nfa-final.svg`).
  - Repository search confirms zero matches for `export.dot` or `export-dot` outside of historic ADRs and completed issue records.
- **Retaining `DotExporter` for Viz.js**:
  - `toDot` remains fully intact in `src/diagram/index.ts` to supply DOT text directly to the in-memory Viz.js renderer.
- **Standalone Export SVG**:
  - Exported SVG files retain computed styling inlining, opaque white background rects, and on-screen text labels, ensuring that downloaded SVGs render identically when opened standalone in a fresh browser tab or inserted into presentations.

## Consequences

- **Pedagogical Clarity**: Students observe a single, consistent Thompson construction visualization that grows one operator at a time, reinforcing mental models taught in formal language theory.
- **Rock-Solid Visual Stability**: Toggling between stepping and final views produces zero layout shift across mobile, tablet, and desktop screens.
- **Streamlined User Interface**: The canvas toolbar presents a single, focused "Export SVG" action for vector diagram downloads.
- **Maintainability**: Substantially reduces presentation code surface area while preserving 100% backward compatibility for existing URLs.
