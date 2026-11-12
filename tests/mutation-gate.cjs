#!/usr/bin/env node

/**
 * Repeatable Mutation Gate for RE → NFA (Thompson) Simulator.
 *
 * Applies the 13 canonical mutants from section 9 of .agents/skills/thompson-rules/SKILL.md
 * to a temporary copy of the engine in a temp directory using a generated Vitest config
 * whose Vite plugin redirects the resolved engine module to the mutated file.
 *
 * Production code (src/engine/index.ts) is never written or overwritten.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const enginePath = path.resolve(projectRoot, 'src/engine/index.ts');
if (!fs.existsSync(enginePath)) {
  console.error(`Error: Engine file not found at ${enginePath}`);
  process.exit(1);
}

const vitestBin = path.resolve(projectRoot, 'node_modules/vitest/vitest.mjs');
if (!fs.existsSync(vitestBin)) {
  console.error(`Error: Vitest binary not found at ${vitestBin}`);
  process.exit(1);
}

const originalContent = fs.readFileSync(enginePath, 'utf-8');
const normalize = (s) => s.replace(/\r\n/g, '\n');
const normOrig = normalize(originalContent);

// Section 9 canonical mutants (do not touch definitions)
const mutants = [
  {
    id: 'star-no-back',
    layer: 'builder',
    description: 'drop A.f -ε→ A.s in STAR',
    target: `      case 'STAR': {
        rule = 'star';
        const A = stack.pop()!;
        operands = [cloneFragment(A)];
        const exprA = A.expression ?? '';
        const s = nextStateId++;
        const f = nextStateId++;
        newStates.push(s, f);
        newTransitions.push(
          { from: s, to: A.start, label: EPS },
          { from: A.accept, to: f, label: EPS },
          { from: s, to: f, label: EPS },
          { from: A.accept, to: A.start, label: EPS }
        );`,
    replacement: `      case 'STAR': {
        rule = 'star';
        const A = stack.pop()!;
        operands = [cloneFragment(A)];
        const exprA = A.expression ?? '';
        const s = nextStateId++;
        const f = nextStateId++;
        newStates.push(s, f);
        newTransitions.push(
          { from: s, to: A.start, label: EPS },
          { from: A.accept, to: f, label: EPS },
          { from: s, to: f, label: EPS }
        );`
  },
  {
    id: 'star-no-skip',
    layer: 'builder',
    description: 'drop s -ε→ f in STAR',
    target: `      case 'STAR': {
        rule = 'star';
        const A = stack.pop()!;
        operands = [cloneFragment(A)];
        const exprA = A.expression ?? '';
        const s = nextStateId++;
        const f = nextStateId++;
        newStates.push(s, f);
        newTransitions.push(
          { from: s, to: A.start, label: EPS },
          { from: A.accept, to: f, label: EPS },
          { from: s, to: f, label: EPS },
          { from: A.accept, to: A.start, label: EPS }
        );`,
    replacement: `      case 'STAR': {
        rule = 'star';
        const A = stack.pop()!;
        operands = [cloneFragment(A)];
        const exprA = A.expression ?? '';
        const s = nextStateId++;
        const f = nextStateId++;
        newStates.push(s, f);
        newTransitions.push(
          { from: s, to: A.start, label: EPS },
          { from: A.accept, to: f, label: EPS },
          { from: A.accept, to: A.start, label: EPS }
        );`
  },
  {
    id: 'union-no-b-exit',
    layer: 'builder',
    description: 'drop B.f -ε→ f in UNION',
    target: `      case 'UNION': {
        rule = 'union';
        const B = stack.pop()!;
        const A = stack.pop()!;
        operands = [cloneFragment(A), cloneFragment(B)];
        const exprA = A.expression ?? '';
        const exprB = B.expression ?? '';
        const op = notation === 'textbook' ? '+' : '|';
        const s = nextStateId++;
        const f = nextStateId++;
        newStates.push(s, f);
        newTransitions.push(
          { from: s, to: A.start, label: EPS },
          { from: s, to: B.start, label: EPS },
          { from: A.accept, to: f, label: EPS },
          { from: B.accept, to: f, label: EPS }
        );`,
    replacement: `      case 'UNION': {
        rule = 'union';
        const B = stack.pop()!;
        const A = stack.pop()!;
        operands = [cloneFragment(A), cloneFragment(B)];
        const exprA = A.expression ?? '';
        const exprB = B.expression ?? '';
        const op = notation === 'textbook' ? '+' : '|';
        const s = nextStateId++;
        const f = nextStateId++;
        newStates.push(s, f);
        newTransitions.push(
          { from: s, to: A.start, label: EPS },
          { from: s, to: B.start, label: EPS },
          { from: A.accept, to: f, label: EPS }
        );`
  },
  {
    id: 'plus-skip',
    layer: 'builder',
    description: 'add s -ε→ f to PLUS',
    target: `      case 'PLUS': {
        rule = 'plus';
        const A = stack.pop()!;
        operands = [cloneFragment(A)];
        const exprA = A.expression ?? '';
        const s = nextStateId++;
        const f = nextStateId++;
        newStates.push(s, f);
        newTransitions.push(
          { from: s, to: A.start, label: EPS },
          { from: A.accept, to: f, label: EPS },
          { from: A.accept, to: A.start, label: EPS }
        );`,
    replacement: `      case 'PLUS': {
        rule = 'plus';
        const A = stack.pop()!;
        operands = [cloneFragment(A)];
        const exprA = A.expression ?? '';
        const s = nextStateId++;
        const f = nextStateId++;
        newStates.push(s, f);
        newTransitions.push(
          { from: s, to: A.start, label: EPS },
          { from: A.accept, to: f, label: EPS },
          { from: s, to: f, label: EPS },
          { from: A.accept, to: A.start, label: EPS }
        );`
  },
  {
    id: 'opt-no-skip',
    layer: 'builder',
    description: 'drop s -ε→ f in OPT',
    target: `      case 'OPT': {
        rule = 'optional';
        const A = stack.pop()!;
        operands = [cloneFragment(A)];
        const exprA = A.expression ?? '';
        const s = nextStateId++;
        const f = nextStateId++;
        newStates.push(s, f);
        newTransitions.push(
          { from: s, to: A.start, label: EPS },
          { from: A.accept, to: f, label: EPS },
          { from: s, to: f, label: EPS }
        );`,
    replacement: `      case 'OPT': {
        rule = 'optional';
        const A = stack.pop()!;
        operands = [cloneFragment(A)];
        const exprA = A.expression ?? '';
        const s = nextStateId++;
        const f = nextStateId++;
        newStates.push(s, f);
        newTransitions.push(
          { from: s, to: A.start, label: EPS },
          { from: A.accept, to: f, label: EPS }
        );`
  },
  {
    id: 'eps-as-empty',
    layer: 'builder',
    description: 'ε atom without its edge',
    target: `      case 'EPSILON': {
        rule = 'epsilon';
        const s = nextStateId++;
        const f = nextStateId++;
        newStates.push(s, f);
        newTransitions.push({ from: s, to: f, label: EPS });`,
    replacement: `      case 'EPSILON': {
        rule = 'epsilon';
        const s = nextStateId++;
        const f = nextStateId++;
        newStates.push(s, f);`
  },
  {
    id: 'empty-as-eps',
    layer: 'builder',
    description: '∅ atom with an ε edge',
    target: `      case 'EMPTY': {
        rule = 'empty';
        const s = nextStateId++;
        const f = nextStateId++;
        newStates.push(s, f);
        produced = makeFragment(s, f, '∅');`,
    replacement: `      case 'EMPTY': {
        rule = 'empty';
        const s = nextStateId++;
        const f = nextStateId++;
        newStates.push(s, f);
        newTransitions.push({ from: s, to: f, label: EPS });
        produced = makeFragment(s, f, '∅');`
  },
  {
    id: 'merge-no-move',
    layer: 'builder',
    description: 'merge deletes B.s without moving its transitions',
    target: `          // Move outgoing transitions from B.start to A.accept
          for (const t of allTransitions) {
            if (t.from === B.start) {
              t.from = A.accept;
            }
          }`,
    replacement: `          // Move outgoing transitions from B.start to A.accept (omitted by mutant)`
  },
  {
    id: 'assoc-right',
    layer: 'parser',
    description: 'binary operators right-associative',
    target: `      const prec = precedence[token.type] ?? 0;
      while (opStack.length > 0) {
        const top = opStack[opStack.length - 1];
        if (top.type === 'LPAREN') break;
        const topPrec = precedence[top.type] ?? 0;
        if (topPrec >= prec) {
          postfix.push(opStack.pop()!);
        } else {
          break;
        }
      }`,
    replacement: `      const prec = precedence[token.type] ?? 0;
      while (opStack.length > 0) {
        const top = opStack[opStack.length - 1];
        if (top.type === 'LPAREN') break;
        const topPrec = precedence[top.type] ?? 0;
        if (topPrec > prec) {
          postfix.push(opStack.pop()!);
        } else {
          break;
        }
      }`
  },
  {
    id: 'prec-swap',
    layer: 'parser',
    description: 'union binds tighter than concatenation',
    target: `  const precedence: Record<string, number> = {
    UNION: 1,
    CONCAT: 2
  };`,
    replacement: `  const precedence: Record<string, number> = {
    UNION: 2,
    CONCAT: 1
  };`
  },
  {
    id: 'closure-one-step',
    layer: 'simulator',
    description: 'closure follows one ε step only',
    target: `function computeEpsilonClosure(startStates: number[], transitions: Transition[]): number[] {
  const closure = new Set<number>(startStates);
  const queue = [...startStates];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const t of transitions) {
      if (t.from === current && t.label === EPS) {
        if (!closure.has(t.to)) {
          closure.add(t.to);
          queue.push(t.to);
        }
      }
    }
  }`,
    replacement: `function computeEpsilonClosure(startStates: number[], transitions: Transition[]): number[] {
  const closure = new Set<number>(startStates);
  const queue = [...startStates];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const t of transitions) {
      if (t.from === current && t.label === EPS) {
        if (!closure.has(t.to)) {
          closure.add(t.to);
        }
      }
    }
  }`
  },
  {
    id: 'no-initial-closure',
    layer: 'simulator',
    description: 'simulation skips the first closure',
    target: `export function run(nfa: NFA, alphabet: string[], input: string): RunResult {
  const initialClosure = computeEpsilonClosure([nfa.start], nfa.transitions);
  let current = initialClosure;`,
    replacement: `export function run(nfa: NFA, alphabet: string[], input: string): RunResult {
  const initialClosure = computeEpsilonClosure([nfa.start], nfa.transitions);
  let current = [nfa.start];`
  },
  {
    id: 'no-closure-after-move',
    layer: 'simulator',
    description: 'no closure after each move',
    target: `    current = computeEpsilonClosure(Array.from(moveTargets), nfa.transitions);
    afterEachSymbol.push(current);`,
    replacement: `    current = Array.from(moveTargets).sort((a, b) => a - b);
    afterEachSymbol.push(current);`
  }
];

// Verify all mutant targets exist uniquely
for (const m of mutants) {
  const normTarget = normalize(m.target);
  const count = normOrig.split(normTarget).length - 1;
  if (count !== 1) {
    console.error(`Error: Mutant target for '${m.id}' matched ${count} times in src/engine/index.ts (expected 1).`);
    process.exit(1);
  }
}

// Create isolated temporary directory inside node_modules (.gitignore protected)
const baseTempDir = path.resolve(projectRoot, 'node_modules/.tmp-mutation-gate');
fs.mkdirSync(baseTempDir, { recursive: true });
const tempDir = fs.mkdtempSync(path.join(baseTempDir, 'run-'));
const engineDir = path.resolve(projectRoot, 'src/engine');
fs.cpSync(engineDir, tempDir, { recursive: true });

function cleanupTempDir() {
  try {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  } catch {}
}

const targetResolvedClean = path.resolve(enginePath).toLowerCase();

function generateVitestConfig(mutatedFilePath) {
  const configPath = path.join(tempDir, `vitest-${Date.now()}-${Math.random().toString(36).slice(2)}.config.mjs`);
  const redirectPlugin = mutatedFilePath
    ? `
    {
      name: 'mutant-redirect',
      enforce: 'pre',
      async resolveId(source, importer, options) {
        const resolution = await this.resolve(source, importer, { ...options, skipSelf: true });
        if (resolution && resolution.id) {
          const clean = path.resolve(resolution.id).toLowerCase();
          if (clean === ${JSON.stringify(targetResolvedClean)}) {
            return ${JSON.stringify(mutatedFilePath)};
          }
        }
        return null;
      }
    },`
    : '';

  const configContent = `
import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { BaseSequencer } from 'vitest/node';
import path from 'node:path';

const fileOrder = ['engine.test.ts', 'properties.test.ts', 'diagram.test.ts'];
class PathSequencer extends BaseSequencer {
  async sort(files) {
    return [...files].sort((a, b) => {
      const idxA = fileOrder.findIndex((name) => a.moduleId.includes(name));
      const idxB = fileOrder.findIndex((name) => b.moduleId.includes(name));
      const rankA = idxA === -1 ? 99 : idxA;
      const rankB = idxB === -1 ? 99 : idxB;
      if (rankA !== rankB) return rankA - rankB;
      return a.moduleId < b.moduleId ? -1 : a.moduleId > b.moduleId ? 1 : 0;
    });
  }
}

export default defineConfig({
  root: ${JSON.stringify(projectRoot)},
  plugins: [
    viteSingleFile(),${redirectPlugin}
  ],
  test: {
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
    sequence: {
      sequencer: PathSequencer
    }
  }
});
`;
  fs.writeFileSync(configPath, configContent, 'utf-8');
  return configPath;
}

try {
  // Step 3: Run unmutated suite first and abort if it is red
  console.log('Running unmutated baseline test suite...');
  const baselineConfigPath = generateVitestConfig(null);
  const baselineReportPath = path.join(tempDir, 'baseline-report.json');

  try {
    execFileSync(
      process.execPath,
      [
        vitestBin,
        'run',
        '--config',
        baselineConfigPath,
        '--no-file-parallelism',
        '--bail',
        '1',
        '--reporter=json',
        `--outputFile=${baselineReportPath}`
      ],
      {
        cwd: projectRoot,
        stdio: 'pipe',
        encoding: 'utf-8'
      }
    );
  } catch (err) {
    console.error('\nERROR: Unmutated baseline test suite is RED. Aborting mutation gate.');
    cleanupTempDir();
    process.exit(1);
  }

  if (fs.existsSync(baselineReportPath)) {
    try {
      const baselineReport = JSON.parse(fs.readFileSync(baselineReportPath, 'utf-8'));
      if (baselineReport.numFailedTests > 0 || baselineReport.numFailedTestSuites > 0) {
        console.error('\nERROR: Unmutated baseline test suite reported failures. Aborting mutation gate.');
        cleanupTempDir();
        process.exit(1);
      }
      fs.unlinkSync(baselineReportPath);
    } catch {}
  }
  if (fs.existsSync(baselineConfigPath)) fs.unlinkSync(baselineConfigPath);

  console.log('Baseline suite is GREEN. Running 13 canonical mutants...\n');

  const results = [];
  let allKilled = true;
  let assocRightKilledByParseTree = false;

  for (const m of mutants) {
    const normTarget = normalize(m.target);
    const normReplacement = normalize(m.replacement);
    const mutated = normOrig.replace(normTarget, normReplacement);

    const mutatedFilePath = path.join(tempDir, `engine-${m.id}.ts`);
    fs.writeFileSync(mutatedFilePath, mutated, 'utf-8');

    const mutantConfigPath = generateVitestConfig(mutatedFilePath);
    const reportFilePath = path.join(tempDir, `report-${m.id}.json`);

    const start = Date.now();
    let processFailed = false;
    let assertionFailed = false;
    let firstFailingTest = '';
    let suiteName = '';
    let errorDetail = '';

    try {
      execFileSync(
        process.execPath,
        [
          vitestBin,
          'run',
          '--config',
          mutantConfigPath,
          '--no-file-parallelism',
          '--bail',
          '1',
          '--reporter=json',
          `--outputFile=${reportFilePath}`
        ],
        {
          cwd: projectRoot,
          stdio: 'pipe',
          encoding: 'utf-8'
        }
      );
    } catch (err) {
      processFailed = true;
    }

    if (fs.existsSync(reportFilePath)) {
      try {
        const report = JSON.parse(fs.readFileSync(reportFilePath, 'utf-8'));
        for (const suite of report.testResults || []) {
          if (suite.message) {
            errorDetail = suite.message;
          }
          for (const a of suite.assertionResults || []) {
            if (a.status === 'failed') {
              assertionFailed = true;
              firstFailingTest = a.title || a.fullName;
              suiteName = path.basename(suite.name);
              break;
            }
          }
          if (firstFailingTest) break;
        }
      } catch (parseErr) {
        errorDetail = `JSON parse failure: ${parseErr.message}`;
      }
      try {
        fs.unlinkSync(reportFilePath);
      } catch {}
    }
    if (fs.existsSync(mutantConfigPath)) {
      try {
        fs.unlinkSync(mutantConfigPath);
      } catch {}
    }
    if (fs.existsSync(mutatedFilePath)) {
      try {
        fs.unlinkSync(mutatedFilePath);
      } catch {}
    }

    const durationMs = Date.now() - start;

    if (processFailed && assertionFailed) {
      const fullTestName = `${suiteName ? suiteName + ' > ' : ''}${firstFailingTest}`;
      results.push({
        id: m.id,
        layer: m.layer,
        description: m.description,
        status: 'KILLED',
        firstTest: fullTestName,
        durationMs
      });

      if (m.id === 'assoc-right') {
        const isParseTree = /parseTree|parse-tree|parseRD/i.test(fullTestName);
        if (isParseTree) {
          assocRightKilledByParseTree = true;
        }
      }
    } else if (processFailed && !assertionFailed) {
      allKilled = false;
      results.push({
        id: m.id,
        layer: m.layer,
        description: m.description,
        status: 'ERROR',
        firstTest: `Error (not assertion failure): ${errorDetail.slice(0, 100)}`,
        durationMs
      });
    } else {
      allKilled = false;
      results.push({
        id: m.id,
        layer: m.layer,
        description: m.description,
        status: 'SURVIVED',
        firstTest: '(none)',
        durationMs
      });
    }
  }

  // Print Markdown output table
  console.log('| Mutant | Layer | Description | Status | Time | First Failing Test |');
  console.log('| --- | --- | --- | --- | ---: | --- |');
  for (const r of results) {
    console.log(`| ${r.id} | ${r.layer} | ${r.description} | **${r.status}** | ${r.durationMs}ms | ${r.firstTest} |`);
  }

  console.log('\n--- Summary ---');
  console.log(`Total mutants: ${results.length}`);
  console.log(`Killed: ${results.filter((r) => r.status === 'KILLED').length}`);
  console.log(`Survived: ${results.filter((r) => r.status === 'SURVIVED').length}`);
  console.log(`Errors: ${results.filter((r) => r.status === 'ERROR').length}`);
  console.log(`assoc-right caught specifically by parse-tree check: ${assocRightKilledByParseTree ? 'YES' : 'NO'}`);

  if (!allKilled) {
    console.error('\nFAIL: One or more mutants survived or encountered errors!');
    cleanupTempDir();
    process.exit(1);
  }

  if (!assocRightKilledByParseTree) {
    console.error("\nFAIL: 'assoc-right' was killed, but NOT by a parse-tree check!");
    cleanupTempDir();
    process.exit(1);
  }

  console.log('\nSUCCESS: All 13 mutants killed.');
  cleanupTempDir();
  process.exit(0);
} finally {
  cleanupTempDir();
}
