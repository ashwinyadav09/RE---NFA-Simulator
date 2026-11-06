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

const invalidDotSamples = [
  'digraph { a -> }',
  'digraph { a -> ; }',
  'digraph { -> b; }',
  'digraph { a -> b',
  'not a dot graph'
];

test('FakeRenderer returns ok for valid DOT and error for invalid DOT without throwing', async () => {
  const fake = new FakeRenderer();
  const valid = await fake.render('digraph { a -> b; }');
  expect(valid.ok).toBe(true);
  if (valid.ok) {
    expect(valid.svg).toContain('<svg');
  }

  for (const invalid of invalidDotSamples) {
    const res = await fake.render(invalid);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(typeof res.error).toBe('string');
    }
  }
});

test('VizRenderer returns ok with SVG for valid DOT and error for invalid DOT without throwing', async () => {
  const renderer = new VizRenderer();
  const valid = await renderer.render('digraph { a -> b; }');
  expect(valid.ok).toBe(true);
  if (valid.ok) {
    expect(valid.svg).toContain('<svg');
  }

  for (const invalid of invalidDotSamples) {
    const res = await renderer.render(invalid);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(typeof res.error).toBe('string');
    }
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

test('toDot generates valid DOT with dashed epsilon edges and ids for 10-state worked-example NFA', async () => {
  const workedExampleNfa = {
    states: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    start: 6,
    accept: 9,
    transitions: [
      { from: 0, to: 1, label: 'a' },
      { from: 2, to: 3, label: 'b' },
      { from: 4, to: 0, label: 'ε' },
      { from: 4, to: 2, label: 'ε' },
      { from: 1, to: 5, label: 'ε' },
      { from: 3, to: 5, label: 'ε' },
      { from: 6, to: 4, label: 'ε' },
      { from: 5, to: 7, label: 'ε' },
      { from: 6, to: 7, label: 'ε' },
      { from: 5, to: 4, label: 'ε' },
      { from: 8, to: 9, label: 'a' },
      { from: 7, to: 8, label: 'ε' }
    ]
  };

  const dot = toDot(workedExampleNfa);

  // Nodes check
  for (let i = 0; i <= 9; i++) {
    expect(dot).toContain(`id="n${i}"`);
  }

  // Accept shape on q9
  expect(dot).toMatch(/q9\s*\[[^\]]*shape=doublecircle/);

  // Start arrow to q6
  expect(dot).toContain('__start -> q6 [id="start-edge"]');

  // Dashed style on epsilon transitions
  expect(dot).toContain('label="ε", style=dashed');

  // Renders successfully via VizRenderer
  const renderer = new VizRenderer();
  const res = await renderer.render(dot);
  expect(res.ok).toBe(true);
  if (res.ok) {
    expect(res.svg).toContain('<svg');
  }
});

test('toDot correctly renders merge-mode NFA with gaps, node and edge ids, and VizRenderer succeeds', async () => {
  // Merge-mode NFA for (a|b)*a: state 8 is removed, 11 transitions
  const mergeNfa = {
    states: [0, 1, 2, 3, 4, 5, 6, 7, 9],
    start: 6,
    accept: 9,
    transitions: [
      { from: 0, to: 1, label: 'a' },
      { from: 2, to: 3, label: 'b' },
      { from: 4, to: 0, label: 'ε' },
      { from: 4, to: 2, label: 'ε' },
      { from: 1, to: 5, label: 'ε' },
      { from: 3, to: 5, label: 'ε' },
      { from: 6, to: 4, label: 'ε' },
      { from: 5, to: 7, label: 'ε' },
      { from: 6, to: 7, label: 'ε' },
      { from: 5, to: 4, label: 'ε' },
      { from: 7, to: 9, label: 'a' }
    ]
  };

  const dot = toDot(mergeNfa);

  // States check: q0..q7 and q9 are present, q8 is absent
  for (const s of [0, 1, 2, 3, 4, 5, 6, 7, 9]) {
    expect(dot).toContain(`id="n${s}"`);
    expect(dot).toContain(`q${s} [`);
  }
  expect(dot).not.toContain('id="n8"');
  expect(dot).not.toMatch(/\bq8\b/);

  // Edges: e0 through e10 all present
  for (let i = 0; i <= 10; i++) {
    expect(dot).toContain(`id="e${i}"`);
  }

  // Double circle on accept state q9
  expect(dot).toMatch(/q9\s*\[[^\]]*shape=doublecircle/);

  // Start arrow to q6
  expect(dot).toContain('__start -> q6 [id="start-edge"]');

  // Verify rendering with VizRenderer
  const renderer = new VizRenderer();
  const renderResult = await renderer.render(dot);
  expect(renderResult.ok).toBe(true);
  if (renderResult.ok) {
    expect(renderResult.svg).toContain('<svg');
  }
});





