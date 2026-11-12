# Evaluator Walkthrough: RE → NFA Simulator (10-Minute Demo)

This guide walks an evaluator through the core features of the simulator using verified inputs, exact clicks, and screen-verified state counts, transition numbers, and test verdicts.

---

## 1. Quick Start & Initial Build (2 Minutes)

1. Open `dist/index.html` directly in Google Chrome or Microsoft Edge (via `file://` or any static HTTP server). No build server, backend, or network connection is required.
2. In the **Regular Expression** input (`#regex-input`), the default textbook pattern `(a|b)*abb` is pre-loaded.
3. Keep the defaults:
   - **Notation**: `Standard (| + ?)` (`#notation-select`)
   - **Concatenation mode**: `ε-link` (`#concat-select`)
4. Click **Build NFA** (`#build-button`) or press `Enter`:
   - **Status & Stats**: The stats display reports exactly **14 states** and **16 transitions**.
   - **Start & Accept**: Start state is **6** (marked with incoming arrow), Accept state is **13** (double circle).
   - **Token List**: `(`, `a`, `|`, `b`, `)`, `*`, `a`, `b`, `b`
   - **Postfix View**: `a b | * a . b . b .` (10 postfix tokens / steps).
   - **Canvas**: Rendered with Graphviz (Viz.js) using left-to-right dot layout. Every state has stable coordinates.

---

## 2. Construction Stepper & Views (2 Minutes)

1. Use the stepper toolbar (`#step-prev`, `#step-next`, `#step-play`):
   - Notice the step counter reads `10 / 10` on initial build.
   - Click **Prev** (`#step-prev`) or press `Left Arrow` repeatedly to step backwards:
     - **Step 1/10**: Symbol `a` creates states 0 → 1.
     - **Step 2/10**: Symbol `b` creates states 2 → 3.
     - **Step 3/10**: Union `|` creates states 4 (split) and 5 (join) with 4 ε-transitions: 4→0, 4→2, 1→5, 3→5.
     - **Step 4/10**: Star `*` wraps with states 6 and 7: 6→4, 5→7, 5→4 (loopback), 6→7 (bypass).
     - **Step 5/10**: Symbol `a` creates states 8 → 9.
     - **Step 6/10**: Concatenation `.` links state 7 → 8 with ε-transition.
     - **Step 7/10**: Symbol `b` creates states 10 → 11.
     - **Step 8/10**: Concatenation `.` links state 9 → 10.
     - **Step 9/10**: Symbol `b` creates states 12 → 13.
     - **Step 10/10**: Concatenation `.` links state 11 → 12.
2. **Stable Layout**: Notice that as you step forward and backward, existing states do not jump or shift coordinates; new states appear smoothly at their pinned positions.
3. Switch **Concatenation mode** to `Merge` (`#concat-select`):
   - Click **Build NFA**: Stats now show **11 states** and **13 transitions**.
   - Notice that concatenation merges exit and entry states without adding intermediate ε-transitions, leaving stable id gaps (ids 0–7, 9, 11, 13).
4. Switch back to `ε-link` mode and click **Build NFA** (14 states, 16 transitions).

---

## 3. String Simulation & ε-Closure Trace (2 Minutes)

1. In the **Test strings** textarea (`#test-input`), enter the following three lines:
   ```text
   abb
   ab
   ε
   ```
   *(Note: type `@` or `ε` for empty string, or leave an empty line).*
2. Click **Run Simulation** (`#run-button`):
   - **Verdict on `abb`**: `ACCEPT` (green badge).
   - **Trace**: Click the row or inspect the trace log:
     - Initial state set $S_0 = \text{closure}(6) = \{0, 2, 4, 6, 7\}$.
     - Consume `a`: transitions on `a` lead from state 0 to 1, followed by ε-closure $\to \{1, 5, 4, 7, 0, 2, 8, 9\}$.
     - Consume `b`: transitions on `b` from state 2 and 9 lead to $\to \{10, 11\}$.
     - Consume `b`: transitions on `b` from state 11 lead to $\to \{12, 13\}$. Accept state 13 is in the active set $\to$ **ACCEPT**.
   - **Verdict on `ab`**: `REJECT` (red badge, final active set $\{11\}$ does not contain accept state 13).
   - **Verdict on `ε`**: `REJECT` (initial closure does not contain 13).

---

## 4. Built-in Validation & Self-Verification (2 Minutes)

Scroll down to the **Self-Validation Panel**:

1. **Invariants Section**:
   - `I1 (Single start state, in-degree 0)`: **PASS** (green).
   - `I2 (Single accept state, out-degree 0)`: **PASS** (green).
   - `I3 (Deterministic symbol transitions, max 2 ε-exits)`: **PASS** (green).
   - `I4 (Acyclic without star operators)`: **PASS** (green).
   - `Size formula check` ($|S|=14, |T|=16$ matches formula): **PASS** (green).
   - `Step log replay check`: **PASS** (green).
2. **Built-in Suite** (`#run-suite`):
   - Click **Run suite**:
   - All **24 pre-configured test expressions** run against three independent oracles (derivative oracle, enumerator oracle, and JavaScript RegExp oracle).
   - The suite table displays **24 / 24 PASSED** with zero mismatches.
3. **Differential Random Testing** (`#diff-run`):
   - Click **Run differential**:
   - Tests automatically over all strings up to length $k = 8$.
   - Status line displays: `Differential test completed for k = 8 (511 strings tested): ALL PASSED`.

---

## 5. Stress Testing & Polynomial vs Exponential Comparison (1 Minute)

1. Scroll to the **Stress Testing** section (`#stress-panel`).
2. Keep the default family: `nested-star` (`(a*)*b` tested against $a^n$).
3. Click **Run stress test** (`#stress-run`):
   - Runs $n = 1$ to $10$ in a dedicated Web Worker without freezing the main thread.
   - For each $n$: Thompson NFA simulation takes $\approx 0\text{ ms}$ (linear $O(n)$ time), while backtracking RegExp time grows rapidly.
   - Click **Log scale** (`#stress-scale-toggle`) to inspect the SVG chart in logarithmic scaling.
   - Click **Copy CSV** (`#stress-copy-csv`) to copy table results to clipboard.
   - Click **Export SVG** (`#stress-export-svg`) to download `stress-chart.svg`.

---

## 6. Canvas Controls, Exports, Shortcuts & Deep Links (1 Minute)

1. **Canvas Zoom & Pan**:
   - Click **+** (`#zoom-in-btn`) to zoom in to 125%, 150%.
   - Click **Fit** (`#zoom-fit-btn`) to fit the diagram to canvas boundaries.
   - Click **100%** (`#zoom-reset-btn`) to return to 1:1 scale.
   - Drag anywhere inside `#canvas` to pan, or use `Shift + Arrow` keys.
2. **Export Diagram**:
   - Click **Export DOT** (`#export-dot-btn`): downloads `nfa.dot` containing complete Graphviz DOT syntax with node ids and pinned layout coordinates.
   - Click **Export SVG** (`#export-svg-btn`): downloads the standalone `nfa.svg` vector image.
3. **Deep Links**:
   - Click **Copy Link** (`#copy-link-btn`): copies the full shareable URL containing encoded query parameters (`?regex=(a|b)*abb&notation=standard&concat=epsilon...`).
   - Paste the link into a new browser tab: the complete state, notation, mode, and step position are restored exactly.
4. **Keyboard Shortcuts Help**:
   - Press `?` anywhere outside text inputs (or click the **Keyboard shortcuts** button `?` in the toolbar).
   - The modal dialog opens showing the full keyboard reference (`Space` play/pause, `Left`/`Right` step, `+`/`-` zoom, `0` reset, `f` fit).
   - Press `Esc` or click `✕` to close and return focus to the opener.
