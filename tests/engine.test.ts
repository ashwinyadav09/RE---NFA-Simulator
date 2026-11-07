import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { analyze, run, runLines, validateAlphabet, getStepSnapshot, EPS, CAPS, AnalysisResult, AnalysisSuccess } from '../src/engine/index';
import { parseRD } from './oracles';

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
    expect({ start: actualStep.result.start, accept: actualStep.result.accept }).toEqual(expectedStep.result);
    expect(actualStep.stackDepthAfter).toBe(expectedStep.stackDepthAfter);
    expect(actualStep.stackAfter.map((f) => ({ start: f.start, accept: f.accept }))).toEqual(expectedStep.stackAfter);
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

test('error-case fixture cases return expected code and position', () => {
  for (const c of errorCasesFixture.cases) {
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

test('[T05-4] analyze returns a parseTree matching Oracle 4 for atoms and unary operators', () => {
  // Atom: sym, eps, empty
  const rSym = analyze('a');
  assertSuccess(rSym);
  expect(rSym.parseTree).toEqual(parseRD('a'));

  const rEps = analyze('@');
  assertSuccess(rEps);
  expect(rEps.parseTree).toEqual(parseRD('@'));

  const rEmpty = analyze('#');
  assertSuccess(rEmpty);
  expect(rEmpty.parseTree).toEqual(parseRD('#'));

  // Unary operators
  const rStar = analyze('a*');
  assertSuccess(rStar);
  expect(rStar.parseTree).toEqual(parseRD('a*'));

  const rPlus = analyze('a+');
  assertSuccess(rPlus);
  expect(rPlus.parseTree).toEqual(parseRD('a+'));

  const rOpt = analyze('a?');
  assertSuccess(rOpt);
  expect(rOpt.parseTree).toEqual(parseRD('a?'));

  // Stacked: a+? = opt(plus(a))
  const rPlusOpt = analyze('a+?');
  assertSuccess(rPlusOpt);
  expect(rPlusOpt.parseTree).toEqual(parseRD('a+?'));

  // Stacked: a** = star(star(a))
  const rStarStar = analyze('a**');
  assertSuccess(rStarStar);
  expect(rStarStar.parseTree).toEqual(parseRD('a**'));
});

test('[T05-5] parseTree matches Oracle 4 with left-nested binary operators and concat-over-union precedence', () => {
  // Left-nested concatenation: abc = cat(cat(a,b),c)
  const rABC = analyze('abc');
  assertSuccess(rABC);
  expect(rABC.parseTree).toEqual(parseRD('abc'));

  // Left-nested union: a|b|c = union(union(a,b),c)
  const rABC2 = analyze('a|b|c');
  assertSuccess(rABC2);
  expect(rABC2.parseTree).toEqual(parseRD('a|b|c'));

  // Concat binds tighter than union: a|bc = union(a, cat(b,c))
  const rABC3 = analyze('a|bc');
  assertSuccess(rABC3);
  expect(rABC3.parseTree).toEqual(parseRD('a|bc'));

  // ab|c = union(cat(a,b), c)
  const rABC4 = analyze('ab|c');
  assertSuccess(rABC4);
  expect(rABC4.parseTree).toEqual(parseRD('ab|c'));

  // Classic (a|b)*a = cat(star(union(a,b)), a)
  const rClassic = analyze('(a|b)*a');
  assertSuccess(rClassic);
  expect(rClassic.parseTree).toEqual(parseRD('(a|b)*a'));
});

// ---- Ticket 06: Settings: textbook notation, merge mode, ε/∅ input, alphabet ----

test('[T06-1] Textbook notation: "+" is union, one-or-more unavailable, "+a" gives MISSING_OPERAND at pos 0', () => {
  const res = analyze('a+b', { notation: 'textbook' });
  assertSuccess(res);
  expect(res.tokens.map((t) => t.type)).toEqual(['SYMBOL', 'UNION', 'SYMBOL']);
  expect(res.postfix.map((t) => t.type)).toEqual(['SYMBOL', 'SYMBOL', 'UNION']);
  expect(res.parseTree).toEqual({
    k: 'union',
    l: { k: 'sym', v: 'a' },
    r: { k: 'sym', v: 'b' }
  });
  expect(res.stats.states).toBe(6);
  expect(res.stats.transitions).toBe(6);

  // In textbook mode, '+' is not one-or-more; '+a' has missing operand before '+' at pos 0
  const resMissing = analyze('+a', { notation: 'textbook' });
  expect(resMissing.ok).toBe(false);
  if (!resMissing.ok) {
    expect(resMissing.code).toBe('MISSING_OPERAND');
    expect(resMissing.position).toBe(0);
    expect(resMissing.message).toContain('+');
  }
});

test('[T06-2] Textbook notation: "|" gives NOT_AN_OPERATOR with hint at exact position, not an alphabet symbol', () => {
  const res = analyze('a|b', { notation: 'textbook' });
  expect(res.ok).toBe(false);
  if (!res.ok) {
    expect(res.code).toBe('NOT_AN_OPERATOR');
    expect(res.position).toBe(1);
    expect(res.message).toContain('|');
    expect(res.hint).toBe("Use '+' for union in textbook mode");
  }

  // Position with spaces: '  a  |  b' -> '|' at code-point index 5
  const resSpaces = analyze('  a  |  b', { notation: 'textbook' });
  expect(resSpaces.ok).toBe(false);
  if (!resSpaces.ok) {
    expect(resSpaces.code).toBe('NOT_AN_OPERATOR');
    expect(resSpaces.position).toBe(5);
  }
});

test('[T06-3] Textbook notation supports "?" and "*" as unary operators and passes all error-case fixture cases', () => {
  // 'a?' in textbook mode
  const resOpt = analyze('a?', { notation: 'textbook' });
  assertSuccess(resOpt);
  expect(resOpt.stats.states).toBe(4);
  expect(resOpt.stats.transitions).toBe(4);
  expect(resOpt.parseTree).toEqual({ k: 'opt', c: { k: 'sym', v: 'a' } });

  // '(a+b)?' in textbook mode
  const resUnionOpt = analyze('(a+b)?', { notation: 'textbook' });
  assertSuccess(resUnionOpt);
  expect(resUnionOpt.parseTree).toEqual({
    k: 'opt',
    c: {
      k: 'union',
      l: { k: 'sym', v: 'a' },
      r: { k: 'sym', v: 'b' }
    }
  });

  // Verify simulation of (a+b)? accepts "", "a", "b", rejects "ab"
  expect(run(resUnionOpt.nfa, resUnionOpt.alphabet, '').accepted).toBe(true);
  expect(run(resUnionOpt.nfa, resUnionOpt.alphabet, 'a').accepted).toBe(true);
  expect(run(resUnionOpt.nfa, resUnionOpt.alphabet, 'b').accepted).toBe(true);
  expect(run(resUnionOpt.nfa, resUnionOpt.alphabet, 'ab').accepted).toBe(false);
});

test('[T06-4] Textbook golden cases "(a+b)*a" and "(a+b)*abb" match standard notation semantics and sizes', () => {
  const resTextbook = analyze('(a+b)*a', { notation: 'textbook' });
  const resStandard = analyze('(a|b)*a', { notation: 'standard' });
  assertSuccess(resTextbook);
  assertSuccess(resStandard);

  expect(resTextbook.stats).toEqual(resStandard.stats);
  expect(resTextbook.nfa.states).toEqual(resStandard.nfa.states);
  expect(resTextbook.nfa.transitions).toEqual(resStandard.nfa.transitions);
  expect(resTextbook.transitionTable).toEqual(resStandard.transitionTable);

  for (const str of ['a', 'ba', 'bba', 'aba', '', 'b', 'ab']) {
    expect(run(resTextbook.nfa, resTextbook.alphabet, str).accepted)
      .toBe(run(resStandard.nfa, resStandard.alphabet, str).accepted);
  }

  // Classic abb in textbook notation
  const resAbbTextbook = analyze('(a+b)*abb', { notation: 'textbook' });
  assertSuccess(resAbbTextbook);
  expect(resAbbTextbook.stats).toEqual({ states: 14, transitions: 16 });
  for (const s of classicAbbFixture.accepts) {
    expect(run(resAbbTextbook.nfa, resAbbTextbook.alphabet, s).accepted).toBe(true);
  }
  for (const s of classicAbbFixture.rejects) {
    expect(run(resAbbTextbook.nfa, resAbbTextbook.alphabet, s).accepted).toBe(false);
  }
});

test('[T06-5] Merge mode: "(a|b)*a" produces 9 states and 11 transitions, step 6 reports mergedPair {8, 7}, state ids keep gaps', () => {
  const res = analyze('(a|b)*a', { concatenation: 'merge' });
  assertSuccess(res);

  // Expected counts from worked-example fixture: 9 states, 11 transitions
  expect(res.stats.states).toBe(workedExample.mergeMode.states);
  expect(res.stats.transitions).toBe(workedExample.mergeMode.transitions);

  // State 8 deleted; states keep gaps in creation order without renumbering
  expect(res.nfa.states).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 9]);
  expect(res.nfa.start).toBe(6);
  expect(res.nfa.accept).toBe(9);

  // Step 6 (CONCAT) reports the merged pair matching worked-example fixture
  const step6 = res.steps[5];
  expect(step6.token).toBe('CONCAT');
  expect(step6.rule).toBe('concatenation');
  expect(step6.mergedPair).toEqual(workedExample.mergeMode.mergedAtStep6);
  expect(step6.newStates).toEqual([]);
  expect(step6.newTransitions).toEqual([]);

  // Transition from state 8 (8 -a-> 9) was moved to leave state 7 (7 -a-> 9)
  expect(res.nfa.transitions).toContainEqual({ from: 7, to: 9, label: 'a' });
  expect(res.nfa.transitions.some((t) => t.from === 8 || t.to === 8)).toBe(false);

  // Simulation preserves language
  expect(run(res.nfa, res.alphabet, 'a').accepted).toBe(true);
  expect(run(res.nfa, res.alphabet, 'ba').accepted).toBe(true);
  expect(run(res.nfa, res.alphabet, 'ab').accepted).toBe(false);
  expect(run(res.nfa, res.alphabet, '').accepted).toBe(false);
});

test('[T06-6] Merge mode on "(a|b)*abb" produces 11 states, 13 transitions, and accepts/rejects matching fixture', () => {
  const res = analyze(classicAbbFixture.source, { concatenation: 'merge' });
  assertSuccess(res);

  // Classic abb merge fixture: 11 states, 13 transitions
  expect(res.stats.states).toBe(classicAbbFixture.merge.states);
  expect(res.stats.transitions).toBe(classicAbbFixture.merge.transitions);

  // Invariants hold
  expect(res.invariants).toEqual({
    I1: true,
    I2: true,
    I3: true,
    I4: true,
    noDanglingEdges: true
  });

  // Verify concatenation steps have mergedPair recorded
  const concatSteps = res.steps.filter((s) => s.token === 'CONCAT');
  expect(concatSteps.length).toBe(3);
  for (const s of concatSteps) {
    expect(s.mergedPair).toBeDefined();
    expect(typeof s.mergedPair?.removed).toBe('number');
    expect(typeof s.mergedPair?.into).toBe('number');
  }

  // Language acceptance tests
  for (const str of classicAbbFixture.accepts) {
    expect(run(res.nfa, res.alphabet, str).accepted).toBe(true);
  }
  for (const str of classicAbbFixture.rejects) {
    expect(run(res.nfa, res.alphabet, str).accepted).toBe(false);
  }
});

test('[T06-7] Step-log replay in merge mode reproduces final NFA states and transitions exactly, invariants I1-I4 hold', () => {
  for (const expr of ['(a|b)*a', '(a|b)*abb', 'ab', 'a(bc)', '(ab)c']) {
    const res = analyze(expr, { concatenation: 'merge' });
    assertSuccess(res);

    // Invariants check
    expect(res.invariants).toEqual({
      I1: true,
      I2: true,
      I3: true,
      I4: true,
      noDanglingEdges: true
    });

    // Replay algorithm:
    // 1. Add newStates
    // 2. If mergedPair, remove `removed` from replayed states, and update transitions
    // 3. Add newTransitions
    const replayedStates: number[] = [];
    const replayedTransitions: { from: number; to: number; label: string }[] = [];

    for (const step of res.steps) {
      replayedStates.push(...step.newStates);

      if (step.mergedPair) {
        const { removed, into } = step.mergedPair;
        const idx = replayedStates.indexOf(removed);
        if (idx !== -1) {
          replayedStates.splice(idx, 1);
        }
        for (const t of replayedTransitions) {
          if (t.from === removed) t.from = into;
          if (t.to === removed) t.to = into;
        }
      }

      for (const t of step.newTransitions) {
        replayedTransitions.push({ ...t });
      }
    }

    expect(replayedStates).toEqual(res.nfa.states);
    expect(replayedTransitions).toEqual(res.nfa.transitions);
    expect(res.steps[res.steps.length - 1].result.start).toBe(res.nfa.start);
    expect(res.steps[res.steps.length - 1].result.accept).toBe(res.nfa.accept);
  }
});

test('[T06-8] Merge mode on "(a*)*b": I1-I4 hold, replay equals live NFA, accepts "b" and "ab", rejects "a"', () => {
  const res = analyze('(a*)*b', { concatenation: 'merge' });
  assertSuccess(res);
  expect(res.invariants).toEqual({
    I1: true,
    I2: true,
    I3: true,
    I4: true,
    noDanglingEdges: true
  });

  const replayedStates: number[] = [];
  const replayedTransitions: { from: number; to: number; label: string }[] = [];
  for (const step of res.steps) {
    for (const s of step.newStates) {
      replayedStates.push(s);
    }
    if (step.mergedPair) {
      const { removed, into } = step.mergedPair;
      const idx = replayedStates.indexOf(removed);
      if (idx !== -1) replayedStates.splice(idx, 1);
      for (const t of replayedTransitions) {
        if (t.from === removed) t.from = into;
        if (t.to === removed) t.to = into;
      }
    }
    for (const t of step.newTransitions) {
      replayedTransitions.push({ ...t });
    }
  }

  expect(replayedStates).toEqual(res.nfa.states);
  expect(replayedTransitions).toEqual(res.nfa.transitions);
  expect(run(res.nfa, res.alphabet, 'b').accepted).toBe(true);
  expect(run(res.nfa, res.alphabet, 'ab').accepted).toBe(true);
  expect(run(res.nfa, res.alphabet, 'a').accepted).toBe(false);
});

test('[T06-9] Sentinel EPS, ε/∅ aliases, whitespace ignored, and exclusion from alphabet', () => {
  // Test EPS sentinel constant
  expect(typeof EPS).toBe('string');
  expect(EPS).toBe('ε');

  // Input with ε, ∅, @, #, and whitespace
  const resEps = analyze('  ε  ');
  assertSuccess(resEps);
  expect(resEps.tokens.map((t) => t.type)).toEqual(['EPSILON']);
  expect(resEps.alphabet).toEqual([]);
  expect(resEps.nfa.transitions).toEqual([{ from: 0, to: 1, label: EPS }]);

  const resAt = analyze('@');
  assertSuccess(resAt);
  expect(resAt.tokens.map((t) => t.type)).toEqual(['EPSILON']);
  expect(resAt.alphabet).toEqual([]);
  expect(resAt.nfa.transitions).toEqual([{ from: 0, to: 1, label: EPS }]);

  const resEmpty = analyze('  ∅  ');
  assertSuccess(resEmpty);
  expect(resEmpty.tokens.map((t) => t.type)).toEqual(['EMPTY']);
  expect(resEmpty.alphabet).toEqual([]);
  expect(resEmpty.nfa.transitions).toEqual([]);

  const resHash = analyze('#');
  assertSuccess(resHash);
  expect(resHash.tokens.map((t) => t.type)).toEqual(['EMPTY']);
  expect(resHash.alphabet).toEqual([]);

  // Complex expression mixing symbols with ε and ∅:
  // e.g. '(a | ε) (b | ∅)'
  const resMixed = analyze('(a | ε) (b | ∅)');
  assertSuccess(resMixed);
  // Alphabet must contain only 'a' and 'b', NEVER 'ε', '@', '∅', '#'
  expect(resMixed.alphabet).toEqual(['a', 'b']);
  expect(resMixed.alphabet).not.toContain('ε');
  expect(resMixed.alphabet).not.toContain('@');
  expect(resMixed.alphabet).not.toContain('∅');
  expect(resMixed.alphabet).not.toContain('#');
});

test('[T06-10] Alphabet inference, custom additions, and used-symbol removal protection', () => {
  // Inferred alphabet
  const resInferred = analyze('(a|b)*a');
  assertSuccess(resInferred);
  expect(resInferred.alphabet).toEqual(['a', 'b']);

  // Extending alphabet with 'c' and 'd'
  const resExtended = analyze('(a|b)*a', { alphabet: ['a', 'b', 'c', 'd'] });
  assertSuccess(resExtended);
  expect(resExtended.alphabet).toEqual(['a', 'b', 'c', 'd']);

  // Refusing to remove a symbol used by the expression: omitting 'a'
  const resMissing = analyze('(a|b)*a', { alphabet: ['b', 'c'] });
  expect(resMissing.ok).toBe(false);
  if (!resMissing.ok) {
    expect(resMissing.code).toBe('INVALID_ALPHABET');
    expect(resMissing.message).toContain("Cannot remove symbol 'a' used in expression");
  }

  // Refusing ε or ∅ sentinels in alphabet
  const resEpsInAlpha = analyze('a', { alphabet: ['a', 'ε'] });
  expect(resEpsInAlpha.ok).toBe(false);
  if (!resEpsInAlpha.ok) {
    expect(resEpsInAlpha.code).toBe('INVALID_ALPHABET');
  }
});

test('[T06-11] Simulation with added alphabet symbol causes dead run, while unlisted symbol reports out_of_alphabet', () => {
  const res = analyze('(a|b)*a', { alphabet: ['a', 'b', 'c'] });
  assertSuccess(res);

  // 'ac': 'a' is valid move, 'c' is in alphabet but unused in NFA -> dead run at position 1
  const runDead = run(res.nfa, res.alphabet, 'ac');
  expect(runDead.accepted).toBe(false);
  expect(runDead.verdict).toBe('REJECT');
  expect(runDead.status).toBe('dead');
  expect(runDead.position).toBe(1);

  // 'ad': 'd' is not in alphabet -> out_of_alphabet at position 1
  const runOutOfAlpha = run(res.nfa, res.alphabet, 'ad');
  expect(runOutOfAlpha.accepted).toBe(false);
  expect(runOutOfAlpha.verdict).toBe('REJECT');
  expect(runOutOfAlpha.status).toBe('out_of_alphabet');
  expect(runOutOfAlpha.position).toBe(1);
  expect(runOutOfAlpha.symbol).toBe('d');
});

test('[T06-12] validateAlphabet rejects entries that are not exactly one code point (empty or multi-character)', () => {
  const resEmpty = validateAlphabet([''], ['a']);
  expect(resEmpty.ok).toBe(false);
  if (!resEmpty.ok) {
    expect(resEmpty.message).toContain('must be exactly one code point');
  }

  const resMulti = validateAlphabet(['ab'], ['a']);
  expect(resMulti.ok).toBe(false);
  if (!resMulti.ok) {
    expect(resMulti.message).toContain('must be exactly one code point');
  }

  const resEmoji = validateAlphabet(['🚀', 'a'], ['a']);
  expect(resEmoji.ok).toBe(true);

  const resAnalyzeEmpty = analyze('a', { alphabet: ['a', ''] });
  expect(resAnalyzeEmpty.ok).toBe(false);
  if (!resAnalyzeEmpty.ok) {
    expect(resAnalyzeEmpty.code).toBe('INVALID_ALPHABET');
    expect(resAnalyzeEmpty.message).toContain('must be exactly one code point');
  }

  const resAnalyzeMulti = analyze('a', { alphabet: ['a', 'bc'] });
  expect(resAnalyzeMulti.ok).toBe(false);
  if (!resAnalyzeMulti.ok) {
    expect(resAnalyzeMulti.code).toBe('INVALID_ALPHABET');
    expect(resAnalyzeMulti.message).toContain('must be exactly one code point');
  }
});

test('[T07-1] Engine seam: step descriptions formatted in words for (a|b)*a', () => {
  const result = analyze('(a|b)*a');
  assertSuccess(result);
  expect(result.steps[0].description).toBe("symbol 'a' (fragment 0→1)");
  expect(result.steps[1].description).toBe("symbol 'b' (fragment 2→3)");
  expect(result.steps[2].description).toBe('union of fragments 0→1 and 2→3');
  expect(result.steps[3].description).toBe('star of fragment 4→5');
  expect(result.steps[4].description).toBe("symbol 'a' (fragment 8→9)");
  expect(result.steps[5].description).toBe('concatenation of fragments 6→7 and 8→9');
});

test('[T07-2] Engine seam: merge mode step description shows both states and what they became', () => {
  const result = analyze('(a|b)*a', { concatenation: 'merge' });
  assertSuccess(result);
  const step6 = result.steps[5];
  expect(step6.rule).toBe(workedExample.steps[5].rule);
  expect(step6.mergedPair).toEqual(workedExample.mergeMode.mergedAtStep6);
  expect(step6.description).toBe('concatenation of fragments 6→7 and 8→9 (merged states 7 and 8 into 7)');
});

test('[T07-3] Engine seam: getStepSnapshot returns replayed fragments on stack, states, and new elements', () => {
  const result = analyze('(a|b)*a');
  assertSuccess(result);
  const snap2 = getStepSnapshot(result.steps, 2);
  expect(snap2.stepIndex).toBe(2);
  expect(snap2.stack.map((f) => ({ start: f.start, accept: f.accept }))).toEqual(workedExample.steps[1].stackAfter);
  expect(snap2.newStates).toEqual(workedExample.steps[1].newStates);
  expect(snap2.newTransitions).toEqual(workedExample.steps[1].newTransitions);

  const expectedStates = [
    ...workedExample.steps[0].newStates,
    ...workedExample.steps[1].newStates
  ];
  const expectedTransitions = [
    ...workedExample.steps[0].newTransitions,
    ...workedExample.steps[1].newTransitions
  ];
  expect(snap2.states).toEqual(expectedStates);
  expect(snap2.transitions).toEqual(expectedTransitions);
});

test('[T07-4] Engine seam: getStepSnapshot in merge mode reflects merged state removal and transition remapping', () => {
  const result = analyze('(a|b)*a', { concatenation: 'merge' });
  assertSuccess(result);
  const snap6 = getStepSnapshot(result.steps, 6);
  expect(snap6.stepIndex).toBe(6);
  expect(snap6.states).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 9]);
  expect(snap6.states).not.toContain(workedExample.mergeMode.mergedAtStep6.removed);
  expect(snap6.stack.map((f) => ({ start: f.start, accept: f.accept }))).toEqual(workedExample.steps[5].stackAfter);
  expect(snap6.mergedPair).toEqual(workedExample.mergeMode.mergedAtStep6);
  expect(snap6.newStates).toEqual(workedExample.steps[5].newStates);
  expect(snap6.newTransitions).toEqual([]);
  expect(snap6.transitions.length).toBe(workedExample.mergeMode.transitions);
  const remapped = snap6.transitions.find((t) => t.to === 9);
  expect(remapped).toEqual({ from: 7, to: 9, label: 'a' });
});

test('EXTRA: (a|b)(c|d) in merge mode merges state 10 into 5 at step 7 with outgoing transitions to 6 and 8', () => {
  const result = analyze('(a|b)(c|d)', { concatenation: 'merge' });
  assertSuccess(result);
  const snap7 = getStepSnapshot(result.steps, 7);
  expect(snap7.stepIndex).toBe(7);
  expect(snap7.mergedPair).toEqual({ removed: 10, into: 5 });
  expect(snap7.states).not.toContain(10);
  expect(snap7.states).toContain(5);

  const outgoingFrom5 = snap7.transitions.filter((t) => t.from === 5);
  expect(outgoingFrom5).toHaveLength(2);
  const targets = outgoingFrom5.map((t) => ({ to: t.to, label: t.label })).sort((a, b) => a.to - b.to);
  expect(targets).toEqual([
    { to: 6, label: EPS },
    { to: 8, label: EPS }
  ]);
});

test('[T09-1] CAPS config object defines flatStepping (150), textbookStepping (400), and engineTokens (2000)', () => {
  expect(CAPS).toBeDefined();
  expect(CAPS.flatStepping).toBe(150);
  expect(CAPS.textbookStepping).toBe(400);
  expect(CAPS.engineTokens).toBe(2000);
});

test('[T09-2] analyze() returns EXCEEDED_TOKEN_CAP error stating limit of 2,000 when tokens exceed 2,000, and succeeds at 2,000', () => {
  // Test boundary at 2000 vs 2001
  const overCap = 'a'.repeat(2001);
  const failRes = analyze(overCap);
  expect(failRes.ok).toBe(false);
  if (!failRes.ok) {
    expect(failRes.code).toBe('EXCEEDED_TOKEN_CAP');
    expect(failRes.message).toContain('2,000');
    expect(failRes.message.toLowerCase()).toContain('limit');
  }

  // Also verify customizable cap option on AnalyzeOptions
  const smallOver = analyze('a'.repeat(6), { caps: { engineTokens: 5 } });
  expect(smallOver.ok).toBe(false);
  if (!smallOver.ok) {
    expect(smallOver.code).toBe('EXCEEDED_TOKEN_CAP');
    expect(smallOver.message).toContain('5');
  }
});

test('[T09-3] Fragment and Step track sub-expression labels and step operands across construction steps', () => {
  const res = analyze('(a|b)*a');
  assertSuccess(res);

  // Step 1: symbol 'a'
  expect(res.steps[0].result.expression).toBe('a');
  expect(res.steps[0].operands).toEqual([]);

  // Step 2: symbol 'b'
  expect(res.steps[1].result.expression).toBe('b');
  expect(res.steps[1].operands).toEqual([]);

  // Step 3: union 'a|b'
  expect(res.steps[2].operands).toHaveLength(2);
  expect(res.steps[2].operands?.[0].expression).toBe('a');
  expect(res.steps[2].operands?.[1].expression).toBe('b');
  expect(res.steps[2].result.expression).toBe('(a|b)');

  // Step 4: star of '(a|b)'
  expect(res.steps[3].operands).toHaveLength(1);
  expect(res.steps[3].operands?.[0].expression).toBe('(a|b)');
  expect(res.steps[3].result.expression).toBe('(a|b)*');

  // Step 5: symbol 'a'
  expect(res.steps[4].result.expression).toBe('a');
  expect(res.steps[4].operands).toEqual([]);

  // Step 6: concat
  expect(res.steps[5].operands).toHaveLength(2);
  expect(res.steps[5].operands?.[0].expression).toBe('(a|b)*');
  expect(res.steps[5].operands?.[1].expression).toBe('a');
  expect(res.steps[5].result.expression).toBe('(a|b)*a');

  // Snapshot verifies operands and stack fragment expressions
  const snap4 = getStepSnapshot(res.steps, 4);
  expect(snap4.operands).toBeDefined();
  expect(snap4.operands).toHaveLength(1);
  expect(snap4.operands?.[0].expression).toBe('(a|b)');
  expect(snap4.stack[0].expression).toBe('(a|b)*');
});


















