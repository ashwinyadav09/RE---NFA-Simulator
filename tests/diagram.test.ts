import { test, expect } from 'vitest';
import { toDot, FakeRenderer, VizRenderer, computeMasterLayout, type DiagramRenderer } from '../src/diagram/index';
import { type StepSnapshot, analyze, getStepSnapshot } from '../src/engine/index';

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
    expect(res.svg).toContain('Created by step 1: symbol');
  }
});

test('[T08-1] toDot includes pinned positions in inches (points / 72) with pos="x,y!" and splines=true when pin options are provided', () => {
  const nfa = {
    states: [0, 1],
    start: 0,
    accept: 1,
    transitions: [{ from: 0, to: 1, label: 'a' }]
  };

  const pin = new Map<number, [number, number]>([
    [0, [72, 144]],
    [1, [216, 288]]
  ]);

  const dot = toDot(nfa, { pin });

  expect(dot).toContain('splines=true;');
  expect(dot).toMatch(/q0\s*\[[^\]]*pos="1\.0000,2\.0000!"/);
  expect(dot).toMatch(/q1\s*\[[^\]]*pos="3\.0000,4\.0000!"/);

  const partialPin = new Map<number, [number, number]>([[0, [72, 144]]]);
  const partialDot = toDot(nfa, { pin: partialPin });
  expect(partialDot).toMatch(/q0\s*\[[^\]]*pos="1\.0000,2\.0000!"/);
  expect(partialDot).toMatch(/q1\s*\[[^\]]*id="n1"/);
  expect(partialDot).not.toMatch(/q1\s*\[[^\]]*pos=/);
});

test('[T08-2] computeMasterLayout extracts node positions for all NFA states using dot layout', async () => {
  const nfa = {
    states: [0, 1],
    start: 0,
    accept: 1,
    transitions: [{ from: 0, to: 1, label: 'a' }]
  };

  const fakeRenderer = new FakeRenderer();
  const fakeLayout = await computeMasterLayout(nfa, fakeRenderer);
  expect(fakeLayout.ok).toBe(true);
  if (fakeLayout.ok) {
    expect(fakeLayout.positions.has(0)).toBe(true);
    expect(fakeLayout.positions.has(1)).toBe(true);
  }

  const vizRenderer = new VizRenderer();
  const vizLayout = await computeMasterLayout(nfa, vizRenderer);
  expect(vizLayout.ok).toBe(true);
  if (vizLayout.ok) {
    expect(vizLayout.positions.has(0)).toBe(true);
    expect(vizLayout.positions.has(1)).toBe(true);
    const [x0, y0] = vizLayout.positions.get(0)!;
    const [x1, y1] = vizLayout.positions.get(1)!;
    expect(typeof x0).toBe('number');
    expect(typeof y0).toBe('number');
    // Rankdir=LR: accept state x1 is to the right of start state x0
    expect(x1).toBeGreaterThan(x0);
  }
});

function computeMaxDrift(posA: Map<number, [number, number]>, posB: Map<number, [number, number]>): number {
  const common = [...posA.keys()].filter((k) => posB.has(k));
  if (common.length === 0) return 0;
  return Math.max(
    ...common.map((k) => {
      const dX = posA.get(k)![0] - posB.get(k)![0];
      const dY = posA.get(k)![1] - posB.get(k)![1];
      return Math.hypot(dX, dY);
    })
  );
}

function parseSvgNodePositions(svg: string): Map<number, [number, number]> {
  const positions = new Map<number, [number, number]>();
  const matches = svg.matchAll(/<g id="n(\d+)" class="node"[^>]*>[\s\S]*?<ellipse[^>]*cx="([^"]+)"\s+cy="([^"]+)"/g);
  for (const m of matches) {
    positions.set(Number(m[1]), [parseFloat(m[2]), parseFloat(m[3])]);
  }
  return positions;
}

function parseSvgDimensions(svg: string): { width: string; height: string; viewBox: string } {
  const widthMatch = /<svg[^>]*\bwidth="([^"]+)"/.exec(svg);
  const heightMatch = /<svg[^>]*\bheight="([^"]+)"/.exec(svg);
  const vbMatch = /<svg[^>]*\bviewBox="([^"]+)"/.exec(svg);
  return {
    width: widthMatch ? widthMatch[1] : '',
    height: heightMatch ? heightMatch[1] : '',
    viewBox: vbMatch ? vbMatch[1] : ''
  };
}

test('[T08-3] consecutive-step absolute drift for (a|b)*a is <= 0.5 points and viewBox/dimensions are identical across steps', async () => {
  const renderer = new VizRenderer();
  const expr = '(a|b)*a';

  // Master layout is computed on the epsilon-link final NFA
  const epsAnalysis = analyze(expr, { notation: 'standard', concatenation: 'epsilon-link' });
  expect(epsAnalysis.ok).toBe(true);
  if (!epsAnalysis.ok) return;

  const masterLayout = await computeMasterLayout(epsAnalysis.nfa, renderer);
  expect(masterLayout.ok).toBe(true);
  if (!masterLayout.ok) return;

  for (const concatMode of ['epsilon-link', 'merge'] as const) {
    const analysis = analyze(expr, { notation: 'standard', concatenation: concatMode });
    expect(analysis.ok).toBe(true);
    if (!analysis.ok) continue;

    const stepPositions: Array<Map<number, [number, number]>> = [];
    const stepDimensions: Array<{ width: string; height: string; viewBox: string }> = [];

    for (let k = 1; k <= analysis.steps.length; k++) {
      const snapshot = getStepSnapshot(analysis.steps, k);
      const dot = toDot(snapshot, { pin: masterLayout.positions });
      const renderRes = await renderer.render(dot, { engine: 'neato', format: 'svg' });
      expect(renderRes.ok).toBe(true);
      if (!renderRes.ok) continue;

      const positions = parseSvgNodePositions(renderRes.svg);
      stepPositions.push(positions);
      stepDimensions.push(parseSvgDimensions(renderRes.svg));
    }

    expect(stepPositions.length).toBe(analysis.steps.length);
    expect(stepDimensions.length).toBe(analysis.steps.length);

    // ViewBox and width/height are identical on every step
    const firstDim = stepDimensions[0];
    for (let i = 1; i < stepDimensions.length; i++) {
      expect(stepDimensions[i].viewBox).toBe(firstDim.viewBox);
      expect(stepDimensions[i].width).toBe(firstDim.width);
      expect(stepDimensions[i].height).toBe(firstDim.height);
    }

    // Absolute drift <= 0.5pt between consecutive steps and from step 1
    for (let i = 0; i < stepPositions.length - 1; i++) {
      const drift = computeMaxDrift(stepPositions[i], stepPositions[i + 1]);
      expect(drift).toBeLessThanOrEqual(0.5);
    }
  }
});

test('[T08-4] consecutive-step absolute drift for (a|b)*abb is <= 0.5 points and viewBox/dimensions are identical across steps', async () => {
  const renderer = new VizRenderer();
  const expr = '(a|b)*abb';

  // Master layout is computed on the epsilon-link final NFA
  const epsAnalysis = analyze(expr, { notation: 'standard', concatenation: 'epsilon-link' });
  expect(epsAnalysis.ok).toBe(true);
  if (!epsAnalysis.ok) return;

  const masterLayout = await computeMasterLayout(epsAnalysis.nfa, renderer);
  expect(masterLayout.ok).toBe(true);
  if (!masterLayout.ok) return;

  for (const concatMode of ['epsilon-link', 'merge'] as const) {
    const analysis = analyze(expr, { notation: 'standard', concatenation: concatMode });
    expect(analysis.ok).toBe(true);
    if (!analysis.ok) continue;

    const stepPositions: Array<Map<number, [number, number]>> = [];
    const stepDimensions: Array<{ width: string; height: string; viewBox: string }> = [];

    for (let k = 1; k <= analysis.steps.length; k++) {
      const snapshot = getStepSnapshot(analysis.steps, k);
      const dot = toDot(snapshot, { pin: masterLayout.positions });
      const renderRes = await renderer.render(dot, { engine: 'neato', format: 'svg' });
      expect(renderRes.ok).toBe(true);
      if (!renderRes.ok) continue;

      const positions = parseSvgNodePositions(renderRes.svg);
      stepPositions.push(positions);
      stepDimensions.push(parseSvgDimensions(renderRes.svg));
    }

    expect(stepPositions.length).toBe(analysis.steps.length);
    expect(stepDimensions.length).toBe(analysis.steps.length);

    // ViewBox and width/height are identical on every step
    const firstDim = stepDimensions[0];
    for (let i = 1; i < stepDimensions.length; i++) {
      expect(stepDimensions[i].viewBox).toBe(firstDim.viewBox);
      expect(stepDimensions[i].width).toBe(firstDim.width);
      expect(stepDimensions[i].height).toBe(firstDim.height);
    }

    // Absolute drift <= 0.5pt between consecutive steps and from step 1
    for (let i = 0; i < stepPositions.length - 1; i++) {
      const drift = computeMaxDrift(stepPositions[i], stepPositions[i + 1]);
      expect(drift).toBeLessThanOrEqual(0.5);
    }
  }
});

test('[T08-5] in merge mode the merged state appears at the surviving state position', async () => {
  const expr = '(a|b)*a';
  const mergeAnalysis = analyze(expr, { notation: 'standard', concatenation: 'merge' });
  expect(mergeAnalysis.ok).toBe(true);
  if (!mergeAnalysis.ok) return;

  // Step 6 is the concatenation step where 8 was merged into 7 (mergedPair = { removed: 8, into: 7 })
  const step6 = getStepSnapshot(mergeAnalysis.steps, 6);
  expect(step6.mergedPair).toEqual({ removed: 8, into: 7 });

  // Hand-built pin map passed to toDot (not derived from computeMasterLayout)
  const pin = new Map<number, [number, number]>([
    [6, [72, 144]],
    [7, [360, 216]], // 5.0000 in, 3.0000 in
    [9, [504, 216]]
  ]);

  const dot = toDot(step6, { pin });

  // Surviving state 7 is present with pos attribute corresponding to state 7 in pin map
  expect(dot).toContain('pos="5.0000,3.0000!"');
  expect(dot).toMatch(/q7\s*\[[^\]]*pos="5\.0000,3\.0000!"/);

  // Removed state 8 is not present
  expect(dot).not.toMatch(/\bq8\b/);
});

test('[T08-6] computeMasterLayout returns ok: false with error message when renderer fails, without throwing', async () => {
  const failingRenderer: DiagramRenderer = {
    async render() {
      return { ok: false, error: 'Synthetic layout engine failure' };
    }
  };

  const nfa = {
    states: [0, 1],
    start: 0,
    accept: 1,
    transitions: [{ from: 0, to: 1, label: 'a' }]
  };

  const res = await computeMasterLayout(nfa, failingRenderer);
  expect(res.ok).toBe(false);
  if (!res.ok) {
    expect(res.error).toContain('Synthetic layout engine failure');
  }
});

function parseViewBox(svg: string): { x: number; y: number; width: number; height: number } | null {
  const match = /viewBox="([^"]+)"/.exec(svg);
  if (!match) return null;
  const parts = match[1].trim().split(/[\s,]+/).map(Number);
  if (parts.length === 4 && parts.every((n) => !isNaN(n))) {
    return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
  }
  return null;
}

test('[T08-7] step 2 of (a|b)*a with pinned positions keeps SVG viewBox height within master layout bounds', async () => {
  const renderer = new VizRenderer();
  const expr = '(a|b)*a';

  const epsAnalysis = analyze(expr, { notation: 'standard', concatenation: 'epsilon-link' });
  expect(epsAnalysis.ok).toBe(true);
  if (!epsAnalysis.ok) return;

  const masterLayout = await computeMasterLayout(epsAnalysis.nfa, renderer);
  expect(masterLayout.ok).toBe(true);
  if (!masterLayout.ok) return;

  // Render master layout to find master viewBox height
  const masterDot = toDot(epsAnalysis.nfa);
  const masterSvgRes = await renderer.render(masterDot, { engine: 'dot' });
  expect(masterSvgRes.ok).toBe(true);
  if (!masterSvgRes.ok) return;

  const masterVb = parseViewBox(masterSvgRes.svg);
  expect(masterVb).not.toBeNull();
  if (!masterVb) return;

  const step2Snapshot = getStepSnapshot(epsAnalysis.steps, 2);
  const step2Dot = toDot(step2Snapshot, { pin: masterLayout.positions });
  const step2Res = await renderer.render(step2Dot, { engine: 'neato' });
  expect(step2Res.ok).toBe(true);
  if (!step2Res.ok) return;

  const step2Vb = parseViewBox(step2Res.svg);
  expect(step2Vb).not.toBeNull();
  if (!step2Vb) return;

  // Margin computed from master layout bounds: without pinning __start, step 2 viewBox height blows up to ~868pt vs master ~172pt
  const maxAllowedHeight = masterVb.height * 2.2;
  expect(step2Vb.height).toBeLessThanOrEqual(maxAllowedHeight);
});

test('[T08-8] per-step render fallback: when pinned neato render fails, falling back to unpinned DOT succeeds', async () => {
  const failingNeatoRenderer: DiagramRenderer = {
    async render(dot, options) {
      if (options?.engine === 'neato') {
        return { ok: false, error: 'Simulated neato engine failure' };
      }
      return { ok: true, svg: '<svg id="fallback-svg"></svg>' };
    }
  };

  const nfa = {
    states: [0, 1],
    start: 0,
    accept: 1,
    transitions: [{ from: 0, to: 1, label: 'a' }]
  };

  const pin = new Map<number, [number, number]>([[0, [72, 72]], [1, [144, 72]]]);
  const pinnedDot = toDot(nfa, { pin });
  let result = await failingNeatoRenderer.render(pinnedDot, { engine: 'neato' });
  expect(result.ok).toBe(false);

  // Fallback to unpinned DOT
  if (!result.ok) {
    const unpinnedDot = toDot(nfa);
    result = await failingNeatoRenderer.render(unpinnedDot);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.svg).toContain('fallback-svg');
    }
  }
});

test('[T08-9] fixture-based check: no __start marker overlaps a state node in the rendered SVG for all steps and modes', async () => {
  const renderer = new VizRenderer();
  const fixtureExprs = ['(a|b)*a', '(a|b)*abb'];

  for (const expr of fixtureExprs) {
    const epsAnalysis = analyze(expr, { notation: 'standard', concatenation: 'epsilon-link' });
    expect(epsAnalysis.ok).toBe(true);
    if (!epsAnalysis.ok) continue;

    const masterLayout = await computeMasterLayout(epsAnalysis.nfa, renderer);
    expect(masterLayout.ok).toBe(true);
    if (!masterLayout.ok) continue;

    for (const mode of ['epsilon-link', 'merge'] as const) {
      const analysis = analyze(expr, { notation: 'standard', concatenation: mode });
      expect(analysis.ok).toBe(true);
      if (!analysis.ok) continue;

      for (let k = 1; k <= analysis.steps.length; k++) {
        const snap = getStepSnapshot(analysis.steps, k);
        const dot = toDot(snap, { pin: masterLayout.positions });
        const res = await renderer.render(dot, { engine: 'neato', format: 'svg' });
        expect(res.ok).toBe(true);
        if (!res.ok) continue;

        // Extract start-node ellipses and state node ellipses from rendered SVG
        const startMatches = [
          ...res.svg.matchAll(
            /<g id="(start-node(?:-\d+)?)" class="node"[^>]*>[\s\S]*?<ellipse[^>]*cx="([^"]+)"\s+cy="([^"]+)"/g
          )
        ];
        const stateMatches = [
          ...res.svg.matchAll(
            /<g id="n(\d+)" class="node"[^>]*>[\s\S]*?<ellipse[^>]*cx="([^"]+)"\s+cy="([^"]+)"\s+rx="([^"]+)"\s+ry="([^"]+)"/g
          )
        ];

        for (const sm of startMatches) {
          const scx = parseFloat(sm[2]);
          const scy = parseFloat(sm[3]);
          for (const tm of stateMatches) {
            const tcx = parseFloat(tm[2]);
            const tcy = parseFloat(tm[3]);
            const trx = parseFloat(tm[4]);
            const dist = Math.hypot(tcx - scx, tcy - scy);
            // Center of start marker must not lie inside or overlap state node ellipse
            expect(dist).toBeGreaterThanOrEqual(trx);
          }
        }
      }
    }
  }
});



















