#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function getGitStatus() {
  const raw = execSync('git status --porcelain', { encoding: 'utf8' }).trim();
  if (!raw) return '';
  return raw
    .split('\n')
    .filter((l) => l.trim() && !l.includes('tests/ui-mutants.cjs') && !l.includes('.scratch/'))
    .join('\n')
    .trim();
}

function runCommand(cmd) {
  try {
    const stdout = execSync(cmd, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env
    });
    return { ok: true, output: stdout, code: 0 };
  } catch (err) {
    const combined = (err.stdout || '') + '\n' + (err.stderr || '');
    return { ok: false, output: combined, code: err.status || 1 };
  }
}

const UNIT_TESTED_FILES = new Set([
  'src/ui/viewport.ts',
  'src/ui/csv.ts',
  'src/ui/export.ts',
  'src/ui/url.ts',
  'src/diagram/index.ts'
]);

function stripAnsi(str) {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

function parseFirstFailure(rawOutput) {
  const output = stripAnsi(rawOutput);
  const lines = output.split('\n');
  let firstMsg = '';
  let firstLocation = '';

  // 1. Vitest failure detection
  const failIdx = lines.findIndex(l => l.trim().startsWith('FAIL ') || l.trim().startsWith('FAIL\t'));
  if (failIdx !== -1) {
    for (let i = failIdx + 1; i < lines.length; i++) {
      const sub = lines[i].trim();
      if (!firstMsg && (sub.startsWith('AssertionError:') || sub.startsWith('Error:'))) {
        firstMsg = sub;
      }
      if (!firstLocation) {
        const locMatch = sub.match(/(?:❯|\bat)\s+([a-zA-Z0-9_./\\-]+\.[a-zA-Z0-9]+:\d+(?::\d+)?)/);
        if (locMatch) {
          firstLocation = locMatch[1].replace(/\\/g, '/');
        }
      }
      if (firstMsg && firstLocation) break;
    }
    if (firstMsg) {
      return { message: firstMsg, location: firstLocation || 'unknown' };
    }
  }

  // 2. Playwright E2E test failure detection
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('E2E test failed:') || line.includes('AssertionError') || line.includes('ERR_ASSERTION')) {
      firstMsg = line.trim();
      for (let j = i + 1; j < Math.min(i + 15, lines.length); j++) {
        const stackLine = lines[j].trim();
        const m = stackLine.match(/(?:at\s+.*?\s+\()?([a-zA-Z0-9_./\\-]+\.[a-zA-Z0-9]+:\d+(?::\d+)?)\)?/);
        if (m) {
          firstLocation = m[1].replace(/\\/g, '/');
          break;
        }
      }
      break;
    }
  }

  // 3. General fallback
  if (!firstMsg) {
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim();
      if ((l.includes('Error:') || l.includes('FAIL')) && !l.includes('Layout note') && !l.includes('ORACLE ERROR')) {
        firstMsg = l;
        for (let j = i + 1; j < Math.min(i + 15, lines.length); j++) {
          const stackLine = lines[j].trim();
          const m = stackLine.match(/(?:at\s+.*?\s+\()?([a-zA-Z0-9_./\\-]+\.[a-zA-Z0-9]+:\d+(?::\d+)?)\)?/);
          if (m) {
            firstLocation = m[1].replace(/\\/g, '/');
            break;
          }
        }
        break;
      }
    }
  }

  return { message: firstMsg || 'Unknown failure', location: firstLocation || 'unknown' };
}

async function main() {
  const initialStatus = getGitStatus();
  if (initialStatus) {
    console.error('ERROR: git status --porcelain must be clean before running mutants.');
    console.error(initialStatus);
    process.exit(1);
  }

  const mutants = [
    // Two self-test controls
    {
      id: 'CTRL-SURVIVE',
      desc: 'Control: No-op comment added (must SURVIVE)',
      file: 'src/ui/main.ts',
      find: 'const WHEEL_ZOOM_K = 0.0015;',
      replace: 'const WHEEL_ZOOM_K = 0.0015; // no-op',
      expect: 'should not fail',
      isControl: true
    },
    {
      id: 'CTRL-WRONG-KILLER',
      desc: 'Control: Wrong expect string on real failure (must be WRONG-KILLER)',
      file: 'src/ui/main.ts',
      find: 'const focal = { x: e.clientX - rect.left, y: e.clientY - rect.top };',
      replace: 'const focal = { x: e.clientX, y: e.clientY };',
      expect: 'NONEXISTENT_ASSERTION_EXPECT_STRING',
      isControl: true
    },
    // Seeded Ticket 17 mutants
    {
      id: 'T17-M1',
      desc: 'T17 sameFrame constant true',
      file: 'src/ui/viewport.ts',
      find: '  return p === n;',
      replace: '  return true;',
      expect: 'expected true to be false'
    },
    {
      id: 'T17-M2',
      desc: 'T17 AC5 zoom-in transform omitted',
      file: 'src/ui/main.ts',
      find: '    currentViewport = zoomAt(currentViewport, 1.2, center, limits);\n    applyViewport();',
      replace: '    currentViewport = zoomAt(currentViewport, 1.2, center, limits);',
      expect: 'State node center must move as predicted by zoom math'
    },
    {
      id: 'T17-M3',
      desc: 'T17 AC7 frame offset ignored on wheel zoom',
      file: 'src/ui/main.ts',
      find: 'const focal = { x: e.clientX - rect.left, y: e.clientY - rect.top };',
      replace: 'const focal = { x: e.clientX, y: e.clientY };',
      expect: 'Ctrl+wheel focal point X must keep node center within 1 px'
    },
    {
      id: 'T17-M4',
      desc: 'T17 AC9 always persist in textbook view',
      file: 'src/ui/main.ts',
      find: 'if (sameFrame(currentViewBox, newViewBox)) {',
      replace: "if (sameFrame(currentViewBox, newViewBox) || currentView === 'textbook') {",
      expect: 'Switching to textbook view with different viewBox must apply initial view'
    },
    {
      id: 'T17-M5',
      desc: 'T17 AC10 skip reset on rebuild',
      file: 'src/ui/main.ts',
      find: '  currentViewBox = null;\r\n  const gen = ++buildGeneration;',
      altFind: '  currentViewBox = null;\n  const gen = ++buildGeneration;',
      replace: '  const gen = ++buildGeneration;',
      expect: 'Rebuild must reset viewport to fit mode'
    },
    {
      id: 'T17-M6',
      desc: 'T17 AC11 plain ArrowRight on canvas intercepted',
      file: 'src/ui/main.ts',
      find: "    } else if (e.key === 'f' || e.key === 'F') {\n      e.preventDefault();\n      if (zoomFitBtn && !zoomFitBtn.disabled) zoomFitBtn.click();\n    }",
      replace: "    } else if (e.key === 'f' || e.key === 'F') {\n      e.preventDefault();\n      if (zoomFitBtn && !zoomFitBtn.disabled) zoomFitBtn.click();\n    } else if (!e.shiftKey && e.key === 'ArrowRight') {\n      e.stopPropagation();\n    }",
      expect: 'Plain ArrowRight must step construction'
    },
    // Ticket 18 Mutants (T18-ACn-x)
    // AC1: CSV
    {
      id: 'T18-AC1-1',
      desc: 'AC1: CSV header typo',
      file: 'src/ui/csv.ts',
      find: "    'string_length',",
      replace: "    'string_len',",
      expect: 'string_length'
    },
    {
      id: 'T18-AC1-2',
      desc: 'AC1: TIMEOUT and SKIPPED verdicts swapped',
      file: 'src/ui/csv.ts',
      find: '    const regExpVerdict = row.regExpVerdict;',
      replace: "    const regExpVerdict = row.regExpVerdict === 'TIMEOUT' ? 'SKIPPED' : row.regExpVerdict === 'SKIPPED' ? 'TIMEOUT' : row.regExpVerdict;",
      expect: 'TIMEOUT'
    },
    {
      id: 'T18-AC1-3',
      desc: 'AC1: regexp_time_ms printed (not empty) for timeout',
      file: 'src/ui/csv.ts',
      find: "      row.regExpVerdict === 'TIMEOUT' ||",
      replace: "      // row.regExpVerdict === 'TIMEOUT' ||",
      expect: '8000.0'
    },
    {
      id: 'T18-AC1-4',
      desc: 'AC1: trailing CRLF omitted in CSV',
      file: 'src/ui/csv.ts',
      find: "  return lines.join('');",
      replace: "  return rows.length > 0 ? lines.join('').slice(0, -2) : lines.join('');",
      expect: 'expected 4 to be 5'
    },

    // AC2: Log math
    {
      id: 'T18-AC2-1',
      desc: 'AC2: floor clamp uses Math.min instead of Math.max',
      file: 'src/diagram/index.ts',
      find: '      const clamped = Math.max(0.01, Math.min(ms, 8000));',
      replace: '      const clamped = Math.min(0.01, Math.min(ms, 8000));',
      expect: 'expected 265 to be less than 265'
    },
    {
      id: 'T18-AC2-2',
      desc: 'AC2: scale ignored (linear ticks drawn in log mode)',
      file: 'src/diagram/index.ts',
      find: "  // Grid lines & Y ticks for Panel A\n  if (scale === 'log') {",
      replace: "  // Grid lines & Y ticks for Panel A\n  if (false && scale === 'log') {",
      expect: '≤0.01 ms'
    },
    {
      id: 'T18-AC2-3',
      desc: 'AC2: timeout marker not at panel top in log mode',
      file: 'src/diagram/index.ts',
      find: 'lines.push(`  <g id="panelA-timeout" transform="translate(${x.toFixed(1)}, ${panelA.top.toFixed(1)})">`);',
      replace: 'lines.push(`  <g id="panelA-timeout" transform="translate(${x.toFixed(1)}, ${(scale === \'log\' ? panelA.top + 50 : panelA.top).toFixed(1)})">`);',
      expect: 'id="panelA-timeout"'
    },

    // AC3: Retention
    {
      id: 'T18-AC3-1',
      desc: 'AC3: rows cleared on cancel',
      file: 'src/ui/main.ts',
      find: '    stressCancelled = true;',
      replace: '    stressCancelled = true;\n    currentStressRows = [];',
      expect: 'Stress chart must retain points across scale toggle'
    },
    {
      id: 'T18-AC3-2',
      desc: 'AC3: toggle re-renders from an empty array',
      file: 'src/ui/main.ts',
      find: "    stressScaleToggleBtn.setAttribute('aria-pressed', String(currentStressScale === 'log'));\n    updateStressChart();",
      replace: "    stressScaleToggleBtn.setAttribute('aria-pressed', String(currentStressScale === 'log'));\n    updateStressChart();\n    stressChartContainer.innerHTML = renderStressChartSvg([], { scale: currentStressScale });",
      expect: 'Stress chart must retain points across scale toggle'
    },

    // AC4: Toggle
    {
      id: 'T18-AC4-1',
      desc: 'AC4: scale reset to linear on family change',
      file: 'src/ui/main.ts',
      find: "const stressFamilySelect = document.getElementById('stress-family') as HTMLSelectElement | null;",
      replace: "const stressFamilySelect = document.getElementById('stress-family') as HTMLSelectElement | null;\nif (stressFamilySelect) stressFamilySelect.addEventListener('change', () => { currentStressScale = 'linear'; updateStressChart(); });",
      expect: 'Chart scale must stay log after family change'
    },
    {
      id: 'T18-AC4-2',
      desc: 'AC4: scale reset to linear on a new run',
      file: 'src/ui/main.ts',
      find: '    currentStressRows = [];',
      replace: "    currentStressRows = []; currentStressScale = 'linear';",
      expect: 'Chart scale must stay log on new run'
    },
    {
      id: 'T18-AC4-3',
      desc: 'AC4: label text swaps to "Linear scale"',
      file: 'src/ui/main.ts',
      find: "    stressScaleToggleBtn.setAttribute('aria-pressed', String(currentStressScale === 'log'));",
      replace: "    stressScaleToggleBtn.setAttribute('aria-pressed', String(currentStressScale === 'log')); stressScaleToggleBtn.textContent = currentStressScale === 'log' ? 'Linear scale' : 'Log scale';",
      expect: 'Toggle button label must remain stable as "Log scale"'
    },

    // AC6: Copy equals table
    {
      id: 'T18-AC6-1',
      desc: 'AC6: CSV drops the last row',
      file: 'src/ui/csv.ts',
      find: '  for (const row of rows) {',
      replace: '  for (const row of rows.slice(0, -1)) {',
      expect: 'expected 4 to be 5'
    },
    {
      id: 'T18-AC6-2',
      desc: 'AC6: two CSV columns swapped',
      file: 'src/ui/csv.ts',
      find: '      escapeCsvField(regExpTime),\n      escapeCsvField(nfaTime),',
      replace: '      escapeCsvField(nfaTime),\n      escapeCsvField(regExpTime),',
      expect: '0.12,0.8'
    },
    {
      id: 'T18-AC6-3',
      desc: 'AC6: CSV family column missing',
      file: 'src/ui/csv.ts',
      find: "  const header = [\n    'family',",
      replace: '  const header = [',
      expect: 'family,n,string_length'
    },
    {
      id: 'T18-AC6-4',
      desc: 'AC6: Copy not disabled at 0 rows',
      file: 'src/ui/main.ts',
      find: '    stressCopyCsvBtn.disabled = !hasRows;',
      replace: '    stressCopyCsvBtn.disabled = false;',
      expect: '#stress-copy-csv must initially be disabled'
    },
    {
      id: 'T18-AC6-5',
      desc: 'AC6: Copy disabled mid-run after the first row',
      file: 'src/ui/main.ts',
      find: '    stressCopyCsvBtn.disabled = !hasRows;',
      replace: '    stressCopyCsvBtn.disabled = stressIsActive || !hasRows;',
      expect: '#stress-copy-csv must be re-enabled once rows are added mid-run'
    },
    {
      id: 'T18-AC6-6',
      desc: 'AC6: new run does not clear rows or re-disable buttons',
      file: 'src/ui/main.ts',
      find: '    stressIsActive = true;\n    currentStressRows = [];\n    updateStressActionButtons();',
      replace: '    stressIsActive = true;\n    // currentStressRows = [];\n    // updateStressActionButtons();',
      expect: '#stress-copy-csv must be disabled when run starts with 0 rows'
    },

    // AC7: Feedback
    {
      id: 'T18-AC7-1',
      desc: 'AC7: 2 s clear timer omitted',
      file: 'src/ui/main.ts',
      find: "  const timer = setTimeout(() => {\n    if (statusEl) {\n      statusEl.textContent = '';\n      statusEl.removeAttribute('data-copied');\n    }\n    setActiveTimer(null);\n  }, durationMs);",
      replace: '  // 2 s clear timer omitted',
      expect: 'Timeout'
    },
    {
      id: 'T18-AC7-2',
      desc: 'AC7: execCommand fallback omitted',
      file: 'src/ui/main.ts',
      find: "  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {\n    try {\n      await navigator.clipboard.writeText(text);\n      return true;\n    } catch {\n      // Fallback to execCommand\n    }\n  }",
      replace: "  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {\n    try {\n      await navigator.clipboard.writeText(text);\n      return true;\n    } catch {\n      return false;\n    }\n  }",
      expect: 'Copy fallback must succeed via execCommand when writeText rejects'
    },
    {
      id: 'T18-AC7-3',
      desc: 'AC7: "Copy failed" path omitted',
      file: 'src/ui/main.ts',
      find: "  } else {\n    statusEl.textContent = failureText;",
      replace: '  } else {\n    // "Copy failed" path omitted',
      expect: 'Status must show Copy failed when both writeText and execCommand fail'
    },
    {
      id: 'T18-AC7-4',
      desc: 'AC7: a write to #live-region added',
      file: 'src/ui/main.ts',
      find: "  if (success) {\n    statusEl.textContent = successText;",
      replace: "  if (success) {\n    statusEl.textContent = successText;\n    const lr = document.getElementById('live-region'); if (lr) lr.textContent = 'Copied!';",
      expect: 'Copy action must not write to #live-region'
    },

    // AC8: SVG export
    {
      id: 'T18-AC8-1',
      desc: 'AC8: xmlns omitted in SVG export',
      file: 'src/diagram/index.ts',
      find: '  lines.push(`<svg viewBox="0 0 ${width} ${height}" ${widthAttr} height="${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapedTitle}">`);',
      replace: '  lines.push(`<svg viewBox="0 0 ${width} ${height}" ${widthAttr} height="${height}" role="img" aria-label="${escapedTitle}">`);',
      expect: 'xmlns="http://www.w3.org/2000/svg"'
    },
    {
      id: 'T18-AC8-2',
      desc: 'AC8: a.click omitted on export',
      file: 'src/ui/main.ts',
      find: '    a.click();',
      replace: '    // a.click();',
      expect: 'Timeout 30000ms exceeded while waiting for event "download"'
    },
    {
      id: 'T18-AC8-3',
      desc: 'AC8: wrong width/height in SVG export',
      file: 'src/diagram/index.ts',
      find: "  const widthAttr = standalone ? `width=\"${width}\"` : 'width=\"100%\"';\n  lines.push(`<svg viewBox=\"0 0 ${width} ${height}\" ${widthAttr} height=\"${height}\"",
      replace: "  const widthAttr = standalone ? 'width=\"999\"' : 'width=\"100%\"';\n  lines.push(`<svg viewBox=\"0 0 ${width} ${height}\" ${widthAttr} height=\"${height}\"",
      expect: '<svg viewBox="0 0 760 320" width="760"'
    },
    {
      id: 'T18-AC8-4',
      desc: 'AC8: export ignores current scale (content stays linear)',
      file: 'src/ui/main.ts',
      find: '        scale: currentStressScale,',
      replace: "        scale: 'linear',",
      expect: 'Exported log SVG must include (log scale)'
    },
    {
      id: 'T18-AC8-5',
      desc: 'AC8: export enabled at 0 rows',
      file: 'src/ui/main.ts',
      find: '    stressExportSvgBtn.disabled = !hasRows;',
      replace: '    stressExportSvgBtn.disabled = false;',
      expect: '#stress-export-svg must initially be disabled'
    },
    {
      id: 'T18-AC8-6',
      desc: 'AC8: background rect omitted in SVG export',
      file: 'src/diagram/index.ts',
      find: '  lines.push(`  <rect width="${width}" height="${height}" fill="#fafafa" rx="6" />`);',
      replace: '  // background rect omitted',
      expect: '<rect width="760" height="320"'
    },

    // Ticket 18b Mutants (T18b-1 through T18b-6)
    {
      id: 'T18b-1',
      desc: 'T18b-1: table uses toFixed(2) for RegExp time (CSV unchanged)',
      file: 'src/ui/main.ts',
      find: '      ? `${formatRegExpTime(row.regExpTimeMs)} ms`',
      replace: '      ? `${row.regExpTimeMs.toFixed(2)} ms`',
      testType: 'e2e',
      expect: 'CSV RegExp time must match table RegExp time'
    },
    {
      id: 'T18b-2',
      desc: 'T18b-2: CSV uses toFixed(2) for RegExp time (table unchanged)',
      file: 'src/ui/csv.ts',
      find: '        : formatRegExpTime(row.regExpTimeMs);',
      replace: '        : row.regExpTimeMs.toFixed(2);',
      testType: 'e2e',
      expect: 'CSV RegExp time must match table RegExp time'
    },
    {
      id: 'T18b-3',
      desc: 'T18b-3: CSV omits the last row (tested via E2E equality)',
      file: 'src/ui/csv.ts',
      find: '  for (const row of rows) {',
      replace: '  for (const row of rows.slice(0, -1)) {',
      testType: 'e2e',
      expect: 'CSV data row count must equal table row count'
    },
    {
      id: 'T18b-4',
      desc: 'T18b-4: two CSV columns swapped (tested via E2E equality)',
      file: 'src/ui/csv.ts',
      find: '      escapeCsvField(regExpTime),\n      escapeCsvField(nfaTime),',
      replace: '      escapeCsvField(nfaTime),\n      escapeCsvField(regExpTime),',
      testType: 'e2e',
      expect: 'CSV RegExp time must match table RegExp time'
    },
    {
      id: 'T18b-5',
      desc: 'T18b-5: comma field not wrapped in quotes',
      file: 'src/ui/csv.ts',
      find: "  if (val.includes('\"') || val.includes(',') || val.includes('\\n') || val.includes('\\r')) {",
      replace: "  if (val.includes('\"') || val.includes('\\n') || val.includes('\\r')) {",
      expect: '"only,comma"'
    },
    {
      id: 'T18b-6',
      desc: 'T18b-6: internal quote not doubled',
      file: 'src/ui/csv.ts',
      find: '    return `"${val.replace(/"/g, \'""\')}"`;',
      replace: '    return `"${val}"`;',
      expect: '"test,""family""'
    },

    // Ticket 19 Mutants (T19-AC1 through T19-AC4)
    {
      id: 'T19-AC1-1',
      desc: 'T19-AC1-1: XML declaration omitted in standalone SVG',
      file: 'src/ui/export.ts',
      find: 'return `<?xml version="1.0" encoding="UTF-8"?>\\n<svg${attrs}>${finalInner}`;',
      replace: 'return `<svg${attrs}>${finalInner}`;',
      testType: 'e2e',
      expect: 'Exported SVG must start with XML declaration'
    },
    {
      id: 'T19-AC1-2',
      desc: 'T19-AC1-2: XML declaration duplicated in standalone SVG',
      file: 'src/ui/export.ts',
      find: 'return `<?xml version="1.0" encoding="UTF-8"?>\\n<svg${attrs}>${finalInner}`;',
      replace: 'return `<?xml version="1.0" encoding="UTF-8"?>\\n<?xml version="1.0" encoding="UTF-8"?>\\n<svg${attrs}>${finalInner}`;',
      testType: 'e2e',
      expect: 'Exported SVG must have exactly one XML declaration'
    },
    {
      id: 'T19-AC1-3',
      desc: 'T19-AC1-3: white background rect omitted in standalone SVG',
      file: 'src/ui/export.ts',
      find: '  const rectTag = \'<rect width="100%" height="100%" fill="#ffffff"/>\';',
      replace: '  const rectTag = \'\';',
      testType: 'e2e',
      expect: 'Exported SVG must contain opaque white background rect'
    },
    {
      id: 'T19-AC1-4',
      desc: 'T19-AC1-4: SVG export taken from DOM after zoom instead of raw cache',
      file: 'src/ui/main.ts',
      find: '    const standaloneSvg = formatStandaloneSvg(rawSvg);',
      replace: '    const standaloneSvg = formatStandaloneSvg(document.getElementById(\'canvas-viewport\')?.innerHTML || rawSvg);',
      testType: 'e2e',
      expect: 'Exported SVG must come from cached SVG string, never from mutated DOM'
    },
    {
      id: 'T19-AC2-1',
      desc: 'T19-AC2-1: wrong filename convention for final DOT export',
      file: 'src/ui/export.ts',
      find: 'return `nfa-final.${format}`;',
      replace: 'return format === "dot" ? "wrong-final.dot" : `nfa-final.${format}`;',
      testType: 'e2e',
      expect: 'Exported DOT filename must match expected convention'
    },
    {
      id: 'T19-AC2-2',
      desc: 'T19-AC2-2: export stores wrong view DOT for final view',
      file: 'src/ui/main.ts',
      find: '    canvasEl.setAttribute(\'data-view\', \'final\');\n    canvasEl.removeAttribute(\'data-current-step\');\n    if (isDeadRun) {\n      canvasEl.setAttribute(\'data-run-status\', \'dead\');\n    } else {\n      canvasEl.removeAttribute(\'data-run-status\');\n    }\n\n    if (result.ok) {\n      currentDot = dot;',
      replace: '    canvasEl.setAttribute(\'data-view\', \'final\');\n    canvasEl.removeAttribute(\'data-current-step\');\n    if (isDeadRun) {\n      canvasEl.setAttribute(\'data-run-status\', \'dead\');\n    } else {\n      canvasEl.removeAttribute(\'data-run-status\');\n    }\n\n    if (result.ok) {\n      currentDot = "digraph WRONG_FINAL {}";',
      testType: 'e2e',
      expect: 'Exported DOT must match the rendered view DOT'
    },
    {
      id: 'T19-AC3-1',
      desc: 'T19-AC3-1: SVG export button enabled when diagram is capped (>400 tokens)',
      file: 'src/ui/main.ts',
      find: 'if (exportSvgBtn) exportSvgBtn.disabled = true;\n\n    const message = `Diagram is disabled for expressions over ${CAPS.textbookStepping}',
      replace: 'if (exportSvgBtn) exportSvgBtn.disabled = false;\n\n    const message = `Diagram is disabled for expressions over ${CAPS.textbookStepping}',
      testType: 'e2e',
      expect: '#export-svg-btn must be disabled when diagram is capped'
    },
    {
      id: 'T19-AC3-2',
      desc: 'T19-AC3-2: DOT export button disabled when diagram is capped (>400 tokens)',
      file: 'src/ui/main.ts',
      find: 'if (exportDotBtn) exportDotBtn.disabled = false;\n    if (exportSvgBtn) exportSvgBtn.disabled = true;\n\n    const message = `Diagram is disabled for expressions over ${CAPS.textbookStepping}',
      replace: 'if (exportDotBtn) exportDotBtn.disabled = true;\n    if (exportSvgBtn) exportSvgBtn.disabled = true;\n\n    const message = `Diagram is disabled for expressions over ${CAPS.textbookStepping}',
      testType: 'e2e',
      expect: '#export-dot-btn must be enabled when diagram is capped'
    },
    {
      id: 'T19-AC3-3',
      desc: 'T19-AC3-3: export buttons not disabled while build is in flight',
      file: 'src/ui/main.ts',
      find: 'currentDot = null;\n  if (exportDotBtn) exportDotBtn.disabled = true;\n  if (exportSvgBtn) exportSvgBtn.disabled = true;\n  const gen = ++buildGeneration;',
      replace: 'currentDot = null;\n  const gen = ++buildGeneration;',
      testType: 'e2e',
      expect: 'Export buttons must be disabled during build in flight'
    },
    {
      id: 'T19-AC4-1',
      desc: 'T19-AC4-1: export buttons not reset in clearResults()',
      file: 'src/ui/main.ts',
      find: 'currentDot = null;\n  if (exportDotBtn) exportDotBtn.disabled = true;\n  if (exportSvgBtn) exportSvgBtn.disabled = true;\n  if (layoutNoteEl) {',
      replace: 'currentDot = null;\n  if (exportDotBtn) exportDotBtn.disabled = false;\n  if (exportSvgBtn) exportSvgBtn.disabled = false;\n  if (layoutNoteEl) {',
      testType: 'e2e',
      expect: 'Export buttons must be disabled after'
    },
    {
      id: 'T19-AC4-2',
      desc: 'T19-AC4-2: exported DOT stale after rebuilding different expression',
      file: 'src/ui/main.ts',
      find: '    canvasEl.setAttribute(\'data-current-step\', String(targetStep));\n    if (result.ok) {\n      currentDot = dot;',
      replace: '    canvasEl.setAttribute(\'data-current-step\', String(targetStep));\n    if (result.ok) {\n      currentDot = "digraph STALE {}";',
      testType: 'e2e',
      expect: 'Exported DOT after rebuild must belong to new expression'
    },
    // Ticket 19 Mutants (T19-AC5 through T19-AC8)
    {
      id: 'T19-AC5-1',
      desc: 'T19-AC5-1: + not encoded in encodeAppState',
      file: 'src/ui/url.ts',
      find: '  return params.toString();',
      replace: '  return params.toString().replace(/%2B/g, "+");',
      testType: 'vitest',
      expect: "to contain '%2B'"
    },
    {
      id: 'T19-AC5-2',
      desc: 'T19-AC5-2: notation always standard in decodeAppState',
      file: 'src/ui/url.ts',
      find: '        state.notation = rawVal;',
      replace: '        state.notation = "standard";',
      testType: 'vitest',
      expect: "expected 'standard' to be 'textbook'"
    },
    {
      id: 'T19-AC5-3',
      desc: 'T19-AC5-3: query length limit removed in decodeAppState',
      file: 'src/ui/url.ts',
      find: "  if (query.length > LIMITS.maxQueryLength) {\n    return { state: {}, ignoredKeys: ['query_too_long'] };\n  }",
      replace: '  // limit removed',
      testType: 'vitest',
      expect: 'query_too_long'
    },
    {
      id: 'T19-AC6-1',
      desc: 'T19-AC6-1: build skipped in initDeepLink',
      file: 'src/ui/main.ts',
      find: "  if (inputEl && inputEl.value.trim() !== '') {\n    await handleBuild();",
      replace: "  if (false && inputEl && inputEl.value.trim() !== '') {\n    await handleBuild();",
      testType: 'e2e',
      expect: 'Auto-build must populate #stats on deep link load'
    },
    {
      id: 'T19-AC6-2',
      desc: 'T19-AC6-2: preset skipped in initDeepLink',
      file: 'src/ui/main.ts',
      find: "      if (presetSelectEl) presetSelectEl.value = state.preset;",
      replace: "      // preset skipped",
      testType: 'e2e',
      expect: 'Preset select must be restored on deep link load'
    },
    {
      id: 'T19-AC6-3',
      desc: 'T19-AC6-3: view restore skipped in initDeepLink',
      file: 'src/ui/main.ts',
      find: "        if (targetView && viewToggleSelect) {\n          viewToggleSelect.value = targetView;\n          currentView = targetView;\n        }\n        await navigateToStep(stepNum);",
      replace: "        // view skipped",
      testType: 'e2e',
      expect: 'View must be restored on deep link load'
    },
    {
      id: 'T19-AC6-4',
      desc: 'T19-AC6-4: link notice omitted in initDeepLink',
      file: 'src/ui/main.ts',
      find: "  if (ignoredKeys.length > 0 && linkNoticeEl) {\n    linkNoticeEl.textContent = `Ignored link parameters: ${[...new Set(ignoredKeys)].join(', ')}`;\n    linkNoticeEl.className = 'warning';\n  }",
      replace: "  // link notice omitted",
      testType: 'e2e',
      expect: 'Link notice must display ignored parameters'
    },
    {
      id: 'T19-AC7-1',
      desc: 'T19-AC7-1: error text set via innerHTML',
      file: 'src/ui/main.ts',
      find: "        errorEl.textContent =\n          analysis.position !== undefined\n            ? `${analysis.message} at position ${analysis.position}`\n            : analysis.message;",
      replace: "        errorEl.innerHTML =\n          analysis.position !== undefined\n            ? `${analysis.message} at position ${analysis.position}`\n            : analysis.message;",
      testType: 'e2e',
      expect: 'Malicious param must not execute XSS script'
    },
    {
      id: 'T19-AC8-1',
      desc: 'T19-AC8-1: copy link clear timer omitted',
      file: 'src/ui/main.ts',
      find: "    showTransientStatus(\n      copyLinkStatusEl,\n      success,\n      'Link copied!',\n      'Copy failed',\n      () => copyLinkTimer,\n      (t) => {\n        copyLinkTimer = t;\n      },\n      2000\n    );",
      replace: "    if (copyLinkStatusEl) {\n      copyLinkStatusEl.textContent = 'Link copied!';\n      copyLinkStatusEl.setAttribute('data-copied', 'true');\n    }",
      testType: 'e2e',
      expect: 'Timeout'
    },
    {
      id: 'T19-AC8-2',
      desc: 'T19-AC8-2: copy link missing query string',
      file: 'src/ui/main.ts',
      find: "    const success = await copyTextToClipboard(fullUrl);",
      replace: "    const success = await copyTextToClipboard(baseUrl);",
      testType: 'e2e',
      expect: 'Clipboard must contain copied deep link URL'
    },
    {
      id: 'T19-AC8-3',
      desc: 'T19-AC8-3: copy link writes to live region',
      file: 'src/ui/main.ts',
      find: "    const success = await copyTextToClipboard(fullUrl);",
      replace: "    const success = await copyTextToClipboard(fullUrl);\n    if (liveRegionEl) liveRegionEl.textContent = 'Link copied!';",
      testType: 'e2e',
      expect: 'Copy Link must not write to #live-region'
    }
  ];

  const results = [];
  const startTime = Date.now();
  const filterArg = process.argv[2];
  const activeMutants = filterArg ? mutants.filter((m) => m.isControl || m.id.includes(filterArg)) : mutants;

  for (const m of activeMutants) {
    console.log(`Running mutant ${m.id}: ${m.desc}...`);
    const fullPath = path.resolve(m.file);
    let original = fs.readFileSync(fullPath, 'utf8');

    let findTarget = m.find;
    let occurrences = original.split(findTarget).length - 1;
    if (occurrences === 0) {
      // Try CRLF variant
      const crlfVariant = findTarget.replace(/\r?\n/g, '\r\n');
      if (original.split(crlfVariant).length - 1 === 1) {
        findTarget = crlfVariant;
        occurrences = 1;
      } else {
        // Try LF variant
        const lfVariant = findTarget.replace(/\r?\n/g, '\n');
        if (original.split(lfVariant).length - 1 === 1) {
          findTarget = lfVariant;
          occurrences = 1;
        }
      }
    }

    if (occurrences !== 1) {
      console.error(`ERROR in ${m.id}: target string occurred ${occurrences} times (expected 1) in ${m.file}`);
      process.exit(1);
    }

    let resultStatus = 'UNKNOWN';
    let failMsg = '';
    let failLoc = '';

    try {
      const mutated = original.replace(findTarget, m.replace);
      fs.writeFileSync(fullPath, mutated, 'utf8');

      // For unit-tested files, run vitest BEFORE e2e (unless testType is e2e)
      if (UNIT_TESTED_FILES.has(m.file) && m.testType !== 'e2e') {
        const vitestRes = runCommand('npx.cmd vitest run');
        if (!vitestRes.ok) {
          const parsed = parseFirstFailure(vitestRes.output);
          failMsg = parsed.message;
          failLoc = parsed.location;
          if (m.expect && parsed.message.includes(m.expect)) {
            resultStatus = 'KILLED';
          } else {
            resultStatus = 'WRONG-KILLER';
          }
        } else {
          // Vitest passed, proceed to build and e2e
          const buildRes = runCommand('npm.cmd run build');
          if (!buildRes.ok) {
            failMsg = 'Build failed: ' + buildRes.output.slice(0, 120);
            failLoc = m.file;
            resultStatus = 'BUILD-ERROR';
          } else {
            const e2eRes = runCommand('node tests/e2e.cjs');
            if (e2eRes.ok) {
              resultStatus = 'SURVIVED';
            } else {
              const parsed = parseFirstFailure(e2eRes.output);
              failMsg = parsed.message;
              failLoc = parsed.location;
              if (m.expect && parsed.message.includes(m.expect)) {
                resultStatus = 'KILLED';
              } else {
                resultStatus = 'WRONG-KILLER';
              }
            }
          }
        }
      } else {
        const buildRes = runCommand('npm.cmd run build');
        if (!buildRes.ok) {
          failMsg = 'Build failed: ' + buildRes.output.slice(0, 120);
          failLoc = m.file;
          resultStatus = 'BUILD-ERROR';
        } else {
          const e2eRes = runCommand('node tests/e2e.cjs');
          if (e2eRes.ok) {
            resultStatus = 'SURVIVED';
          } else {
            const parsed = parseFirstFailure(e2eRes.output);
            failMsg = parsed.message;
            failLoc = parsed.location;
            if (m.expect && parsed.message.includes(m.expect)) {
              resultStatus = 'KILLED';
            } else {
              resultStatus = 'WRONG-KILLER';
            }
          }
        }
      }
    } finally {
      // Revert mutated file
      fs.writeFileSync(fullPath, original, 'utf8');
      execSync(`git checkout -- "${m.file}"`, { stdio: 'pipe' });
      const statusAfter = getGitStatus();
      if (statusAfter !== initialStatus) {
        console.error(`FATAL: tree dirty after reverting ${m.id}: got "${statusAfter}", expected "${initialStatus}"`);
        process.exit(1);
      }
    }

    results.push({
      id: m.id,
      desc: m.desc,
      status: resultStatus,
      message: failMsg,
      location: failLoc,
      isControl: m.isControl
    });
    console.log(`  -> ${resultStatus}: ${failMsg} (${failLoc})`);
  }

  // Ensure dist is rebuilt clean after all mutations
  runCommand('npm.cmd run build');

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n### UI Mutants Summary Table\n');
  console.log('| ID | Description | Status | First Failing Assertion | Location |');
  console.log('|---|---|---|---|---|');
  for (const r of results) {
    const escapedMsg = r.message.replace(/\|/g, '\\|').replace(/\n/g, ' ');
    console.log(`| ${r.id} | ${r.desc} | **${r.status}** | \`${escapedMsg}\` | \`${r.location}\` |`);
  }
  console.log(`\nTotal mutant run time: ${durationSec} s`);

  // Verify controls
  const ctrlSurvive = results.find(r => r.id === 'CTRL-SURVIVE');
  const ctrlWrong = results.find(r => r.id === 'CTRL-WRONG-KILLER');
  if (ctrlSurvive?.status !== 'SURVIVED') {
    console.error('FATAL: CTRL-SURVIVE did not SURVIVE!');
    process.exit(1);
  }
  if (ctrlWrong?.status !== 'WRONG-KILLER') {
    console.error('FATAL: CTRL-WRONG-KILLER did not report WRONG-KILLER!');
    process.exit(1);
  }

  // Verify all non-control mutants were KILLED
  const nonControls = results.filter(r => !r.isControl);
  const unkilled = nonControls.filter(r => r.status !== 'KILLED');
  if (unkilled.length > 0) {
    console.error(`FATAL: ${unkilled.length} mutants not KILLED:`, unkilled);
    process.exit(1);
  }

  console.log('\nAll mutant assertions verified successfully!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
