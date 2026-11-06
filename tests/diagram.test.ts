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

test('every node and edge statement in DOT has an id attribute, including start-node and start-edge', () => {
  const nfa = {
    states: [0, 1],
    start: 0,
    accept: 1,
    transitions: [{ from: 0, to: 1, label: 'a' }]
  };
  const dot = toDot(nfa);

  expect(dot).toMatch(/__start\s*\[[^\]]*id="start-node"/);
  expect(dot).toMatch(/__start\s*->\s*q0\s*\[[^\]]*id="start-edge"/);

  const lines = dot.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  for (const line of lines) {
    if (line.includes('->')) {
      expect(line).toMatch(/id="[^"]+"/);
    } else if (/^(__start|q\d+)\s*\[/.test(line)) {
      expect(line).toMatch(/id="[^"]+"/);
    }
  }
});

test('VizRenderer renders NFAs with labels containing quotes and backslashes successfully', async () => {
  const renderer = new VizRenderer();

  const nfaWithQuote = {
    states: [0, 1],
    start: 0,
    accept: 1,
    transitions: [{ from: 0, to: 1, label: '"' }]
  };
  const dotQuote = toDot(nfaWithQuote);
  const resQuote = await renderer.render(dotQuote);
  expect(resQuote.ok).toBe(true);
  if (resQuote.ok) {
    expect(resQuote.svg).toContain('<svg');
  }

  const nfaWithBackslash = {
    states: [0, 1],
    start: 0,
    accept: 1,
    transitions: [{ from: 0, to: 1, label: '\\' }]
  };
  const dotBackslash = toDot(nfaWithBackslash);
  const resBackslash = await renderer.render(dotBackslash);
  expect(resBackslash.ok).toBe(true);
  if (resBackslash.ok) {
    expect(resBackslash.svg).toContain('<svg');
  }
});




