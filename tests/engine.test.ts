import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { analyze, run, runLines } from '../src/engine/index';

const fixturePath = resolve(__dirname, '../.agents/skills/thompson-rules/fixtures/worked-example.json');
const workedExample = JSON.parse(readFileSync(fixturePath, 'utf-8'));
const step1 = workedExample.steps[0];

test('analyzing "a" matches single-symbol fragment in worked-example fixture', () => {
  const result = analyze('a');

  expect(result.nfa.states).toEqual(step1.newStates);
  expect(result.nfa.start).toBe(step1.result.start);
  expect(result.nfa.accept).toBe(step1.result.accept);
  expect(result.nfa.transitions).toEqual(step1.newTransitions);
});

test('analyzing "(a|b)*a" produces tokens and postfix matching worked-example fixture', () => {
  const result = analyze('(a|b)*a');

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
  expect(resWorked.invariants).toEqual(workedExample.invariants);
  expect(resWorked.stats.states).toBe(10);
  expect(resWorked.stats.transitions).toBe(12);

  // Test classic-abb expression (a|b)*abb
  const resAbb = analyze(classicAbbFixture.source);
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
  expect(resEmptyUnicode.stats).toEqual({ states: 2, transitions: 0 });
  const resEpsUnicode = analyze('ε');
  expect(resEpsUnicode.stats).toEqual({ states: 2, transitions: 1 });

  // Nested groups ((a|b))
  const resNested = analyze('((a|b))');
  expect(resNested.invariants.I1).toBe(true);
  expect(resNested.invariants.I2).toBe(true);
  expect(resNested.invariants.I3).toBe(true);
  expect(resNested.invariants.I4).toBe(true);
  expect(resNested.invariants.noDanglingEdges).toBe(true);
  expect(resNested.stats).toEqual({ states: 6, transitions: 6 });

  // Stacked postfix a**
  const resStacked = analyze('a**');
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
  const testInputs = ['ba', 'ab', 'a', ''];

  for (const input of testInputs) {
    const expected = workedExample.traces[input];
    const result = run(analysis.nfa, analysis.alphabet, input);

    expect(result.initialClosure).toEqual(workedExample.initialClosure);
    expect(result.afterEachSymbol).toEqual(expected.afterEachSymbol);
    expect(result.accepted).toBe(expected.accepted);
    expect(result.verdict).toBe(expected.accepted ? 'ACCEPT' : 'REJECT');
  }
});

test('dead active set is reported with position and simulation terminates early', () => {
  const analysis = analyze('(a|b)*a');
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





