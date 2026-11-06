import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { analyze } from '../src/engine/index';

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
