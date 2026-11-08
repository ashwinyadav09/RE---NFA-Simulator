# Browser Compatibility Checklist

This document tracks browser compatibility verification for the standalone single-file RE → NFA simulator (`dist/index.html`) loaded directly over `file://` with no network connection.

## Browser Support Status

| Browser | Environment / Version | Verification Method | Status / Result | Notes |
| --- | --- | --- | --- | --- |
| **Chromium** | Chrome 133 / Chromium (Playwright 1.50) | Automated smoke (`npm run e2e`) & headed walkthrough | PASS | Verified over `file://`: inline worker, Viz.js SVG layout, presets, keyboard, live region, validation suite, differential oracle test, stress test. |
| **Firefox** | Current Firefox release | Manual check over `file://` | | *To be filled in by evaluator.* |
| **Safari** | macOS / iOS WebKit | — | Safari: best effort, not verified | Per project specification: Safari is best effort, not verified. |

## Evaluator Manual Check Procedure for Firefox

1. Build the production bundle: `npm run build`
2. Open `dist/index.html` directly in Firefox using `file:///.../dist/index.html` (with network disabled if desired).
3. Verify:
   - Page loads cleanly with no console errors (`F12` Console).
   - Presets dropdown loads and builds expressions without errors.
   - Stepper navigates through construction steps with pinned layout.
   - String simulation runs and traces ε-closures.
   - Built-in validation suite and differential test execute via inline worker.
   - Stress test runs and cancellation works smoothly.
4. Record verdict in the table above.
