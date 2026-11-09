#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function getGitStatus() {
  const raw = execSync('git status --porcelain', { encoding: 'utf8' }).trim();
  if (!raw) return '';
  return raw
    .split('\n')
    .filter((l) => l.trim() && !l.includes('tests/ui-mutants.cjs'))
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

function parseFirstFailure(output) {
  const lines = output.split('\n');
  let firstMsg = '';
  let firstLocation = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('AssertionError') || line.includes('ERR_ASSERTION') || line.includes('Error:')) {
      firstMsg = line.trim();
      // Look for next stack frame line with file:line
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

  if (!firstMsg) {
    // Fallback: look for first line starting with FAIL or Error
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('FAIL') || lines[i].includes('failed')) {
        firstMsg = lines[i].trim();
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
      expect: '399-token final view initial mode must be start at 1280x800'
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
    // Ticket 18 Mutants
    {
      id: 'T18-M-AC1',
      desc: 'AC1: CSV header uses LF instead of CRLF',
      file: 'src/ui/csv.ts',
      find: "  const lines: string[] = [header.join(',') + '\\r\\n'];",
      replace: "  const lines: string[] = [header.join(',') + '\\n'];",
      testType: 'unit',
      expect: 'outputs RFC 4180 header with CRLF for empty rows'
    },
    {
      id: 'T18-M-AC2',
      desc: 'AC2: Log-scale bottom tick drops <= prefix',
      file: 'src/diagram/index.ts',
      find: "      { val: 0.01, label: '≤0.01 ms' },",
      replace: "      { val: 0.01, label: '0.01 ms' },",
      testType: 'unit',
      expect: '≤0.01 ms'
    },
    {
      id: 'T18-M-AC3',
      desc: 'AC3: Log toggle aria-pressed update omitted',
      file: 'src/ui/main.ts',
      find: "    stressScaleToggleBtn.setAttribute('aria-pressed', String(currentStressScale === 'log'));",
      replace: "    // aria-pressed update omitted",
      expect: 'aria-pressed must be true after toggling log scale'
    },
    {
      id: 'T18-M-AC4',
      desc: 'AC4: Log toggle clears retained rows',
      file: 'src/ui/main.ts',
      find: "    currentStressScale = currentStressScale === 'linear' ? 'log' : 'linear';",
      replace: "    currentStressScale = currentStressScale === 'linear' ? 'log' : 'linear'; currentStressRows = [];",
      expect: 'Stress chart must retain points across scale toggle'
    },
    {
      id: 'T18-M-AC5',
      desc: 'AC5: Timeout marker suppressed in log mode',
      file: 'src/diagram/index.ts',
      find: "      if (pt.regExpTimeout) {",
      replace: "      if (pt.regExpTimeout && scale !== 'log') {",
      expect: 'SVG timeout marker must remain present and visible in log mode'
    },
    {
      id: 'T18-M-AC6',
      desc: 'AC6: Copy status data-copied attribute omitted',
      file: 'src/ui/main.ts',
      find: "        stressCopyStatusEl.setAttribute('data-copied', 'true');",
      replace: "        // data-copied omitted",
      expect: 'data-copied must be set to true on successful copy'
    },
    {
      id: 'T18-M-AC7',
      desc: 'AC7: stress-copy-csv initially enabled',
      file: 'src/ui/main.ts',
      find: "    stressCopyCsvBtn.disabled = !hasRows;",
      replace: "    stressCopyCsvBtn.disabled = false;",
      expect: '#stress-copy-csv must initially be disabled'
    },
    {
      id: 'T18-M-AC8',
      desc: 'AC8: Export SVG filename wrong',
      file: 'src/ui/main.ts',
      find: "    a.download = `stress-chart-${familyId}-${currentStressScale}.svg`;",
      replace: "    a.download = 'chart.svg';",
      expect: 'Exported SVG filename must match stress-chart-<family>-<scale>.svg'
    }
  ];

  const results = [];
  const startTime = Date.now();

  for (const m of mutants) {
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

      // Run build & test
      const buildRes = runCommand('npm.cmd run build');
      if (!buildRes.ok) {
        failMsg = 'Build failed: ' + buildRes.output.slice(0, 120);
        failLoc = m.file;
        resultStatus = 'BUILD-ERROR';
      } else {
        const testCmd = m.testType === 'unit' ? 'npx.cmd vitest run' : 'node tests/e2e.cjs';
        const testRes = runCommand(testCmd);
        if (testRes.ok) {
          resultStatus = 'SURVIVED';
        } else {
          const parsed = parseFirstFailure(testRes.output);
          failMsg = parsed.message;
          failLoc = parsed.location;
          if (m.expect && parsed.message.includes(m.expect)) {
            resultStatus = 'KILLED';
          } else {
            resultStatus = 'WRONG-KILLER';
          }
        }
      }
    } finally {
      // Revert with git checkout in finally
      execSync(`git checkout -- "${m.file}"`, { stdio: 'pipe' });
      const statusAfter = getGitStatus();
      if (statusAfter) {
        console.error(`FATAL: tree dirty after reverting ${m.id}: ${statusAfter}`);
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
