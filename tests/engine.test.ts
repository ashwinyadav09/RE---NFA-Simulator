import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { analyze, run, runLines, AnalysisResult, AnalysisSuccess } from '../src/engine/index';

function assertSuccess(result: AnalysisResult): asserts result is AnalysisSuccess {
  if (!result.ok) {
    throw new Error(`Expected analysis success, got error: ${result.code} - ${result.message}`);
  }
}

const fixturePath = resolve(__dirname, '../.agents/skills/thompson-rules/fixtures/worked-example.json');
const workedExample = JSON.parse(readFileSync(fixturePath, 'utf-8'));
const step1 = workedExample.steps[0];

test('analyzing "a" matches single-symbol fragment in worked-example fixture', () => {
  const result = analyze('a');
  assertSuccess(result);

  expect(result.nfa.states).toEqual(step1.newStates);
  expect(result.nfa.start).toBe(step1.result.start);
  expect(result.nfa.accept).toBe(step1.result.accept);
  expect(result.nfa.transitions).toEqual(step1.newTransitions);
});

test('analyzing "(a|b)*a" produces tokens and postfix matching worked-example fixture', () => {
  const result = analyze('(a|b)*a');
  assertSuccess(result);

  // Verify tokens
  expect(result.tokens.map(t => ({ type: t.type, symbol: t.symbol, position: t.position }))).toEqual([
    { type: 'LPAREN', symbol: undefined, position: 0 },
    { type: 'SYMBOL', symbol: 'a', position: 1 },
    { type: 'UNION', symbol: undefined, position: 2 },
    { type: 'SYMBOL', symbol: 'b', position: 3 },
    { type: 'RPAREN', symbol: undefined, position: 4 },
    { type: 'STAR', symbol: undefined, position: 5 },
    { type: 'SYMBOL', symbol: 'a', position: 6 }
  ]);

  // Postfix types match workedExample.postfix
  expect(result.postfix.map(t => t.type)).toEqual(workedExample.postfix);

  // Implicit CONCAT takes position of the operand that follows it (position 6 for 'a')
  const concatToken = result.postfix[result.postfix.length - 1];
  expect(concatToken.type).toBe('CONCAT');
  expect(concatToken.position).toBe(6);
});

test('step-by-step construction for "(a|b)*a" matches worked-example fixture exactly', () => {
  const result = analyze('(a|b)*a');
  assertSuccess(result);

  expect(result.steps.length).toBe(workedExample.steps.length);

  for (let i = 0; i < workedExample.steps.length; i++) {
    const actualStep = result.steps[i];
    const expectedStep = workedExample.steps[i];

    expect(actualStep.index).toBe(expectedStep.index);
    expect(actualStep.token).toBe(expectedStep.token);
    expect(actualStep.rule).toBe(expectedStep.rule);
    expect(actualStep.newStates).toEqual(expectedStep.newStates);
    expect(actualStep.newTransitions).toEqual(expectedStep.newTransitions);
    expect(actualStep.result).toEqual(expectedStep.result);
    expect(actualStep.stackDepthAfter).toBe(expectedStep.stackDepthAfter);
  }
});

test('analyzing "(a|b)*a" produces final NFA, transition table, and initial ε-closure matching worked-example fixture', () => {
  const result = analyze('(a|b)*a');
  assertSuccess(result);

  expect(result.nfa.states).toEqual(workedExample.nfa.states);
  expect(result.nfa.start).toBe(workedExample.nfa.start);
  expect(result.nfa.accept).toBe(workedExample.nfa.accept);
  expect(result.nfa.transitions).toEqual(workedExample.nfa.transitions);

  expect(result.stats).toEqual({ states: 10, transitions: 12 });
  expect(result.alphabet).toEqual(['a', 'b']);

  expect(result.transitionTable).toEqual(workedExample.transitionTable);
  expect(result.initialClosure).toEqual(workedExample.initialClosure);
});

test('steps store independent copies and step-log replay reproduces final NFA exactly', () => {
  const result = analyze('(a|b)*a');
  assertSuccess(result);

  // Verify independence of copies
  const originalStep0Result = { ...result.steps[0].result };
  result.nfa.states.push(999);
  result.nfa.transitions.push({ from: 999, to: 1000, label: 'x' });
  result.steps[0].stackAfter[0].start = 888;

  expect(result.steps[0].result).toEqual(originalStep0Result);
  expect(result.steps[0].newStates).not.toContain(999);
  expect(result.steps[0].newTransitions).not.toContainEqual({ from: 999, to: 1000, label: 'x' });

  // Re-analyze cleanly to test replay
  const cleanResult = analyze('(a|b)*a');
  assertSuccess(cleanResult);
  const replayedStates: number[] = [];
  const replayedTransitions: { from: number; to: number; label: string }[] = [];

  for (const step of cleanResult.steps) {
    replayedStates.push(...step.newStates);
    replayedTransitions.push(...step.newTransitions);
    expect(step.stackAfter.length).toBe(step.stackDepthAfter);
    expect(step.stackAfter[step.stackAfter.length - 1]).toEqual(step.result);
  }

  expect(replayedStates).toEqual(cleanResult.nfa.states);
  expect(replayedTransitions).toEqual(cleanResult.nfa.transitions);
  expect(cleanResult.steps[cleanResult.steps.length - 1].result.start).toBe(cleanResult.nfa.start);
  expect(cleanResult.steps[cleanResult.steps.length - 1].result.accept).toBe(cleanResult.nfa.accept);
});

const classicAbbPath = resolve(__dirname, '../.agents/skills/thompson-rules/fixtures/classic-abb.json');
const classicAbbFixture = JSON.parse(readFileSync(classicAbbPath, 'utf-8'));

test('invariants I1-I4, no dangling edges, and size formulas hold for fixture expressions', () => {
  // Test worked-example expression (a|b)*a
  const resWorked = analyze(workedExample.source);
  assertSuccess(resWorked);
  expect(resWorked.invariants).toEqual(workedExample.invariants);
  expect(resWorked.stats.states).toBe(10);
  expect(resWorked.stats.transitions).toBe(12);

  // Test classic-abb expression (a|b)*abb
  const resAbb = analyze(classicAbbFixture.source);
  assertSuccess(resAbb);
  expect(resAbb.invariants).toEqual({
    I1: true,
    I2: true,
    I3: true,
    I4: true,
    noDanglingEdges: true
  });
  expect(resAbb.stats.states).toBe(classicAbbFixture.epsilonLink.states);
  expect(resAbb.stats.transitions).toBe(classicAbbFixture.epsilonLink.transitions);
  expect(resAbb.stats.states).toBe(14);
  expect(resAbb.stats.transitions).toBe(16);
});

test('structural edge cases build correctly: #, @, nested groups, and stacked operators', () => {
  // Empty atom '#'
  const resEmpty = analyze('#');
  assertSuccess(resEmpty);
  expect(resEmpty.stats.states).toBe(2);
  expect(resEmpty.stats.transitions).toBe(0);
  expect(resEmpty.nfa.states).toEqual([0, 1]);
  expect(resEmpty.nfa.start).toBe(0);
  expect(resEmpty.nfa.accept).toBe(1);
  expect(resEmpty.nfa.transitions).toEqual([]);
  expect(resEmpty.invariants.I1).toBe(true);
  expect(resEmpty.invariants.I2).toBe(true);
  expect(resEmpty.invariants.I3).toBe(true);
  expect(resEmpty.invariants.I4).toBe(true);
  expect(resEmpty.invariants.noDanglingEdges).toBe(true);

  // Epsilon atom '@'
  const resEps = analyze('@');
  assertSuccess(resEps);
  expect(resEps.stats.states).toBe(2);
  expect(resEps.stats.transitions).toBe(1);
  expect(resEps.nfa.states).toEqual([0, 1]);
  expect(resEps.nfa.start).toBe(0);
  expect(resEps.nfa.accept).toBe(1);
  expect(resEps.nfa.transitions).toEqual([{ from: 0, to: 1, label: 'ε' }]);
  expect(resEps.invariants.I1).toBe(true);
  expect(resEps.invariants.I2).toBe(true);
  expect(resEps.invariants.I3).toBe(true);
  expect(resEps.invariants.I4).toBe(true);
  expect(resEps.invariants.noDanglingEdges).toBe(true);

  // Unicode aliases '∅' and 'ε'
  const resEmptyUnicode = analyze('∅');
  assertSuccess(resEmptyUnicode);
  expect(resEmptyUnicode.stats).toEqual({ states: 2, transitions: 0 });
  const resEpsUnicode = analyze('ε');
  assertSuccess(resEpsUnicode);
  expect(resEpsUnicode.stats).toEqual({ states: 2, transitions: 1 });

  // Nested groups ((a|b))
  const resNested = analyze('((a|b))');
  assertSuccess(resNested);
  expect(resNested.invariants.I1).toBe(true);
  expect(resNested.invariants.I2).toBe(true);
  expect(resNested.invariants.I3).toBe(true);
  expect(resNested.invariants.I4).toBe(true);
  expect(resNested.invariants.noDanglingEdges).toBe(true);
  expect(resNested.stats).toEqual({ states: 6, transitions: 6 });

  // Stacked postfix a**
  const resStacked = analyze('a**');
  assertSuccess(resStacked);
  expect(resStacked.invariants.I1).toBe(true);
  expect(resStacked.invariants.I2).toBe(true);
  expect(resStacked.invariants.I3).toBe(true);
  expect(resStacked.invariants.I4).toBe(true);
  expect(resStacked.invariants.noDanglingEdges).toBe(true);
  // a: 2 states, 1 tr. a*: 2+2=4 states, 1+4=5 tr. a**: 4+2=6 states, 5+4=9 tr.
  expect(resStacked.stats).toEqual({ states: 6, transitions: 9 });
});

test('simulation on "(a|b)*a" produces traces and verdicts matching worked-example fixture', () => {
  const analysis = analyze('(a|b)*a');
  assertSuccess(analysis);
  const testInputs = ['ba', 'ab', 'a', ''];

  for (const input of testInputs) {
    const expected = workedExample.traces[input];
    const result = run(analysis.nfa, analysis.alphabet, input);

    expect(result.initialClosure).toEqual(workedExample.initialClosure);
    expect(result.afterEachSymbol).toEqual(expected.afterEachSymbol);
    expect(result.trace).toEqual([workedExample.initialClosure, ...expected.afterEachSymbol]);
    expect(result.accepted).toBe(expected.accepted);
    expect(result.verdict).toBe(expected.accepted ? 'ACCEPT' : 'REJECT');
  }
});

test('dead active set is reported with position and simulation terminates early', () => {
  const analysis = analyze('(a|b)*a');
  assertSuccess(analysis);
  const extendedAlphabet = ['a', 'b', 'c'];

  // Test 'cab': 'c' empties the set at index 0, so 'a' and 'b' must not be processed
  const resCab = run(analysis.nfa, extendedAlphabet, 'cab');
  expect(resCab.status).toBe('dead');
  expect(resCab.position).toBe(0);
  expect(resCab.accepted).toBe(false);
  expect(resCab.verdict).toBe('REJECT');
  expect(resCab.afterEachSymbol).toEqual([[]]);
  expect(resCab.trace).toEqual([workedExample.initialClosure, []]);

  // Test 'bc': 'b' transitions normally, 'c' empties set at index 1
  const resBc = run(analysis.nfa, extendedAlphabet, 'bc');
  expect(resBc.status).toBe('dead');
  expect(resBc.position).toBe(1);
  expect(resBc.accepted).toBe(false);
  expect(resBc.verdict).toBe('REJECT');
  expect(resBc.afterEachSymbol).toEqual([
    workedExample.traces['ba'].afterEachSymbol[0],
    []
  ]);
  expect(resBc.trace).toEqual([
    workedExample.initialClosure,
    workedExample.traces['ba'].afterEachSymbol[0],
    []
  ]);
});

test('symbol outside alphabet is reported at its position with the trace so far', () => {
  const analysis = analyze('(a|b)*a');
  assertSuccess(analysis);
  const inferredAlphabet = analysis.alphabet; // ['a', 'b']

  // 'bx' where 'x' is not in alphabet at position 1
  const resBx = run(analysis.nfa, inferredAlphabet, 'bx');
  expect(resBx.status).toBe('out_of_alphabet');
  expect(resBx.position).toBe(1);
  expect(resBx.symbol).toBe('x');
  expect(resBx.accepted).toBe(false);
  expect(resBx.verdict).toBe('REJECT');
  expect(resBx.afterEachSymbol).toEqual([workedExample.traces['ba'].afterEachSymbol[0]]);
  expect(resBx.trace).toEqual([workedExample.initialClosure, workedExample.traces['ba'].afterEachSymbol[0]]);

  // 'x' directly where 'x' is not in alphabet at position 0
  const resX = run(analysis.nfa, inferredAlphabet, 'x');
  expect(resX.status).toBe('out_of_alphabet');
  expect(resX.position).toBe(0);
  expect(resX.symbol).toBe('x');
  expect(resX.accepted).toBe(false);
  expect(resX.afterEachSymbol).toEqual([]);
  expect(resX.trace).toEqual([workedExample.initialClosure]);
});

test('strings and positions are processed by code point for non-BMP symbols', () => {
  // 🚀 is U+1F680, taking 2 UTF-16 code units (surrogate pair)
  const analysis = analyze('🚀');
  assertSuccess(analysis);
  expect(analysis.alphabet).toEqual(['🚀']);

  // '🚀' accepted
  const resAccept = run(analysis.nfa, analysis.alphabet, '🚀');
  expect(resAccept.accepted).toBe(true);
  expect(resAccept.verdict).toBe('ACCEPT');
  expect(resAccept.afterEachSymbol.length).toBe(1);

  // '🚀🚀' rejected
  const resReject = run(analysis.nfa, analysis.alphabet, '🚀🚀');
  expect(resReject.accepted).toBe(false);
  expect(resReject.verdict).toBe('REJECT');

  // '🚀x' where 'x' is outside alphabet: position must be 1 (code point index), not 2 (UTF-16 index)
  const resError = run(analysis.nfa, analysis.alphabet, '🚀x');
  expect(resError.status).toBe('out_of_alphabet');
  expect(resError.position).toBe(1);
  expect(resError.symbol).toBe('x');
});

test('runLines returns one result and verdict per line for multi-line inputs', () => {
  const analysis = analyze('(a|b)*a');
  assertSuccess(analysis);
  const multiLineInput = 'ba\nab\na\n';
  // 4 lines: 'ba', 'ab', 'a', ''
  const results = runLines(analysis.nfa, analysis.alphabet, multiLineInput);

  expect(results.length).toBe(4);
  expect(results.map((r) => r.verdict)).toEqual(['ACCEPT', 'REJECT', 'ACCEPT', 'REJECT']);
  expect(results[0].afterEachSymbol).toEqual(workedExample.traces['ba'].afterEachSymbol);
  expect(results[1].afterEachSymbol).toEqual(workedExample.traces['ab'].afterEachSymbol);
  expect(results[2].afterEachSymbol).toEqual(workedExample.traces['a'].afterEachSymbol);
  expect(results[3].afterEachSymbol).toEqual(workedExample.traces[''].afterEachSymbol);
});

test('symbol step never follows an ε-transition even if alphabet includes ε', () => {
  const analysis = analyze('a*');
  assertSuccess(analysis);
  const result = run(analysis.nfa, ['a', 'ε'], 'ε');

  expect(result.status).toBe('dead');
  expect(result.position).toBe(0);
  expect(result.accepted).toBe(false);
});

test('empty or whitespace-only input returns EMPTY_INPUT with no position and hint', () => {
  const emptyRes = analyze('');
  expect(emptyRes.ok).toBe(false);
  if (!emptyRes.ok) {
    expect(emptyRes.code).toBe('EMPTY_INPUT');
    expect(emptyRes.position).toBeUndefined();
    expect(emptyRes.hint).toBeDefined();
  }

  const wsRes = analyze('   \t\n ');
  expect(wsRes.ok).toBe(false);
  if (!wsRes.ok) {
    expect(wsRes.code).toBe('EMPTY_INPUT');
    expect(wsRes.position).toBeUndefined();
    expect(wsRes.hint).toBeDefined();
  }
});

test('EMPTY_GROUP reported at the position of ( for () and nested empty groups', () => {
  const res1 = analyze('()');
  expect(res1.ok).toBe(false);
  if (!res1.ok) {
    expect(res1.code).toBe('EMPTY_GROUP');
    expect(res1.position).toBe(0);
  }

  const res2 = analyze('(()a)');
  expect(res2.ok).toBe(false);
  if (!res2.ok) {
    expect(res2.code).toBe('EMPTY_GROUP');
    expect(res2.position).toBe(1);
  }

  const res3 = analyze('a|()');
  expect(res3.ok).toBe(false);
  if (!res3.ok) {
    expect(res3.code).toBe('EMPTY_GROUP');
    expect(res3.position).toBe(2);
  }
});

test('NOTHING_TO_REPEAT reported at postfix operator position when operand expected', () => {
  const res1 = analyze('*a');
  expect(res1.ok).toBe(false);
  if (!res1.ok) {
    expect(res1.code).toBe('NOTHING_TO_REPEAT');
    expect(res1.position).toBe(0);
  }

  const res2 = analyze('a|*b');
  expect(res2.ok).toBe(false);
  if (!res2.ok) {
    expect(res2.code).toBe('NOTHING_TO_REPEAT');
    expect(res2.position).toBe(2);
  }

  const res3 = analyze('(*)');
  expect(res3.ok).toBe(false);
  if (!res3.ok) {
    expect(res3.code).toBe('NOTHING_TO_REPEAT');
    expect(res3.position).toBe(1);
  }
});

test('UNBALANCED_RPAREN reported at the offending ) position', () => {
  const res1 = analyze(')a');
  expect(res1.ok).toBe(false);
  if (!res1.ok) {
    expect(res1.code).toBe('UNBALANCED_RPAREN');
    expect(res1.position).toBe(0);
  }

  const res2 = analyze('a)');
  expect(res2.ok).toBe(false);
  if (!res2.ok) {
    expect(res2.code).toBe('UNBALANCED_RPAREN');
    expect(res2.position).toBe(1);
  }

  const res3 = analyze('(a))');
  expect(res3.ok).toBe(false);
  if (!res3.ok) {
    expect(res3.code).toBe('UNBALANCED_RPAREN');
    expect(res3.position).toBe(3);
  }
});

test('MISSING_OPERAND reported at the offending operator position', () => {
  const cases: [string, number][] = [
    ['|a', 0],
    ['a|', 1],
    ['a||b', 1],
    ['(|a)', 1],
    ['(a|)', 2],
    ['a(|b)c', 2]
  ];

  for (const [source, expectedPos] of cases) {
    const res = analyze(source);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('MISSING_OPERAND');
      expect(res.position).toBe(expectedPos);
    }
  }
});

test('end-of-input check: missing right operand takes precedence over unclosed parenthesis', () => {
  const res = analyze('(a|');
  expect(res.ok).toBe(false);
  if (!res.ok) {
    expect(res.code).toBe('MISSING_OPERAND');
    expect(res.position).toBe(2);
  }
});

test('UNBALANCED_LPAREN reported at first unclosed ( scanning left-to-right', () => {
  const cases: [string, number][] = [
    ['a(', 1],
    ['(a', 0],
    ['((a)', 0]
  ];

  for (const [source, expectedPos] of cases) {
    const res = analyze(source);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('UNBALANCED_LPAREN');
      expect(res.position).toBe(expectedPos);
    }
  }
});

const errorCasesFixturePath = resolve(__dirname, '../.agents/skills/thompson-rules/fixtures/error-cases.json');
const errorCasesFixture = JSON.parse(readFileSync(errorCasesFixturePath, 'utf-8'));

test('error-case fixture cases return expected code and position (ticket 06 textbook cases still disabled)', () => {
  for (const c of errorCasesFixture.cases) {
    // Note: Cases requiring textbook notation are enabled by ticket 06
    if (c.notation === 'textbook') {
      // Skipped: enabled by ticket 06 (settings, notation, merge, alphabet)
      continue;
    }

    const res = analyze(c.source, { notation: c.notation });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe(c.code);
      expect(res.position).toBe(c.pos);
    }
  }
});

test('valid expressions from error-cases fixture build without error', () => {
  for (const expr of errorCasesFixture.valid) {
    const res = analyze(expr);
    expect(res.ok).toBe(true);
    assertSuccess(res);
    expect(res.nfa.states.length).toBeGreaterThan(0);
  }
});

test('syntax error position counts whitespace and indexes by code points for non-BMP characters', () => {
  // '🚀 |': '🚀' (index 0), ' ' (index 1), '|' (index 2)
  // In UTF-16, '🚀' takes 2 units so '|' would be at UTF-16 index 3.
  // The error position must be 2 (code point index).
  const res1 = analyze('🚀 |');
  expect(res1.ok).toBe(false);
  if (!res1.ok) {
    expect(res1.code).toBe('MISSING_OPERAND');
    expect(res1.position).toBe(2);
  }

  // '  🚀  *': spaces at 0, 1; '🚀' at 2; spaces at 3, 4; '*' at 5
  // '*' after '🚀' is valid postfix: '🚀*'
  // But with spaces: '  🚀  |' has '|' at code point 5:
  const res2 = analyze('  🚀  |');
  expect(res2.ok).toBe(false);
  if (!res2.ok) {
    expect(res2.code).toBe('MISSING_OPERAND');
    expect(res2.position).toBe(5);
  }
});

test('pending binary operator does not mask unclosed group at end of input', () => {
  const res1 = analyze('a|(b');
  expect(res1.ok).toBe(false);
  if (!res1.ok) {
    expect(res1.code).toBe('UNBALANCED_LPAREN');
    expect(res1.position).toBe(2);
  }

  const res2 = analyze('(a|(b');
  expect(res2.ok).toBe(false);
  if (!res2.ok) {
    expect(res2.code).toBe('UNBALANCED_LPAREN');
    expect(res2.position).toBe(0);
  }

  // Regression guards
  const reg1 = analyze('(a|');
  expect(reg1.ok).toBe(false);
  if (!reg1.ok) {
    expect(reg1.code).toBe('MISSING_OPERAND');
    expect(reg1.position).toBe(2);
  }

  const reg2 = analyze('a|');
  expect(reg2.ok).toBe(false);
  if (!reg2.ok) {
    expect(reg2.code).toBe('MISSING_OPERAND');
    expect(reg2.position).toBe(1);
  }

  const reg3 = analyze('(a|)');
  expect(reg3.ok).toBe(false);
  if (!reg3.ok) {
    expect(reg3.code).toBe('MISSING_OPERAND');
    expect(reg3.position).toBe(2);
  }

  const reg4 = analyze('a|(b)');
  expect(reg4.ok).toBe(true);
  assertSuccess(reg4);
});







// ---- Ticket 05: Plus, optional, stacked operators, parse tree, error cases ----

test('[T05-1] PLUS fragment for "a+" has 4 states, 4 transitions, invariants hold, correct language', () => {
  // Size formula: 2*(1 atom + 1 unary) = 4 states; 1 symbol + 3 plus = 4 transitions
  const res = analyze('a+');
  assertSuccess(res);
  expect(res.stats.states).toBe(4);
  expect(res.stats.transitions).toBe(4);

  // States in creation order: atom s=0, f=1; plus s=2, f=3
  expect(res.nfa.states).toEqual([0, 1, 2, 3]);
  expect(res.nfa.start).toBe(2);
  expect(res.nfa.accept).toBe(3);

  // Rule table order: base atom, then s -ε-> A.s, A.f -ε-> f, A.f -ε-> A.s
  expect(res.nfa.transitions).toEqual([
    { from: 0, to: 1, label: 'a' },
    { from: 2, to: 0, label: 'ε' },
    { from: 1, to: 3, label: 'ε' },
    { from: 1, to: 0, label: 'ε' },
  ]);

  expect(res.invariants).toEqual({ I1: true, I2: true, I3: true, I4: true, noDanglingEdges: true });

  // Language: accepts a, aa, aaa; rejects empty
  expect(run(res.nfa, res.alphabet, '').accepted).toBe(false);
  expect(run(res.nfa, res.alphabet, 'a').accepted).toBe(true);
  expect(run(res.nfa, res.alphabet, 'aa').accepted).toBe(true);
  expect(run(res.nfa, res.alphabet, 'aaa').accepted).toBe(true);
});

test('[T05-2] OPT fragment for "a?" has 4 states, 4 transitions, invariants hold, correct language', () => {
  // Size formula: 2*(1 atom + 1 unary) = 4 states; 1 symbol + 3 opt = 4 transitions
  const res = analyze('a?');
  assertSuccess(res);
  expect(res.stats.states).toBe(4);
  expect(res.stats.transitions).toBe(4);

  // States in creation order: atom s=0, f=1; opt s=2, f=3
  expect(res.nfa.states).toEqual([0, 1, 2, 3]);
  expect(res.nfa.start).toBe(2);
  expect(res.nfa.accept).toBe(3);

  // Rule table order: base atom, then s -ε-> A.s, A.f -ε-> f, s -ε-> f
  expect(res.nfa.transitions).toEqual([
    { from: 0, to: 1, label: 'a' },
    { from: 2, to: 0, label: 'ε' },
    { from: 1, to: 3, label: 'ε' },
    { from: 2, to: 3, label: 'ε' },
  ]);

  expect(res.invariants).toEqual({ I1: true, I2: true, I3: true, I4: true, noDanglingEdges: true });

  // Language: accepts empty and a; rejects aa
  expect(run(res.nfa, res.alphabet, '').accepted).toBe(true);
  expect(run(res.nfa, res.alphabet, 'a').accepted).toBe(true);
  expect(run(res.nfa, res.alphabet, 'aa').accepted).toBe(false);
});

test('[T05-3] Stacked unary: "a+?" is (a+)?, "a**" is (a*)*, both have correct sizes and invariants', () => {
  // a+? = (a+)?: 2*(1 atom + 2 unary) = 6 states; 1 symbol + 3 plus + 3 opt = 7 transitions
  const resAPlus = analyze('a+?');
  assertSuccess(resAPlus);
  expect(resAPlus.stats.states).toBe(6);
  expect(resAPlus.stats.transitions).toBe(7);
  expect(resAPlus.invariants).toEqual({ I1: true, I2: true, I3: true, I4: true, noDanglingEdges: true });
  // Language: accepts "", "a", "aa"; rejects "b"
  expect(run(resAPlus.nfa, resAPlus.alphabet, '').accepted).toBe(true);
  expect(run(resAPlus.nfa, resAPlus.alphabet, 'a').accepted).toBe(true);
  expect(run(resAPlus.nfa, resAPlus.alphabet, 'aa').accepted).toBe(true);

  // a** = (a*)*: 2*(1 atom + 2 unary) = 6 states; 1 symbol + 4 star + 4 star = 9 transitions
  const resAStar2 = analyze('a**');
  assertSuccess(resAStar2);
  expect(resAStar2.stats.states).toBe(6);
  expect(resAStar2.stats.transitions).toBe(9);
  expect(resAStar2.invariants).toEqual({ I1: true, I2: true, I3: true, I4: true, noDanglingEdges: true });
  // Language: accepts "", "a", "aa"
  expect(run(resAStar2.nfa, resAStar2.alphabet, '').accepted).toBe(true);
  expect(run(resAStar2.nfa, resAStar2.alphabet, 'a').accepted).toBe(true);
  expect(run(resAStar2.nfa, resAStar2.alphabet, 'aa').accepted).toBe(true);
});

test('[T05-4] analyze returns a parseTree built from the postfix form for atoms and unary operators', () => {
  // Atom: sym, eps, empty
  const rSym = analyze('a');
  assertSuccess(rSym);
  expect((rSym as any).parseTree).toEqual({ k: 'sym', v: 'a' });

  const rEps = analyze('@');
  assertSuccess(rEps);
  expect((rEps as any).parseTree).toEqual({ k: 'eps' });

  const rEmpty = analyze('#');
  assertSuccess(rEmpty);
  expect((rEmpty as any).parseTree).toEqual({ k: 'empty' });

  // Unary operators
  const rStar = analyze('a*');
  assertSuccess(rStar);
  expect((rStar as any).parseTree).toEqual({ k: 'star', c: { k: 'sym', v: 'a' } });

  const rPlus = analyze('a+');
  assertSuccess(rPlus);
  expect((rPlus as any).parseTree).toEqual({ k: 'plus', c: { k: 'sym', v: 'a' } });

  const rOpt = analyze('a?');
  assertSuccess(rOpt);
  expect((rOpt as any).parseTree).toEqual({ k: 'opt', c: { k: 'sym', v: 'a' } });

  // Stacked: a+? = opt(plus(a))
  const rPlusOpt = analyze('a+?');
  assertSuccess(rPlusOpt);
  expect((rPlusOpt as any).parseTree).toEqual({ k: 'opt', c: { k: 'plus', c: { k: 'sym', v: 'a' } } });

  // Stacked: a** = star(star(a))
  const rStarStar = analyze('a**');
  assertSuccess(rStarStar);
  expect((rStarStar as any).parseTree).toEqual({ k: 'star', c: { k: 'star', c: { k: 'sym', v: 'a' } } });
});

test('[T05-5] parseTree is left-nested for binary operators and respects concat-over-union precedence', () => {
  // Left-nested concatenation: abc = cat(cat(a,b),c)
  const rABC = analyze('abc');
  assertSuccess(rABC);
  expect(rABC.parseTree).toEqual({
    k: 'cat',
    l: { k: 'cat', l: { k: 'sym', v: 'a' }, r: { k: 'sym', v: 'b' } },
    r: { k: 'sym', v: 'c' }
  });

  // Left-nested union: a|b|c = union(union(a,b),c)
  const rABC2 = analyze('a|b|c');
  assertSuccess(rABC2);
  expect(rABC2.parseTree).toEqual({
    k: 'union',
    l: { k: 'union', l: { k: 'sym', v: 'a' }, r: { k: 'sym', v: 'b' } },
    r: { k: 'sym', v: 'c' }
  });

  // Concat binds tighter than union: a|bc = union(a, cat(b,c))
  const rABC3 = analyze('a|bc');
  assertSuccess(rABC3);
  expect(rABC3.parseTree).toEqual({
    k: 'union',
    l: { k: 'sym', v: 'a' },
    r: { k: 'cat', l: { k: 'sym', v: 'b' }, r: { k: 'sym', v: 'c' } }
  });

  // ab|c = union(cat(a,b), c)
  const rABC4 = analyze('ab|c');
  assertSuccess(rABC4);
  expect(rABC4.parseTree).toEqual({
    k: 'union',
    l: { k: 'cat', l: { k: 'sym', v: 'a' }, r: { k: 'sym', v: 'b' } },
    r: { k: 'sym', v: 'c' }
  });

  // Classic (a|b)*a = cat(star(union(a,b)), a)
  const rClassic = analyze('(a|b)*a');
  assertSuccess(rClassic);
  expect(rClassic.parseTree).toEqual({
    k: 'cat',
    l: { k: 'star', c: { k: 'union', l: { k: 'sym', v: 'a' }, r: { k: 'sym', v: 'b' } } },
    r: { k: 'sym', v: 'a' }
  });
});
