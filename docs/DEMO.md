# Evaluator Walkthrough: RE → NFA Simulator (10-Minute Demo)

This guide walks an evaluator through the core features of the simulator using verified inputs, exact clicks, and screen-verified state counts, transition numbers, active state sets, and test verdicts.

---

## 1. Quick Start & Initial Build (2 Minutes)

1. Open `dist/index.html` directly in Google Chrome or Microsoft Edge (via `file://` or any static HTTP server). No build server, backend, or network connection is required.
2. In the **Regular Expression** input (`#regex-input`), the default textbook pattern `(a|b)*abb` is pre-loaded.
3. Keep the defaults:
   - **Notation**: `Standard (| + ?)` (`#notation-select`)
   - **Concatenation mode**: `ε-link` (`#concat-select`)
4. Click **Build NFA** (`#build-button`) or press `Enter`:
   - **Status & Stats**: The stats display reports exactly **14 states** and **16 transitions** (`States: 14, Transitions: 16`).
   - **Start & Accept**: Start state is **6** (marked with incoming arrow), Accept state is **13** (double circle).
   - **Token List**: `[LPAREN@0] [SYMBOL(a)@1] [UNION@2] [SYMBOL(b)@3] [RPAREN@4] [STAR@5] [SYMBOL(a)@6] [SYMBOL(b)@7] [SYMBOL(b)@8]`
   - **Postfix View**: `a b UNION STAR a CONCAT b CONCAT b CONCAT` (10 postfix steps).
   - **Canvas**: Rendered with Graphviz (Viz.js) using left-to-right dot layout. Every state has stable coordinates.

---

## 2. Construction Stepper & Views (2 Minutes)

1. Use the stepper toolbar (`#step-first`, `#step-prev`, `#step-next`, `#step-last`, `#step-play`):
   - Notice the step counter reads `step 10 / 10` on initial build.
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
2. **Stable Layout**: As you step forward and backward, existing states do not jump or shift coordinates; new states appear smoothly at their pinned positions.
3. Switch **Concatenation mode** to `Merge` (`#concat-select`):
   - Click **Build NFA**: Stats now show **11 states** and **13 transitions**.
   - Concatenation merges exit and entry states without adding intermediate ε-transitions, leaving stable id gaps (ids 0–7, 9, 11, 13).
4. Switch back to `ε-link` mode and click **Build NFA** (14 states, 16 transitions).

---

## 3. String Simulation & ε-Closure Trace (2 Minutes)

1. In the **Test strings** textarea (`#test-input`), enter test string `abb`:
2. Click **Run Simulation** (`#run-button`):
   - **Verdict on `abb`**: `ACCEPT` (green badge).
   - **Trace**:
     - `String: "abb"`
     - `Initial: {0, 2, 4, 6, 7, 8}`
     - `After 'a': {0, 1, 2, 4, 5, 7, 8, 9, 10}`
     - `After 'b': {0, 2, 3, 4, 5, 7, 8, 11, 12}`
     - `After 'b': {0, 2, 3, 4, 5, 7, 8, 13}` $\to$ **ACCEPT** (accept state 13 is in the active set).
3. Test string `ab`:
   - Enter `ab` and click **Run**:
   - **Verdict on `ab`**: `REJECT` (red badge).
   - **Trace**:
     - `String: "ab"`
     - `Initial: {0, 2, 4, 6, 7, 8}`
     - `After 'a': {0, 1, 2, 4, 5, 7, 8, 9, 10}`
     - `After 'b': {0, 2, 3, 4, 5, 7, 8, 11, 12}` $\to$ **REJECT** (active set does not contain accept state 13).
4. Test empty string $\varepsilon$:
   - Clear `#test-input` to an empty string and click **Run**:
   - **Verdict on `""`**: `REJECT` (red badge).
   - **Trace**:
     - `String: ""`
     - `Initial: {0, 2, 4, 6, 7, 8}` $\to$ **REJECT** (initial closure does not contain accept state 13).
   - *(Note: typing `@` tests literal symbol `@`, which reports `Symbol '@' at position 0 outside alphabet`).*

---

## 4. Built-in Validation & Self-Verification (2 Minutes)

Click **Validation** in the header navigation (or navigate to `#validation`):

1. **Invariants Section**:
   - `inv-I1`: `PASS - I1 (Distinct Start & Accept): Passed: start state (6) and accept state (13) are distinct and valid`
   - `inv-I2`: `PASS - I2 (No Transition Enters Start): Passed: no transitions enter start state (6)`
   - `inv-I3`: `PASS - I3 (No Transition Leaves Accept): Passed: no transitions leave accept state (13)`
   - `inv-I4`: `PASS - I4 (State Degree Constraints): Passed: every state has either 1 symbol transition (0 ε) or 0 symbol and at most 2 ε-transitions`
   - `inv-size`: `PASS - Size Formula: Passed: 14 states and 16 transitions match the Thompson size formula (epsilon-link mode)`
   - `inv-replay`: `PASS - Step-log Replay: Passed: step-log replay reproduces final NFA states and transitions exactly`
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

Click **Stress** in the header navigation (or navigate to `#stress`):

1. The Stress page displays the benchmark controls, SVG chart, and results table.
2. Keep the default family: `(a*)*b on aⁿ` (`#stress-family` value `star-star-b`).
3. Click **Run stress test** (`#stress-run`):
   - Executes in a dedicated Web Worker without freezing the UI.
   - Runs comparison series $n \in [12, 14, 16, 18, 20, 22, 24, 26, 28, 30]$:
     - Thompson NFA simulation takes $\approx 0\text{ ms}$ (linear $O(n)$ time).
     - Backtracking RegExp time grows exponentially until hitting the **8 s timeout** (`8,000 ms`), where it is capped and marked `TIMEOUT`.
   - Runs NFA scaling series $n \in [50, 100, 200, 500, 1000]$ where Thompson NFA completes in linear time.
   - Status reports: `Stress test complete: NFA completed all inputs up to n = 1,000 in linear time.`
   - Click **Log scale** (`#stress-scale-toggle`) to inspect the SVG chart with logarithmic Y-axis.
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
   - In step view:
     - Click **Export SVG** (`#export-svg-btn`): downloads standalone `nfa-step-10-flat.svg` vector image.
   - Switch view mode to `Final NFA` (`#view-toggle`):
     - Click **Export SVG**: downloads `nfa-final.svg`.
3. **Deep Links**:
   - Click **Copy Link** (`#copy-link-btn`): copies the full shareable URL containing encoded query parameters (`?regex=(a|b)*abb&notation=standard&concat=epsilon...`).
   - Paste the link into a fresh browser tab: the complete state, notation, mode, and step position are restored exactly.
4. **Keyboard Shortcuts Help**:
   - Press `?` anywhere outside text inputs (or click the **Keyboard shortcuts** button `?` in the toolbar).
   - Modal dialog opens showing the 9 shortcuts (`Space` play/pause, `Left`/`Right` step, `+`/`-` zoom, `0` reset, `f` fit, `Esc` close).
   - Press `Esc` or click `✕` to close and return focus to the opener element.
