import { test, expect } from 'vitest';
import { toDot, FakeRenderer, VizRenderer } from '../src/diagram/index';
import type { StepSnapshot } from '../src/engine/index';

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

test('[T07-5] toDot draws all fragments on the stack with start arrows and double circles for each fragment', async () => {
  const step2Snapshot: StepSnapshot = {
    stepIndex: 2,
    states: [0, 1, 2, 3],
    transitions: [
      { from: 0, to: 1, label: 'a' },
      { from: 2, to: 3, label: 'b' }
    ],
    stack: [
      { start: 0, accept: 1 },
      { start: 2, accept: 3 }
    ],
    newStates: [2, 3],
    newTransitions: [{ from: 2, to: 3, label: 'b' }]
  };

  const dot = toDot(step2Snapshot);

  // Both fragments on stack have start arrows
  expect(dot).toMatch(/__start_0\s*->\s*q0\s*\[id="start-edge-0"\]/);
  expect(dot).toMatch(/__start_1\s*->\s*q2\s*\[id="start-edge-1"\]/);

  // Both fragments on stack have accept states as doublecircle
  expect(dot).toMatch(/q1\s*\[[^\]]*shape=doublecircle/);
  expect(dot).toMatch(/q3\s*\[[^\]]*shape=doublecircle/);

  // Nodes check: all 4 states drawn with ids
  for (let s = 0; s <= 3; s++) {
    expect(dot).toContain(`id="n${s}"`);
  }

  // Transitions check: both transitions drawn with ids
  expect(dot).toContain('id="e0"');
  expect(dot).toContain('id="e1"');

  // Renders cleanly with VizRenderer
  const renderer = new VizRenderer();
  const res = await renderer.render(dot);
  expect(res.ok).toBe(true);
});

test('[T07-6] toDot marks new states and transitions with colour, thicker line, and text tag', () => {
  const step2Snapshot: StepSnapshot = {
    stepIndex: 2,
    states: [0, 1, 2, 3],
    transitions: [
      { from: 0, to: 1, label: 'a' },
      { from: 2, to: 3, label: 'b' }
    ],
    stack: [
      { start: 0, accept: 1 },
      { start: 2, accept: 3 }
    ],
    newStates: [2, 3],
    newTransitions: [{ from: 2, to: 3, label: 'b' }]
  };

  const dot = toDot(step2Snapshot);

  // New states 2 and 3 must have all three cues: colour, thicker line (penwidth=2.5), and text tag "(new)"
  expect(dot).toMatch(/q2\s*\[[^\]]*label="2 \(new\)"[^\]]*color="#d62728"[^\]]*penwidth=2\.5/);
  expect(dot).toMatch(/q3\s*\[[^\]]*label="3 \(new\)"[^\]]*color="#d62728"[^\]]*penwidth=2\.5/);

  // Existing states 0 and 1 must NOT have new styling or text tag
  expect(dot).toMatch(/q0\s*\[[^\]]*label="0"/);
  expect(dot).not.toMatch(/q0\s*\[[^\]]*\(new\)/);
  expect(dot).not.toMatch(/q0\s*\[[^\]]*penwidth/);

  expect(dot).toMatch(/q1\s*\[[^\]]*label="1"/);
  expect(dot).not.toMatch(/q1\s*\[[^\]]*\(new\)/);
  expect(dot).not.toMatch(/q1\s*\[[^\]]*penwidth/);

  // New transition e1 (2 -> 3) must have all three cues
  expect(dot).toMatch(/q2\s*->\s*q3\s*\[[^\]]*label="b \(new\)"[^\]]*color="#d62728"[^\]]*penwidth=2\.5/);

  // Existing transition e0 (0 -> 1) must NOT have new styling
  expect(dot).toMatch(/q0\s*->\s*q1\s*\[[^\]]*label="a"/);
  expect(dot).not.toMatch(/q0\s*->\s*q1\s*\[[^\]]*\(new\)/);
  expect(dot).not.toMatch(/q0\s*->\s*q1\s*\[[^\]]*penwidth/);
});

test('[T07-7] toDot on merge-mode step snapshot marks merged state with prior states and what they became', () => {
  const mergeStepSnapshot: StepSnapshot = {
    stepIndex: 6,
    states: [0, 1, 2, 3, 4, 5, 6, 7, 9],
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
    ],
    stack: [{ start: 6, accept: 9 }],
    newStates: [],
    newTransitions: [],
    mergedPair: { removed: 8, into: 7 }
  };

  const dot = toDot(mergeStepSnapshot);

  // State 7 was merged from 7 and 8; must show both states and what they became, with colour and thicker line
  expect(dot).toMatch(/q7\s*\[[^\]]*label="7 \(merged 7, 8\)"[^\]]*color="#d62728"[^\]]*penwidth=2\.5/);

  // State 8 is absent
  expect(dot).not.toMatch(/\bq8\b/);
});

test('[T07-8] toDot includes tooltip attribute on nodes for state hovering', async () => {
  const stepSnapshot: StepSnapshot = {
    stepIndex: 3,
    states: [0, 1, 2, 3, 4, 5],
    transitions: [],
    stack: [{ start: 4, accept: 5 }],
    newStates: [4, 5],
    newTransitions: [],
    stateCreators: {
      0: { step: 1, rule: 'symbol' },
      1: { step: 1, rule: 'symbol' },
      2: { step: 2, rule: 'symbol' },
      3: { step: 2, rule: 'symbol' },
      4: { step: 3, rule: 'union' },
      5: { step: 3, rule: 'union' }
    }
  };

  const dot = toDot(stepSnapshot);
  expect(dot).toMatch(/q4\s*\[[^\]]*tooltip="Created by step 3: union"/);
  expect(dot).toMatch(/q0\s*\[[^\]]*tooltip="Created by step 1: symbol"/);

  const renderer = new VizRenderer();
  const res = await renderer.render(dot);
  expect(res.ok).toBe(true);
  if (res.ok) {
    expect(res.svg).toContain('Created by step 3: union');
  }
});









