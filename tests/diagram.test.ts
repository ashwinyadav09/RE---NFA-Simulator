import { test, expect } from 'vitest';
import { toDot, FakeRenderer, VizRenderer } from '../src/diagram/index';

test('toDot produces DOT text with id on every node and edge, start arrow, and double-circle accept', () => {
  const nfa = {
    states: [0, 1],
    start: 0,
    accept: 1,
    transitions: [{ from: 0, to: 1, label: 'a' }]
  };

  const dot = toDot(nfa);

  expect(dot).toContain('digraph');
  expect(dot).toContain('rankdir=LR');
  expect(dot).toContain('__start -> q0');
  expect(dot).toContain('id="n0"');
  expect(dot).toContain('id="n1"');
  expect(dot).toMatch(/q1\s*\[[^\]]*shape=doublecircle/);
  expect(dot).toContain('id="e0"');
  expect(dot).toContain('q0 -> q1');
  expect(dot).toContain('label="a"');
});

test('FakeRenderer returns ok for valid DOT and error for invalid DOT without throwing', async () => {
  const fake = new FakeRenderer();
  const valid = await fake.render('digraph { a -> b; }');
  expect(valid.ok).toBe(true);
  if (valid.ok) {
    expect(valid.svg).toContain('<svg');
  }

  const invalid = await fake.render('digraph { a -> }');
  expect(invalid.ok).toBe(false);
  if (!invalid.ok) {
    expect(typeof invalid.error).toBe('string');
  }
});

test('VizRenderer returns ok with SVG for valid DOT and error for invalid DOT without throwing', async () => {
  const renderer = new VizRenderer();
  const valid = await renderer.render('digraph { a -> b; }');
  expect(valid.ok).toBe(true);
  if (valid.ok) {
    expect(valid.svg).toContain('<svg');
  }

  const invalid = await renderer.render('digraph { a -> }');
  expect(invalid.ok).toBe(false);
  if (!invalid.ok) {
    expect(typeof invalid.error).toBe('string');
  }
});


