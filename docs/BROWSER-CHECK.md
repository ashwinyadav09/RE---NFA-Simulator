# Browser Compatibility Checklist

This document tracks browser compatibility verification for the standalone single-file RE → NFA simulator (`dist/index.html`) loaded directly over `file://` with no network connection.

## Browser Support Status

| Browser | Environment / Version | Verification Method | Status / Result | Notes |
| --- | --- | --- | --- | --- |
| **Chromium** | Chrome 133 / Chromium (Playwright 1.50) | Automated smoke (`npm run e2e`) & headed walkthrough | PASS | Verified over `file://`: inline worker, Viz.js SVG layout, presets, keyboard, live region, validation suite, differential oracle test, stress test. |
| **Firefox** | — | — | Not checked (out of scope, owner decision: Chromium only) | Owner decision (8 Nov 2026): Chromium is the only supported browser; no Firefox check will be done. |
| **Safari** | macOS / iOS WebKit | — | Safari: best effort, not verified | Per project specification: Safari is best effort, not verified. |
