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
      const maxScan = Math.min(i + 200, lines.length);
      for (let j = i + 1; j < maxScan; j++) {
        const stackLine = lines[j].trim();
        if (j > i + 1 && (stackLine.includes('E2E test failed:') || stackLine.startsWith('FAIL ') || stackLine.startsWith('Error:'))) {
          break;
        }
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
        const maxScan = Math.min(i + 200, lines.length);
        for (let j = i + 1; j < maxScan; j++) {
          const stackLine = lines[j].trim();
          if (j > i + 1 && (stackLine.includes('E2E test failed:') || stackLine.startsWith('FAIL ') || stackLine.startsWith('Error:'))) {
            break;
          }
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

function runSelfTest() {
  const diffLines = Array.from({ length: 35 }, (_, idx) => `-   line ${idx + 1}`).join('\n');
  const fixture = `E2E test failed: AssertionError [ERR_ASSERTION]: Exported DOT must match the rendered view DOT
+ actual - expected

+ 'digraph WRONG_FINAL {}'
${diffLines}
    at D:/Projects/Automata/tests/e2e.cjs:3208:10 {
  generatedMessage: false,
  code: 'ERR_ASSERTION'
}`;

  const res = parseFirstFailure(fixture);
  if (!res.location.includes('tests/e2e.cjs:3208:10')) {
    throw new Error(`Self-test failed: expected location to contain "tests/e2e.cjs:3208:10", got "${res.location}"`);
  }
  if (!res.message.includes('Exported DOT must match the rendered view DOT')) {
    throw new Error(`Self-test failed: unexpected message "${res.message}"`);
  }
  console.log('parseFirstFailure self-test passed (35-line diff fixture verified).');
}

if (process.argv.includes('--self-test')) {
  runSelfTest();
  process.exit(0);
}

async function main() {
  runSelfTest();
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
      find: '  stopPlayback();\n  currentViewBox = null;',
      replace: '  stopPlayback();',
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
      expect: 'Timeout 5000ms exceeded'
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
      find: '    a.download = `stress-chart-${familyId}-${currentStressScale}.svg`;\n    document.body.appendChild(a);\n    a.click();',
      replace: '    a.download = `stress-chart-${familyId}-${currentStressScale}.svg`;\n    document.body.appendChild(a);\n    // a.click();',
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
      id: 'T19-AC2-3',
      desc: 'T19-AC2-3: diagram-capped build exports DOT with wrong node count',
      file: 'src/ui/main.ts',
      find: '    currentDot = toDot(analysis.nfa, {\n      compactLabels: isCompactLabels()\n    });',
      replace: '    currentDot = \'digraph G {\\n  q0 [label="0"];\\n}\';',
      testType: 'e2e',
      expect: 'Capped DOT node count must equal #stats state count'
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
      id: 'T19-AC6-5',
      desc: 'T19-AC6-5: invalid param aborts whole deep link',
      file: 'src/ui/url.ts',
      find: '  return { state, ignoredKeys };',
      replace: '  if (ignoredKeys.length > 0) return { state: {}, ignoredKeys };\n  return { state, ignoredKeys };',
      testType: 'e2e',
      expect: 'Auto-build must populate #stats on deep link load'
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
      expect: 'Timeout 5000ms exceeded'
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
    },
    {
      id: 'T19-AC8-4',
      desc: 'T19-AC8-4: copy link omits step parameter',
      file: 'src/ui/main.ts',
      find: "    if (currentStepIndex > 1 && currentView !== 'final') {\n      state.step = currentStepIndex;\n    }",
      replace: "    // step omitted from copy link",
      testType: 'e2e',
      expect: 'Step counter must reproduce step 2 in fresh page'
    },
    {
      id: 'T19-AC9-1',
      desc: 'T19-AC9-1: input guard removed from ? shortcut',
      file: 'src/ui/main.ts',
      find: "  if (!isInput && !e.ctrlKey && !e.altKey && !e.metaKey && e.key === '?') {",
      replace: "  if (!e.ctrlKey && !e.altKey && !e.metaKey && e.key === '?') {",
      testType: 'e2e',
      expect: 'Typing ? in input must not open keyboard help'
    },
    {
      id: 'T19-AC9-2',
      desc: 'T19-AC9-2: open-guard on arrow handler removed',
      file: 'src/ui/main.ts',
      find: "  if (keyboardHelpDialog?.open) {\n    return;\n  }",
      replace: "  // open guard on arrow handler removed",
      testType: 'e2e',
      expect: 'Arrow stepping must be disabled while keyboard help is open'
    },
    {
      id: 'T19-AC9-3',
      desc: 'T19-AC9-3: focus return omitted on dialog close',
      file: 'src/ui/main.ts',
      find: "  if (opener && typeof opener.focus === 'function') {\n    opener.focus();\n  }",
      replace: "  // focus return omitted",
      testType: 'e2e',
      expect: 'Focus must return to opener button on close'
    },
    {
      id: 'T19-AC9-4',
      desc: 'T19-AC9-4: one list row removed from keyboard help table',
      file: 'index.html',
      find: "          <tr>\n            <td><kbd>Esc</kbd></td>\n            <td>Close keyboard shortcuts help</td>\n          </tr>",
      replace: "          <!-- row removed -->",
      testType: 'e2e',
      expect: 'Keyboard help table must contain 9 shortcut rows'
    },
    {
      id: 'T19-AC9-5',
      desc: 'T19-AC9-5: ? opens with Ctrl or Alt held',
      file: 'src/ui/main.ts',
      find: "  if (!isInput && !e.ctrlKey && !e.altKey && !e.metaKey && e.key === '?') {",
      replace: "  if (!isInput && e.key === '?') {",
      testType: 'e2e',
      expect: 'Ctrl+? must not open keyboard help'
    },
    {
      id: 'T19-AC9-6',
      desc: 'T19-AC9-6: canvas shortcuts act while keyboard help dialog is open',
      file: 'src/ui/main.ts',
      find: "  canvasEl.addEventListener('keydown', (e: KeyboardEvent) => {\n    if (keyboardHelpDialog?.open) return;",
      replace: "  canvasEl.addEventListener('keydown', (e: KeyboardEvent) => {\n    // open-guard removed",
      testType: 'e2e',
      expect: 'Canvas shortcuts must not act while keyboard help dialog is open'
    },
    // Ticket 20 Mutants
    {
      id: 'T20-AC4-1',
      desc: 'T20-AC4-1: aria-label omitted from notation-select',
      file: 'index.html',
      find: '      <select id="notation-select" data-testid="notation-select" aria-label="Notation">',
      replace: '      <select id="notation-select" data-testid="notation-select">',
      testType: 'e2e',
      expect: 'Select element #notation-select must have an accessible name'
    },
    {
      id: 'T20-AC5-1',
      desc: 'T20-AC5-1: revert step parsing in decodeAppState to lenient parseInt',
      file: 'src/ui/url.ts',
      find: "    } else if (key === 'step') {\n      if (/^[1-9]\\d*$/.test(rawVal)) {\n        const num = Number(rawVal);\n        if (Number.isSafeInteger(num)) {\n          state.step = num;\n        } else {\n          ignoredKeys.push('step');\n        }\n      } else {\n        ignoredKeys.push('step');\n      }\n    }",
      replace: "    } else if (key === 'step') {\n      const parsed = parseInt(rawVal, 10);\n      if (isNaN(parsed) || parsed < 1) {\n        ignoredKeys.push('step');\n      } else {\n        state.step = parsed;\n      }\n    }",
      testType: 'vitest',
      expect: 'step=3abc should be ignored'
    },
    {
      id: 'T20-B8-1',
      desc: 'T20-B8-1: corrupt build stamp in footer with invalid format',
      file: 'src/ui/main.ts',
      find: '  buildStampEl.textContent = formatBuildStamp();',
      replace: "  buildStampEl.textContent = 'invalid-stamp!';",
      testType: 'e2e',
      expect: 'Build stamp must be a commit hash (optionally -dirty) or unknown'
    },
    // Ticket 21 Mutants (Foundation: Tokens, Base Styles, Worker Status)
    {
      id: 'T21-AC1-1',
      desc: 'T21-AC1-1: Corrupt primary color token in index.html',
      file: 'index.html',
      find: '      --primary:                 #2541b2; /* Primary action \'Build\', active tabs, focus ring (8.5:1) */',
      replace: '      --primary:                 #00ff00; /* Corrupted token */',
      testType: 'e2e',
      expect: 'Computed --primary token must match #2541b2'
    },
    {
      id: 'T21-AC2-1',
      desc: 'T21-AC2-1: Corrupt UI font stack in index.html',
      file: 'index.html',
      find: '      --font-ui:      "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;',
      replace: '      --font-ui:      "Comic Sans MS", cursive;',
      testType: 'e2e',
      expect: 'Body font-family must include IBM Plex Sans or system-ui'
    },
    {
      id: 'T21-AC3-1',
      desc: 'T21-AC3-1: Remove display:none from #worker-status in index.html',
      file: 'index.html',
      find: '    #worker-status {\n      display: none;\n    }',
      replace: '    #worker-status {\n      display: block;\n    }',
      testType: 'e2e',
      expect: '#worker-status must be visually hidden'
    },
    {
      id: 'T21-AC4-1',
      desc: 'T21-AC4-1: Corrupt build-button background color in index.html',
      file: 'index.html',
      find: '    #build-button {\n      background-color: var(--primary);',
      replace: '    #build-button {\n      background-color: #cccccc;',
      testType: 'e2e',
      expect: '#build-button background-color must match primary token'
    },
    // Ticket 22 Mutants (Shell, Header & Build Stamp Footer)
    {
      id: 'T22-AC1-1',
      desc: 'T22-AC1-1: Corrupt theme storage key in src/ui/theme.ts',
      file: 'src/ui/theme.ts',
      find: "export const THEME_STORAGE_KEY = 're-nfa:theme';",
      replace: "export const THEME_STORAGE_KEY = 'corrupted-theme-key';",
      testType: 'e2e',
      expect: "localStorage theme key 're-nfa:theme' must be saved"
    },
    {
      id: 'T22-AC1-2',
      desc: 'T22-AC1-2: Omit data-theme attribute set in src/ui/theme.ts',
      file: 'src/ui/theme.ts',
      find: "    el.setAttribute('data-theme', theme);",
      replace: "    // el.setAttribute('data-theme', theme);",
      testType: 'e2e',
      expect: 'data-theme attribute must be set to dark'
    },
    {
      id: 'T22-AC2-1',
      desc: 'T22-AC2-1: Corrupt validation nav link href in index.html',
      file: 'index.html',
      find: '        <a href="#validation-panel" class="nav-link">Validation</a>',
      replace: '        <a href="#wrong-validation" class="nav-link">Validation</a>',
      testType: 'e2e',
      expect: 'Validation nav link must point to #validation-panel'
    },
    {
      id: 'T22-AC3-1',
      desc: 'T22-AC3-1: Corrupt #app-header sticky position in index.html',
      file: 'index.html',
      find: '    #app-header {\n      position: sticky;',
      replace: '    #app-header {\n      position: relative;',
      testType: 'e2e',
      expect: '#app-header position must be sticky'
    },
    // Ticket 23 Mutants (Workbench Layout: 3 Rails, Canvas Hero & Scrubber)
    {
      id: 'T23-AC1-1',
      desc: 'T23-AC1-1: Corrupt scrubber value sync in src/ui/scrubber.ts',
      file: 'src/ui/scrubber.ts',
      find: '    target.value = String(clamped);',
      replace: "    target.value = '1';",
      testType: 'e2e',
      expect: 'Scrubber value must update to 2 when stepping via Next button'
    },
    {
      id: 'T23-AC1-2',
      desc: 'T23-AC1-2: Do not disable scrubber in final view in src/ui/scrubber.ts',
      file: 'src/ui/scrubber.ts',
      find: '  if (totalSteps <= 0 || isFinalView) {',
      replace: '  if (totalSteps <= 0) {',
      testType: 'e2e',
      expect: 'Scrubber must be disabled in Final NFA view'
    },
    {
      id: 'T23-AC2-1',
      desc: 'T23-AC2-1: Corrupt #workbench CSS grid display in index.html',
      file: 'index.html',
      find: '    .workbench-grid {\n      display: grid;',
      replace: '    .workbench-grid {\n      display: block;',
      testType: 'e2e',
      expect: '#workbench must use CSS grid display'
    },
    {
      id: 'T23-AC3-1',
      desc: 'T23-AC3-1: Remove canvas dot grid radial gradient in index.html',
      file: 'index.html',
      find: '      background-image: radial-gradient(var(--canvas-grid-dot) 1px, transparent 1px);',
      replace: '      /* background-image: radial-gradient(var(--canvas-grid-dot) 1px, transparent 1px); */',
      testType: 'e2e',
      expect: 'Canvas background must contain radial-gradient dot grid'
    },
    // Ticket 24 Mutants (Input Strip, Postfix Timeline, and Parse Tree)
    {
      id: 'T24-AC1-1',
      desc: 'T24-AC1-1: Corrupt ghost buttons cursor insertion in src/ui/main.ts',
      file: 'src/ui/main.ts',
      find: '  inputEl.value = val.substring(0, start) + char + val.substring(end);',
      replace: "  inputEl.value = val.substring(0, start) + '' + val.substring(end);",
      testType: 'e2e',
      expect: 'Insert ε button must insert ε'
    },
    {
      id: 'T24-AC1-2',
      desc: 'T24-AC1-2: Corrupt #stats format in src/ui/main.ts',
      file: 'src/ui/main.ts',
      find: '    statsEl.textContent = `States: ${analysis.stats.states}, Transitions: ${analysis.stats.transitions}`;',
      replace: '    statsEl.textContent = `States count: ${analysis.stats.states}`;',
      testType: 'e2e',
      expect: 'Stats must report 10 states'
    },
    {
      id: 'T24-AC2-1',
      desc: 'T24-AC2-1: Corrupt Parse Tree chip rendering in src/ui/parse-view.ts',
      file: 'src/ui/parse-view.ts',
      find: '    chip.className = `tree-chip ${isLeaf ? \'leaf-chip\' : \'operator-chip\'}`;',
      replace: "    chip.className = 'omitted-chip';",
      testType: 'e2e',
      expect: '#tree-view must contain visual .tree-chip elements'
    },
    {
      id: 'T24-AC3-1',
      desc: 'T24-AC3-1: Corrupt Postfix token active class sync in src/ui/parse-view.ts',
      file: 'src/ui/parse-view.ts',
      find: "      tok.classList.add('active');\n      if (typeof tok.scrollIntoView === 'function') {",
      replace: "      // tok.classList.add('active');\n      if (typeof tok.scrollIntoView === 'function') {",
      testType: 'e2e',
      expect: 'Active postfix token must be UNION'
    },
    // Ticket 25 Mutants (Step Log & Transition Table)
    {
      id: 'T25-AC1-1',
      desc: 'T25-AC1-1: Corrupt step log item class in src/ui/step-table-view.ts',
      file: 'src/ui/step-table-view.ts',
      find: "    li.className = 'step-log-item';",
      replace: "    li.className = 'corrupt-log-item';",
      testType: 'e2e',
      expect: 'Step log must list all 6 steps'
    },
    {
      id: 'T25-AC1-2',
      desc: 'T25-AC1-2: Omit active step log class in updateStepLogActive in src/ui/step-table-view.ts',
      file: 'src/ui/step-table-view.ts',
      find: "      item.classList.add('active');\n      item.setAttribute('aria-current', 'step');",
      replace: "      // item.classList.add('active');\n      item.setAttribute('aria-current', 'step');",
      testType: 'e2e',
      expect: 'First step item must be active at step 1'
    },
    {
      id: 'T25-AC2-1',
      desc: 'T25-AC2-1: Corrupt transition table row data-state attribute in src/ui/step-table-view.ts',
      file: 'src/ui/step-table-view.ts',
      find: "      tr.setAttribute('data-state', String(q));",
      replace: "      // tr.setAttribute('data-state', String(q));",
      testType: 'e2e',
      expect: 'Before compact toggle, state 9 row must start with q9'
    },
    {
      id: 'T25-AC2-2',
      desc: 'T25-AC2-2: Omit active-state-row class in updateTableActiveStates in src/ui/step-table-view.ts',
      file: 'src/ui/step-table-view.ts',
      find: "      row.classList.add('active-state-row');",
      replace: "      // row.classList.add('active-state-row');",
      testType: 'e2e',
      expect: 'Active state rows must be highlighted after simulation run'
    },
    {
      id: 'T25-AC2-3',
      desc: 'T25-AC2-3: Omit Escape key active states clearing in src/ui/main.ts',
      file: 'src/ui/main.ts',
      find: "      currentActiveStates = null;\n      if (tableEl) {\n        updateTableActiveStates(tableEl, null);\n      }\n      if (traceEl) {",
      replace: "      currentActiveStates = null;\n      // if (tableEl) updateTableActiveStates(tableEl, null);\n      if (traceEl) {",
      testType: 'e2e',
      expect: 'Pressing Escape must clear active state row highlighting'
    },
    {
      id: 'T26-AC1-1',
      desc: 'T26-AC1-1: Mutate formatDockSummary return text in src/ui/test-dock.ts',
      file: 'src/ui/test-dock.ts',
      find: '  return `${accepted} accepted · ${rejected} rejected`;',
      replace: '  return `${accepted} accepted, ${rejected} rejected`;',
      testType: 'e2e',
      expect: 'Summary must reflect current run results'
    },
    {
      id: 'T26-AC1-2',
      desc: 'T26-AC1-2: Invert verdict pill class in src/ui/test-dock.ts',
      file: 'src/ui/test-dock.ts',
      find: "    pill.className = `verdict-pill ${res.verdict === 'ACCEPT' ? 'accept' : 'reject'}`;",
      replace: "    pill.className = `verdict-pill ${res.verdict === 'ACCEPT' ? 'reject' : 'accept'}`;",
      testType: 'e2e',
      expect: 'First card must have isAccept=true'
    },
    {
      id: 'T26-AC2-1',
      desc: 'T26-AC2-1: Omit Ctrl+Enter run shortcut in src/ui/main.ts',
      file: 'src/ui/main.ts',
      find: "    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {\n      e.preventDefault();\n      if (runButtonEl) {\n        runButtonEl.click();\n      }\n    }",
      replace: "    if (false && (e.ctrlKey || e.metaKey) && e.key === 'Enter') {\n      e.preventDefault();\n      if (runButtonEl) {\n        runButtonEl.click();\n      }\n    }",
      testType: 'e2e',
      expect: 'Ctrl+Enter must trigger simulation run'
    },
    {
      id: 'T26-AC2-2',
      desc: 'T26-AC2-2: Omit test-dock collapse toggle in src/ui/main.ts',
      file: 'src/ui/main.ts',
      find: "    const isCollapsed = testDockEl.classList.toggle('collapsed');\n    testDockToggleBtn.setAttribute('aria-expanded', String(!isCollapsed));",
      replace: "    const isCollapsed = false;\n    testDockToggleBtn.setAttribute('aria-expanded', String(!isCollapsed));",
      testType: 'e2e',
      expect: 'Clicking toggle must add .collapsed to #test-dock'
    },
    {
      id: 'T27-AC1-1',
      desc: 'T27-AC1-1: Mutate formatSuiteSummary return in src/ui/validation-view.ts',
      file: 'src/ui/validation-view.ts',
      find: '    return `${passCount} / ${total} pass`;',
      replace: '    return `${passCount} of ${total} pass`;',
      testType: 'e2e',
      expect: '#suite-summary chip must be 24 / 24 pass'
    },
    {
      id: 'T27-AC1-2',
      desc: 'T27-AC1-2: Mutate extractCodeBadge return code in src/ui/validation-view.ts',
      file: 'src/ui/validation-view.ts',
      find: '    return { code: match[1], name: match[2] };',
      replace: "    return { code: 'BAD', name: match[2] };",
      testType: 'e2e',
      expect: '#inv-I1 .check-code must be I1'
    },
    {
      id: 'T27-AC2-1',
      desc: 'T27-AC2-1: Mutate renderInvariantRow pill text in src/ui/validation-view.ts',
      file: 'src/ui/validation-view.ts',
      find: "  pill.textContent = pass ? 'PASS' : 'FAIL';",
      replace: "  pill.textContent = pass ? 'OK' : 'FAIL';",
      testType: 'e2e',
      expect: '#inv-I1 must display PASS'
    },
    {
      id: 'T27-AC2-2',
      desc: 'T27-AC2-2: Mutate updateSummaryStrip invariant value in src/ui/validation-view.ts',
      file: 'src/ui/validation-view.ts',
      find: '      invVal.textContent = `${data.invariantsPass} / ${data.invariantsTotal} pass`;',
      replace: "      invVal.textContent = 'Invariants passed';",
      testType: 'e2e',
      expect: 'Invariants summary card val must be 6 / 6 pass'
    }
  ];

  const results = [];
  const startTime = Date.now();
  const filterArgs = process.argv.slice(2);
  const activeMutants = filterArgs.length > 0
    ? mutants.filter((m) => m.isControl || filterArgs.some((arg) => m.id.includes(arg)))
    : mutants;

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
