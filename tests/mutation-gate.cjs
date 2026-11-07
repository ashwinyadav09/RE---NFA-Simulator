#!/usr/bin/env node

/**
 * Repeatable Mutation Gate for RE → NFA (Thompson) Simulator.
 *
 * Applies the 13 canonical mutants from section 9 of .agents/skills/thompson-rules/SKILL.md
 * to a temporary copy of src/engine/index.ts using text substitution, runs the Vitest suite,
 * and reports whether each mutant was killed and which test failed first.
 *
 * Production code carries no mutation switches.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const enginePath = path.resolve(__dirname, '../src/engine/index.ts');
if (!fs.existsSync(enginePath)) {
  console.error(`Error: Engine file not found at ${enginePath}`);
  process.exit(1);
}

const originalContent = fs.readFileSync(enginePath, 'utf-8');
const isCrlf = originalContent.includes('\r\n');
const normalize = (s) => s.replace(/\r\n/g, '\n');
const denormalize = (s) => (isCrlf ? s.replace(/\r?\n/g, '\r\n') : s.replace(/\r\n/g, '\n'));

// Section 9 canonical mutants
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

function restore() {
  try {
    fs.writeFileSync(enginePath, originalContent, 'utf-8');
  } catch (err) {
    console.error('Failed to restore engine file:', err);
  }
}

process.on('exit', restore);
process.on('SIGINT', () => {
  restore();
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  restore();
  console.error('Uncaught exception:', err);
  process.exit(1);
});

// Verify all mutant targets exist uniquely
const normOrig = normalize(originalContent);
for (const m of mutants) {
  const normTarget = normalize(m.target);
  const count = normOrig.split(normTarget).length - 1;
  if (count !== 1) {
    console.error(`Error: Mutant target for '${m.id}' matched ${count} times (expected 1).`);
    process.exit(1);
  }
}

const reportFile = path.resolve(__dirname, '../.vitest-mutation-report.json');

console.log('Running Mutation Gate on 13 canonical mutants...\n');

const results = [];
let allKilled = true;
let assocRightKilledByParseTree = false;

for (const m of mutants) {
  const normTarget = normalize(m.target);
  const normReplacement = normalize(m.replacement);
  const mutated = normOrig.replace(normTarget, normReplacement);

  const start = Date.now();
  let failed = false;
  let firstFailingTest = '';
  let suiteName = '';

  try {
    fs.writeFileSync(enginePath, denormalize(mutated), 'utf-8');
    if (fs.existsSync(reportFile)) fs.unlinkSync(reportFile);

    execSync(`npx vitest run --bail 1 --reporter=json --outputFile="${reportFile}"`, {
      stdio: 'pipe',
      shell: 'cmd.exe',
      windowsHide: true
    });
  } catch (err) {
    failed = true;
    if (fs.existsSync(reportFile)) {
      try {
        const report = JSON.parse(fs.readFileSync(reportFile, 'utf-8'));
        for (const suite of report.testResults || []) {
          for (const a of suite.assertionResults || []) {
            if (a.status === 'failed') {
              firstFailingTest = a.title || a.fullName;
              suiteName = path.basename(suite.name);
              break;
            }
          }
          if (firstFailingTest) break;
        }
      } catch (parseErr) {
        firstFailingTest = 'Unknown (failed to parse JSON)';
      }
    } else {
      firstFailingTest = 'Unknown (no JSON report)';
    }
  } finally {
    restore();
    if (fs.existsSync(reportFile)) {
      try {
        fs.unlinkSync(reportFile);
      } catch {}
    }
  }

  const durationMs = Date.now() - start;

  if (failed) {
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

// Ensure restored
restore();

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
console.log(`assoc-right caught specifically by parse-tree check: ${assocRightKilledByParseTree ? 'YES' : 'NO'}`);

if (!allKilled) {
  console.error('\nFAIL: One or more mutants survived!');
  process.exit(1);
}

if (!assocRightKilledByParseTree) {
  console.error("\nFAIL: 'assoc-right' was killed, but NOT by a parse-tree check!");
  process.exit(1);
}

console.log('\nSUCCESS: All 13 mutants killed.');
process.exit(0);

