import { test, expect } from 'vitest';
import { analyze } from '../src/engine/index';

test('analyzing "a" returns an NFA with two states, one "a" transition, a start and an accept', () => {
  const result = analyze('a');
  expect(result.nfa.states).toEqual([0, 1]);
  expect(result.nfa.start).toBe(0);
  expect(result.nfa.accept).toBe(1);
  expect(result.nfa.transitions).toEqual([{ from: 0, to: 1, label: 'a' }]);
  expect(result.stats).toEqual({ states: 2, transitions: 1 });
  expect(result.alphabet).toEqual(['a']);
});
