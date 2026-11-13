import { test, expect } from 'vitest';
import { toDot, FakeRenderer, VizRenderer, computeMasterLayout, checkDiagramCap, CAPS, renderStressChartSvg, type StressChartPoint, type DiagramRenderer } from '../src/diagram/index';
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

test('[T09-8] Diagram cap: toDot permits 400 postfix tokens in flat view and throws at 401 tokens stating limit 400; checkDiagramCap returns flat at 400 and off at 401', () => {
  const analysis = analyze('(a|b)*a');
  if (!analysis.ok) throw new Error(analysis.message);
  const snap = getStepSnapshot(analysis.steps, 1);

  // 400 tokens in flat view does not throw
  expect(() => toDot(snap, { view: 'flat', postfixCount: 400 })).not.toThrow();

  // 401 tokens in flat view throws stating limit 400
  expect(() => toDot(snap, { view: 'flat', postfixCount: 401 })).toThrow(/400/);

  // checkDiagramCap checks
  expect(checkDiagramCap(400)).toBe('flat');
  expect(checkDiagramCap(401)).toBe('off');
});

test('[T10-3] Diagram seam: toDot with activeStates highlights matching states with active class, fillcolor, border color, and thicker line, while leaving inactive states unhighlighted', () => {
  const nfa = {
    states: [0, 1, 2, 3],
    start: 0,
    accept: 3,
    transitions: [
      { from: 0, to: 1, label: 'a' },
      { from: 1, to: 2, label: 'b' },
      { from: 2, to: 3, label: 'c' }
    ]
  };

  const dot = toDot(nfa, { activeStates: [0, 2] });

  // States 0 and 2 must have active styling: class="active", fillcolor="#b3d4fc", style=filled, color="#1f77b4", penwidth=2.5
  expect(dot).toMatch(/q0\s*\[[^\]]*class="active"[^\]]*fillcolor="#b3d4fc"[^\]]*style=filled[^\]]*color="#1f77b4"[^\]]*penwidth=2\.5/);
  expect(dot).toMatch(/q2\s*\[[^\]]*class="active"[^\]]*fillcolor="#b3d4fc"[^\]]*style=filled[^\]]*color="#1f77b4"[^\]]*penwidth=2\.5/);

  // States 1 and 3 must not be active
  expect(dot).not.toMatch(/q1\s*\[[^\]]*class="active"/);
  expect(dot).not.toMatch(/q3\s*\[[^\]]*class="active"/);
});

test('[T10-4] Diagram seam: toDot with empty activeStates highlights no states (dead run)', () => {
  const nfa = {
    states: [0, 1, 2],
    start: 0,
    accept: 2,
    transitions: [
      { from: 0, to: 1, label: 'a' },
      { from: 1, to: 2, label: 'b' }
    ]
  };

  const dot = toDot(nfa, { activeStates: [] });

  expect(dot).not.toContain('class="active"');
  expect(dot).not.toContain('fillcolor=');
  expect(dot).not.toContain('style=filled');
});

test('[T10-5] Diagram seam: toDot with compactLabels maps display labels to 0..n-1 while preserving engine ids on node and edge attributes', () => {
  const nfa = {
    states: [0, 2, 5],
    start: 0,
    accept: 5,
    transitions: [
      { from: 0, to: 2, label: 'a' },
      { from: 2, to: 5, label: 'b' }
    ]
  };

  const dot = toDot(nfa, { compactLabels: true });

  // Node statements must preserve engine IDs in DOT node names and id attributes
  expect(dot).toContain('id="n0"');
  expect(dot).toContain('id="n2"');
  expect(dot).toContain('id="n5"');

  // Display labels must be mapped to 0..n-1 in ascending id order
  expect(dot).toMatch(/q0\s*\[[^\]]*label="0"/);
  expect(dot).toMatch(/q2\s*\[[^\]]*label="1"/);
  expect(dot).toMatch(/q5\s*\[[^\]]*label="2"/);

  // Transitions must keep original engine IDs in edge definitions and id attributes
  expect(dot).toContain('id="e0"');
  expect(dot).toContain('id="e1"');
  expect(dot).toContain('q0 -> q2');
  expect(dot).toContain('q2 -> q5');
  expect(dot).toContain('__start -> q0');
});

test('[T10-6] Diagram seam: toDot combines compactLabels, activeStates, and pinned layout positions into valid SVG via VizRenderer', async () => {
  const analysis = analyze('(a|b)*a', { concatenation: 'merge' });
  if (!analysis.ok) throw new Error(analysis.message);

  const renderer = new VizRenderer();
  const masterRes = await computeMasterLayout(analysis.nfa, renderer);
  expect(masterRes.ok).toBe(true);
  if (!masterRes.ok) return;

  // Active states from trace (e.g. states 0, 2, 7)
  const active = [0, 2, 7];
  const dot = toDot(analysis.nfa, {
    pin: masterRes.positions,
    compactLabels: true,
    activeStates: active
  });

  // Verify splines=true and pos attributes appear
  expect(dot).toContain('splines=true;');
  expect(dot).toContain('pos=');

  // Verify compact labels on accept state (state 9 is mapped to 8 in merge mode)
  expect(dot).toMatch(/q9\s*\[[^\]]*label="8"/);

  // Verify active states have active styling and inactive states don't
  expect(dot).toMatch(/q0\s*\[[^\]]*class="active"/);
  expect(dot).toMatch(/q2\s*\[[^\]]*class="active"/);
  expect(dot).toMatch(/q7\s*\[[^\]]*class="active"/);
  expect(dot).not.toMatch(/q1\s*\[[^\]]*class="active"/);
  expect(dot).not.toMatch(/q9\s*\[[^\]]*class="active"/);

  // Render with neato using real VizRenderer
  const res = await renderer.render(dot, { engine: 'neato' });
  expect(res.ok).toBe(true);
  if (res.ok) {
    expect(res.svg).toContain('<svg');
    // SVG has node group with class="node active" for q0
    expect(res.svg).toMatch(/<g id="n0" class="node active"/);
    expect(res.svg).toMatch(/<g id="n2" class="node active"/);
    expect(res.svg).toMatch(/<g id="n7" class="node active"/);
    // Inactive node does not have active class
    expect(res.svg).toMatch(/<g id="n9" class="node"/);
    expect(res.svg).not.toMatch(/<g id="n9" class="node active"/);
  }
});

test('[T10-7] Diagram seam: toDot on StepSnapshot ignores compactLabels and labelMap so step views use engine ids without label collision with merged step log', () => {
  const analysis = analyze('(a|b)*a', { concatenation: 'merge' });
  if (!analysis.ok) throw new Error(analysis.message);

  // Step 6 is the last step: concatenation of 6->7 and 8->9 (merged 7 and 8 into 7)
  const step6Snap = getStepSnapshot(analysis.steps, 6);

  // Call toDot with compactLabels: true and final NFA compactLabelMap
  const dot = toDot(step6Snap, { compactLabels: true, labelMap: analysis.compactLabelMap });

  // Node 7 must show "7 (merged 7, 8)" matching the step log
  expect(dot).toMatch(/q7\s*\[[^\]]*label="7 \(merged 7, 8\)"/);

  // Node 9 must retain its engine id "9", NOT mapped to "8" (which would collide with merged state 8)
  expect(dot).toMatch(/q9\s*\[[^\]]*label="9"/);
  expect(dot).not.toMatch(/q9\s*\[[^\]]*label="8"/);
});

test('[T14-05] Diagram seam: renderStressChartSvg produces valid inline SVG chart for stress data', () => {
  // 1. Empty data renders placeholder
  const emptySvg = renderStressChartSvg([]);
  expect(emptySvg).toContain('<svg');
  expect(emptySvg).toContain('</svg>');
  expect(emptySvg).toContain('Run stress test to see comparison chart');

  // 2. Data with RegExp explosion and timeout, plus NFA linear scaling
  const samplePoints: StressChartPoint[] = [
    { n: 12, regExpTime: 0.3, nfaTime: 0.1 },
    { n: 14, regExpTime: 1.1, nfaTime: 0.12 },
    { n: 16, regExpTime: 4.6, nfaTime: 0.15 },
    { n: 18, regExpTime: 18.2, nfaTime: 0.18 },
    { n: 20, regExpTime: 72.1, nfaTime: 0.2 },
    { n: 22, regExpTime: 294.6, nfaTime: 0.22 },
    { n: 24, regExpTime: 1300.7, nfaTime: 0.25 },
    { n: 26, regExpTime: 4937.9, nfaTime: 0.28 },
    { n: 28, regExpTime: 8000, regExpTimeout: true, nfaTime: 0.31 },
    { n: 30, regExpTime: null, nfaTime: 0.34 },
    { n: 50, regExpTime: null, nfaTime: 0.6 },
    { n: 100, regExpTime: null, nfaTime: 1.2 },
    { n: 1000, regExpTime: null, nfaTime: 5.3 }
  ];

  const svg = renderStressChartSvg(samplePoints, { title: 'Backtracking vs Thompson NFA' });

  // Valid SVG structure
  expect(svg).toContain('<svg');
  expect(svg).toContain('viewBox=');
  expect(svg).toContain('</svg>');

  // Title and legend
  expect(svg).toContain('Backtracking vs Thompson NFA');
  expect(svg).toContain('RegExp');
  expect(svg).toContain('Thompson NFA');

  // Axes ticks
  expect(svg).toContain('12');
  expect(svg).toContain('1000');
  expect(svg).toContain('8000');

  // Timeout indicator
  expect(svg).toContain('timeout');

  // Data elements: polylines and circles
  expect(svg).toContain('<polyline');
  expect(svg).toContain('<circle');
});

test('[T14-06] Diagram seam: adding a point never moves existing points in renderStressChartSvg', () => {
  const p1: StressChartPoint = { n: 16, regExpTime: 4.6, nfaTime: 0.15 };
  const p2: StressChartPoint = { n: 20, regExpTime: 72.1, nfaTime: 0.2 };

  const svg1 = renderStressChartSvg([p1]);
  const svg2 = renderStressChartSvg([p1, p2]);

  // Extract circle elements for n=16
  const match1 = svg1.match(/<circle[^>]*title[^>]*n=16[^>]*>[^<]*<\/circle>|<circle[^>]*>\s*<title>n=16[^<]*<\/title>\s*<\/circle>/);
  expect(match1).not.toBeNull();

  // Find cx and cy attributes for n=16 in both renders
  const getCircleCoords = (svg: string, label: string) => {
    // Regex matching circle with a title child containing label
    const circleRegex = new RegExp(`<circle[^>]*cx="([0-9.]+)"[^>]*cy="([0-9.]+)"[^>]*>\\s*<title>${label}[^<]*<\\/title>\\s*<\\/circle>`);
    const m = svg.match(circleRegex);
    if (!m) return null;
    return { cx: parseFloat(m[1]), cy: parseFloat(m[2]) };
  };

  const c1RegExp = getCircleCoords(svg1, 'n=16: RegExp');
  const c2RegExp = getCircleCoords(svg2, 'n=16: RegExp');
  expect(c1RegExp).not.toBeNull();
  expect(c2RegExp).not.toBeNull();
  expect(c2RegExp!.cx).toBe(c1RegExp!.cx);
  expect(c2RegExp!.cy).toBe(c1RegExp!.cy);

  const c1NFA = getCircleCoords(svg1, 'n=16: NFA');
  const c2NFA = getCircleCoords(svg2, 'n=16: NFA');
  expect(c1NFA).not.toBeNull();
  expect(c2NFA).not.toBeNull();
  expect(c2NFA!.cx).toBe(c1NFA!.cx);
  expect(c2NFA!.cy).toBe(c1NFA!.cy);
});

test('[T14-07] Diagram seam: x is strictly proportional to n on fixed domains [12, 30] and [0, 1000]', () => {
  // Panel A: n in [12, 30]
  const p12: StressChartPoint = { n: 12, regExpTime: 0.3, nfaTime: 0.1 };
  const p21: StressChartPoint = { n: 21, regExpTime: 100.0, nfaTime: 0.2 };
  const p30: StressChartPoint = { n: 30, regExpTime: 5000.0, nfaTime: 0.3 };

  const svgA = renderStressChartSvg([p12, p21, p30]);

  const getPanelACircleX = (svg: string, label: string): number => {
    const re = new RegExp(`<circle[^>]*cx="([0-9.]+)"[^>]*cy="([0-9.]+)"[^>]*>\\s*<title>${label}[^<]*<\\/title>\\s*<\\/circle>`);
    const m = svg.match(re);
    expect(m).not.toBeNull();
    return parseFloat(m![1]);
  };

  const x12 = getPanelACircleX(svgA, 'n=12: NFA');
  const x21 = getPanelACircleX(svgA, 'n=21: NFA');
  const x30 = getPanelACircleX(svgA, 'n=30: NFA');

  // n=21 is exact midpoint of [12, 30]
  const ratioA = (x21 - x12) / (x30 - x12);
  expect(ratioA).toBeCloseTo(0.5, 3);

  // Panel B: n in [0, 1000]
  const p0: StressChartPoint = { n: 0, nfaTime: 0.0 };
  const p500: StressChartPoint = { n: 500, nfaTime: 2.5 };
  const p1000: StressChartPoint = { n: 1000, nfaTime: 5.0 };

  const svgB = renderStressChartSvg([p0, p500, p1000]);

  const getPanelBCircleX = (svg: string, label: string): number => {
    // In panel B, circles have title 'n=...: NFA scale' or similar
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`<circle[^>]*cx="([0-9.]+)"[^>]*cy="([0-9.]+)"[^>]*>\\s*<title>${escapedLabel}[^<]*<\\/title>\\s*<\\/circle>`);
    const m = svg.match(re);
    expect(m).not.toBeNull();
    return parseFloat(m![1]);
  };

  const x0 = getPanelBCircleX(svgB, 'n=0: NFA (0-1000)');
  const x500 = getPanelBCircleX(svgB, 'n=500: NFA (0-1000)');
  const x1000 = getPanelBCircleX(svgB, 'n=1000: NFA (0-1000)');

  const ratioB = (x500 - x0) / (x1000 - x0);
  expect(ratioB).toBeCloseTo(0.5, 3);
});

test('[T14-08] Diagram seam: 8 s timeout marker stays at the ceiling of Panel A regardless of points', () => {
  const pTimeout: StressChartPoint = { n: 28, regExpTime: 8000, regExpTimeout: true, nfaTime: 0.3 };
  const svgSingle = renderStressChartSvg([pTimeout]);

  // Find timeout marker group or element
  const getTimeoutY = (svg: string) => {
    const m = svg.match(/<g[^>]*id="panelA-timeout"[^>]*transform="translate\(([0-9.]+),\s*([0-9.]+)\)"/);
    if (!m) {
      // fallback matching translate with timeout inside
      const m2 = svg.match(/transform="translate\(([0-9.]+),\s*([0-9.]+)\)"[^>]*>[\s\S]*?timeout/);
      return m2 ? parseFloat(m2[2]) : null;
    }
    return parseFloat(m[2]);
  };

  const ySingle = getTimeoutY(svgSingle);
  expect(ySingle).not.toBeNull();

  // Ceiling check: y coordinate corresponds to top ceiling
  const pExtra: StressChartPoint = { n: 1000, nfaTime: 5.0 };
  const svgMulti = renderStressChartSvg([pTimeout, pExtra]);
  const yMulti = getTimeoutY(svgMulti);
  expect(yMulti).toBe(ySingle);
});

test('[T14-09] Diagram seam: Panel B clips slow NFA (>10ms) to ceiling with distinct clipped marker and true time in title', () => {
  const p7: StressChartPoint = { n: 100, nfaTime: 7.0 };
  const p18: StressChartPoint = { n: 500, nfaTime: 18.0 };

  const svg7 = renderStressChartSvg([p7]);
  // 7 ms is within [0, 10] domain, not marked as clipped
  expect(svg7).not.toContain('class="clipped-marker"');
  expect(svg7).toContain('7.00ms');

  const svgBoth = renderStressChartSvg([p7, p18]);
  // 18 ms is clipped and marked with distinct clipped marker
  expect(svgBoth).toContain('class="clipped-marker"');
  expect(svgBoth).toContain('18.00ms');
  // It is drawn at the ceiling (panelB.top = 50.0)
  expect(svgBoth).toMatch(/<g[^>]*class="clipped-marker"[^>]*transform="translate\(([0-9.]+),\s*50\.0\)"/);

  // Adding the clipped point moves no other point
  // Coordinates of p7 must remain identical
  const getCircleCoords = (svg: string, label: string) => {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`<circle\\s+cx="([0-9.]+)"\\s+cy="([0-9.]+)"[^>]*>\\s*<title>${escaped}<\\/title>`, 'i');
    const m = svg.match(regex);
    if (!m) return null;
    return { cx: parseFloat(m[1]), cy: parseFloat(m[2]) };
  };
  const c7Before = getCircleCoords(svg7, 'n=100: NFA (0-1000) 7.00ms');
  const c7After = getCircleCoords(svgBoth, 'n=100: NFA (0-1000) 7.00ms');
  expect(c7Before).not.toBeNull();
  expect(c7After).toEqual(c7Before);
});

test('[T14-10] Diagram seam: renderStressChartSvg escapes title in <text> and aria-label', () => {
  const titleWithSpecialChars = 'Test <family> & "bench"';
  const svgEmpty = renderStressChartSvg([], { title: titleWithSpecialChars });
  expect(svgEmpty).toContain('aria-label="Test &lt;family&gt; &amp; &quot;bench&quot;"');
  expect(svgEmpty).toContain('<text x="380" y="24" text-anchor="middle" font-family="sans-serif" font-size="14" font-weight="bold" fill="#202124">Test &lt;family&gt; &amp; &quot;bench&quot;</text>');
  expect(svgEmpty).not.toContain('<family>');

  const svgWithPoints = renderStressChartSvg([{ n: 12, nfaTime: 1.0 }], { title: titleWithSpecialChars });
  expect(svgWithPoints).toContain('aria-label="Test &lt;family&gt; &amp; &quot;bench&quot;"');
  expect(svgWithPoints).toContain('Test &lt;family&gt; &amp; &quot;bench&quot;</text>');
  expect(svgWithPoints).not.toContain('<family>');
});

test('[T18-AC2-1] Diagram seam: renderStressChartSvg log-scale math and rendering', () => {
  const points = [
    { n: 12, regExpTime: 0.005, nfaTime: 0.005 },
    { n: 14, regExpTime: 0.1, nfaTime: 0.1 },
    { n: 16, regExpTime: 1.0, nfaTime: 0.2 },
    { n: 18, regExpTime: 10.0, nfaTime: 0.3 },
    { n: 20, regExpTime: 100.0, nfaTime: 0.4 },
    { n: 22, regExpTime: 1000.0, nfaTime: 0.5 },
    { n: 28, regExpTime: 8000, regExpTimeout: true, nfaTime: 0.6 }
  ];

  const svgLog = renderStressChartSvg(points, { scale: 'log' });
  expect(svgLog).toContain('(log scale)');
  expect(svgLog).toContain('≤0.01 ms');
  expect(svgLog).toContain('0.1 ms');
  expect(svgLog).toContain('1 ms');
  expect(svgLog).toContain('10 ms');
  expect(svgLog).toContain('100 ms');
  expect(svgLog).toContain('1000 ms');
  expect(svgLog).toContain('8000 ms');

  // Timeout marker at ceiling (y = 50.0) for n = 28 (getXA(28) = 322.8)
  expect(svgLog).toContain('id="panelA-timeout" transform="translate(322.8, 50.0)"');

  // Sub-millisecond (0.005 ms) is floored to 0.01 ms -> y = 265.0
  expect(svgLog).toContain('cy="265.0" r="4" fill="#d93025"');

  // Coordinates helper
  const getCircleY = (svg: string, label: string): number => {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`<circle\\s+cx="[0-9.]+"\\s+cy="([0-9.]+)"[^>]*>\\s*<title>${escaped}<\\/title>`, 'i');
    const m = svg.match(regex);
    if (!m) throw new Error(`Circle for "${label}" not found in SVG`);
    return parseFloat(m[1]);
  };

  const y001 = getCircleY(svgLog, 'n=12: RegExp 0.0ms');
  const y01 = getCircleY(svgLog, 'n=14: RegExp 0.1ms');
  const y1 = getCircleY(svgLog, 'n=16: RegExp 1.0ms');
  const y10 = getCircleY(svgLog, 'n=18: RegExp 10.0ms');
  const y100 = getCircleY(svgLog, 'n=20: RegExp 100.0ms');
  const y1000 = getCircleY(svgLog, 'n=22: RegExp 1000.0ms');

  // Strictly monotonic: smaller y means higher on canvas (larger duration)
  expect(y1000).toBeLessThan(y100);
  expect(y100).toBeLessThan(y10);
  expect(y10).toBeLessThan(y1);
  expect(y1).toBeLessThan(y01);
  expect(y01).toBeLessThan(y001);
});

test('[T18-AC2-2] Diagram seam: renderStressChartSvg standalone SVG export', () => {
  const points = [{ n: 12, regExpTime: 1.5, nfaTime: 0.1 }];
  const svgStandalone = renderStressChartSvg(points, {
    standalone: true,
    title: 'Custom <Title> & "Export"',
    desc: 'Export <description> & info'
  });

  expect(svgStandalone.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  expect(svgStandalone).toContain('xmlns="http://www.w3.org/2000/svg"');
  expect(svgStandalone).toContain('<svg viewBox="0 0 760 320" width="760"');
  expect(svgStandalone).toContain('height="320"');
  expect(svgStandalone).toContain('viewBox="0 0 760 320"');
  expect(svgStandalone).toContain('<title>Custom &lt;Title&gt; &amp; &quot;Export&quot;</title>');
  expect(svgStandalone).toContain('<desc>Export &lt;description&gt; &amp; info</desc>');
  expect(svgStandalone).toContain('<rect width="760" height="320" fill="#fafafa" rx="6" />');

  // Security / standalone sanity: no scripts, no handlers, no external references (beyond standard xmlns)
  expect(svgStandalone).not.toMatch(/<script\b/i);
  expect(svgStandalone).not.toMatch(/\bon\w+\s*=/i);
  expect(svgStandalone).not.toMatch(/(?:href|src)\s*=\s*['"]?https?:\/\//i);
  expect(svgStandalone).not.toMatch(/url\(/i);
});

test('toDot supports labelMap for Final NFA renumbering with built-as tooltips', () => {
  const analysis = analyze('(a|b)*a', { notation: 'standard', concatenation: 'epsilon-link' });
  expect(analysis.ok).toBe(true);
  if (!analysis.ok) return;

  const labelMap = new Map<number, string>([
    [6, 'q0'],
    [4, 'q1'],
    [7, 'q2'],
    [0, 'q3'],
    [2, 'q4'],
    [8, 'q5'],
    [1, 'q6'],
    [3, 'q7'],
    [5, 'q8'],
    [9, 'q9']
  ]);

  const stateCreators: Record<number, { step: number; rule: string }> = {};
  for (const s of analysis.steps) {
    for (const q of s.newStates) {
      if (!stateCreators[q]) stateCreators[q] = { step: s.index, rule: s.rule };
    }
  }

  const dot = toDot(analysis.nfa, {
    labelMap,
    stateCreators
  });

  // Start arrow points to engine start state q6
  expect(dot).toContain('__start -> q6 [id="start-edge"]');
  // State 6 has label "q0" and tooltip containing "built as 6"
  expect(dot).toMatch(/q6\s*\[[^\]]*label="q0"[^\]]*tooltip="State q0 \(built as 6\)/);
  // State 9 has label "q9" and doublecircle
  expect(dot).toMatch(/q9\s*\[[^\]]*label="q9"[^\]]*shape=doublecircle/);
  // Unchanged engine node IDs
  expect(dot).toContain('id="n6"');
  expect(dot).toContain('id="n9"');
});

































