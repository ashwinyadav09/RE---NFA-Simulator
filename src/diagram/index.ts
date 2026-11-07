import { CAPS, type SizeCaps, type NFA, type StepSnapshot, type Fragment } from '../engine/index';
import { instance, type Viz } from '@viz-js/viz';

export { CAPS, type SizeCaps };

export type RenderResult =
  | { ok: true; svg: string }
  | { ok: false; error: string };

export interface RenderOptions {
  engine?: string;
  format?: 'svg' | 'json';
}

export interface DiagramRenderer {
  render(dot: string, options?: RenderOptions): Promise<RenderResult>;
}

/**
 * In-memory fake renderer for testing.
 * Uses a documented heuristic to detect malformed DOT syntax without invoking Graphviz:
 * 1. Must begin with "digraph" or "graph" (optionally preceded by "strict").
 * 2. Braces must be balanced with at least one matching pair.
 * 3. Edges must have both source and target (no orphan arrows like "-> ;", "-> }", or "{ ->").
 */
export class FakeRenderer implements DiagramRenderer {
  async render(dot: string, options?: RenderOptions): Promise<RenderResult> {
    const trimmed = dot.trim();

    // 1. Must start with (strict )?(di)?graph
    if (!/^(?:strict\s+)?(?:di)?graph\b/.test(trimmed)) {
      return { ok: false, error: 'Invalid DOT syntax: missing graph or digraph header' };
    }

    // 2. Braces must be balanced with at least one pair
    let braceCount = 0;
    let hasOpenBrace = false;
    for (const char of trimmed) {
      if (char === '{') {
        braceCount++;
        hasOpenBrace = true;
      } else if (char === '}') {
        braceCount--;
        if (braceCount < 0) {
          return { ok: false, error: 'Invalid DOT syntax: unexpected closing brace' };
        }
      }
    }
    if (!hasOpenBrace || braceCount !== 0) {
      return { ok: false, error: 'Invalid DOT syntax: unbalanced braces' };
    }

    // 3. Edges must have a target and source (no orphan arrows)
    if (/(?:->|--)\s*[;}\]]/.test(trimmed)) {
      return { ok: false, error: 'Invalid DOT syntax: edge arrow without target' };
    }
    if (/[{;]\s*(?:->|--)/.test(trimmed)) {
      return { ok: false, error: 'Invalid DOT syntax: edge arrow without source' };
    }

    if (options?.format === 'json') {
      const nodeIds = new Set<number>();
      const nodeRegex = /\bq(\d+)\b/g;
      let m: RegExpExecArray | null;
      while ((m = nodeRegex.exec(trimmed)) !== null) {
        nodeIds.add(Number(m[1]));
      }
      const objects = [...nodeIds].sort((a, b) => a - b).map((id, index) => ({
        name: `q${id}`,
        pos: `${index * 100},50`
      }));
      return {
        ok: true,
        svg: JSON.stringify({ objects })
      };
    }

    return {
      ok: true,
      svg: `<svg xmlns="http://www.w3.org/2000/svg"><g id="fake-graph">${dot}</g></svg>`
    };
  }
}

export class VizRenderer implements DiagramRenderer {
  private static vizInstancePromise: Promise<Viz> | null = null;

  private async getViz(): Promise<Viz> {
    if (!VizRenderer.vizInstancePromise) {
      VizRenderer.vizInstancePromise = instance();
    }
    return VizRenderer.vizInstancePromise;
  }

  async render(dot: string, options?: RenderOptions): Promise<RenderResult> {
    try {
      const viz = await this.getViz();
      const format = options?.format ?? 'svg';
      const result = viz.render(dot, {
        format,
        ...(options?.engine ? { engine: options.engine } : {})
      });
      if (result.status === 'success' && result.output !== undefined) {
        return { ok: true, svg: result.output as string };
      }
      const errMsg =
        result.errors && result.errors.length > 0
          ? result.errors.map((e) => e.message).join('\n')
          : 'Render failed';
      return { ok: false, error: errMsg };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export function extractNodePositions(rawJson: string | object): Map<number, [number, number]> {
  const json = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
  const positions = new Map<number, [number, number]>();
  if (json && Array.isArray(json.objects)) {
    for (const obj of json.objects) {
      const match = /^q(\d+)$/.exec(obj.name);
      if (match && obj.pos) {
        const [x, y] = obj.pos.split(',').map(Number);
        if (!isNaN(x) && !isNaN(y)) {
          positions.set(Number(match[1]), [x, y]);
        }
      }
    }
  }
  return positions;
}

export async function computeMasterLayout(
  nfa: NFA,
  renderer: DiagramRenderer
): Promise<{ ok: true; positions: Map<number, [number, number]> } | { ok: false; error: string }> {
  try {
    const dot = toDot(nfa);
    const result = await renderer.render(dot, { format: 'json', engine: 'dot' });
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    const positions = extractNodePositions(result.svg);
    return { ok: true, positions };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}


export interface DiagramOptions {
  view?: 'flat' | 'textbook';
  postfixCount?: number;
  caps?: Partial<SizeCaps>;
  pin?: Map<number, [number, number]> | Record<number, [number, number]>;
  bounds?: { minX: number; minY: number; maxX: number; maxY: number };
  splines?: boolean;
  activeStates?: number[] | Set<number>;
  highlightStates?: number[] | Set<number>;
  compactLabels?: boolean;
  labelMap?: Map<number, string | number> | Record<number, string | number>;
}

export type DiagramCapMode = 'flat' | 'textbook' | 'off';

export function checkDiagramCap(
  postfixCount: number,
  customCaps?: Partial<SizeCaps>
): DiagramCapMode {
  const caps = { ...CAPS, ...customCaps };
  if (postfixCount > caps.textbookStepping) {
    return 'off';
  }
  if (postfixCount > caps.flatStepping) {
    return 'textbook';
  }
  return 'flat';
}

function escapeLabel(label: string): string {
  return label.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapeRecordLabel(label: string): string {
  return label
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\|/g, '\\|')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/</g, '\\<')
    .replace(/>/g, '\\>');
}

function toTextbookDot(snapshot: StepSnapshot, options?: DiagramOptions): string {
  const lines: string[] = [
    'digraph NFA {',
    '  rankdir=LR;',
    '  node [shape=circle, fontname="Helvetica"];',
    '  edge [fontname="Helvetica"];'
  ];

  const operands = snapshot.operands ?? [];
  const newStates = new Set(snapshot.newStates ?? []);
  const newTransitions = snapshot.newTransitions ?? [];

  const collapsedFragments: Fragment[] = [];
  const seenFrags = new Set<string>();

  for (const op of operands) {
    const key = `${op.start}->${op.accept}`;
    if (!seenFrags.has(key)) {
      seenFrags.add(key);
      collapsedFragments.push(op);
    }
  }

  // If there are operands, the fragment produced by this step is at the top of stack
  // We only add other stack fragments that were not involved in this step
  const producedFrag = operands.length > 0 ? snapshot.stack[snapshot.stack.length - 1] : undefined;

  for (const frag of snapshot.stack) {
    if (producedFrag && frag.start === producedFrag.start && frag.accept === producedFrag.accept) {
      continue;
    }
    if (!newStates.has(frag.start) && !newStates.has(frag.accept)) {
      const key = `${frag.start}->${frag.accept}`;
      if (!seenFrags.has(key)) {
        seenFrags.add(key);
        collapsedFragments.push(frag);
      }
    }
  }

  const getPortForState = (q: number): { target: string; isPort: boolean } => {
    for (const f of collapsedFragments) {
      if (q === f.start) return { target: `box_${f.start}_${f.accept}:in`, isPort: true };
      if (q === f.accept) return { target: `box_${f.start}_${f.accept}:out`, isPort: true };
    }
    return { target: `q${q}`, isPort: false };
  };

  if (snapshot.stack.length === 1) {
    const target = getPortForState(snapshot.stack[0].start).target;
    lines.push('  __start [id="start-node", shape=point, label="", width=0.1];');
    lines.push(`  __start -> ${target} [id="start-edge"];`);
  } else if (snapshot.stack.length > 1) {
    for (let idx = 0; idx < snapshot.stack.length; idx++) {
      const target = getPortForState(snapshot.stack[idx].start).target;
      lines.push(`  __start_${idx} [id="start-node-${idx}", shape=point, label="", width=0.1];`);
      lines.push(`  __start_${idx} -> ${target} [id="start-edge-${idx}"];`);
    }
  }

  for (const f of collapsedFragments) {
    const isAccept = snapshot.stack.some((s) => s.accept === f.accept);
    const label = `{<in>|${escapeRecordLabel(f.expression ?? '')}|<out>}`;
    const attrs = [
      'shape=record',
      `label="${label}"`,
      `id="frag-${f.start}-${f.accept}"`
    ];
    if (isAccept) {
      attrs.push('peripheries=2');
    }
    lines.push(`  box_${f.start}_${f.accept} [${attrs.join(', ')}];`);
  }

  const sortedNewStates = [...newStates].sort((a, b) => a - b);
  for (const q of sortedNewStates) {
    const attrs = [`id="n${q}"`, `label="${q} (new)"`, 'color="#d62728"', 'penwidth=2.5'];
    if (snapshot.stateCreators && snapshot.stateCreators[q]) {
      const info = snapshot.stateCreators[q];
      attrs.push(`tooltip="Created by step ${info.step}: ${escapeLabel(info.rule)}"`);
    }
    if (snapshot.stack.some((s) => s.accept === q)) {
      attrs.push('shape=doublecircle');
    }
    lines.push(`  q${q} [${attrs.join(', ')}];`);
  }

  let edgeIndex = 0;
  for (const t of newTransitions) {
    const src = getPortForState(t.from).target;
    const dst = getPortForState(t.to).target;
    const attrs = [`id="e${edgeIndex++}"`, `label="${escapeLabel(t.label)} (new)"`, 'color="#d62728"', 'penwidth=2.5'];
    if (t.label === 'ε') {
      attrs.push('style=dashed');
    }
    lines.push(`  ${src} -> ${dst} [${attrs.join(', ')}];`);
  }

  if (snapshot.mergedPair && newTransitions.length === 0 && operands.length === 2) {
    const src = `box_${operands[0].start}_${operands[0].accept}:out`;
    const dst = `box_${operands[1].start}_${operands[1].accept}:in`;
    lines.push(`  ${src} -> ${dst} [id="e${edgeIndex++}", color="#d62728", penwidth=2.5];`);
  }

  lines.push('}');
  return lines.join('\n');
}

export function toDot(input: NFA | StepSnapshot, options?: DiagramOptions): string {
  const caps = { ...CAPS, ...options?.caps };
  const postfixCount = options?.postfixCount;
  if (postfixCount !== undefined) {
    if (postfixCount > caps.textbookStepping) {
      throw new Error(
        `Diagram disabled: expression exceeds limit of ${caps.textbookStepping} postfix tokens (got ${postfixCount})`
      );
    }
    if (options?.view === 'flat' && postfixCount > caps.flatStepping) {
      throw new Error(
        `Flat view disabled: expression exceeds limit of ${caps.flatStepping} postfix tokens (got ${postfixCount})`
      );
    }
  }

  const isSnapshot = 'stack' in input;
  if (options?.view === 'textbook' && isSnapshot) {
    return toTextbookDot(input as StepSnapshot, options);
  }

  const states = input.states;
  const transitions = input.transitions;
  const stack = isSnapshot
    ? input.stack
    : [{ start: (input as NFA).start, accept: (input as NFA).accept }];
  const newStates = new Set(isSnapshot ? input.newStates ?? [] : []);
  const newTransitions = isSnapshot ? input.newTransitions ?? [] : [];
  const mergedPair = isSnapshot ? input.mergedPair : undefined;
  const stateCreators = isSnapshot ? input.stateCreators : undefined;
  let displayLabelMap: Record<number, string | number> | Map<number, string | number> | undefined = undefined;
  if (!isSnapshot) {
    if (options?.labelMap) {
      displayLabelMap = options.labelMap;
    } else if (options?.compactLabels) {
      const sorted = Array.from(new Set(states)).sort((a, b) => a - b);
      const map: Record<number, number> = {};
      for (let i = 0; i < sorted.length; i++) {
        map[sorted[i]] = i;
      }
      displayLabelMap = map;
    }
  }

  const getDisplayId = (stateId: number): string | number => {
    if (!displayLabelMap) return stateId;
    if (displayLabelMap instanceof Map) {
      return displayLabelMap.has(stateId) ? displayLabelMap.get(stateId)! : stateId;
    }
    return displayLabelMap[stateId] !== undefined ? displayLabelMap[stateId] : stateId;
  };

  const activeSet = new Set(
    options?.activeStates
      ? options.activeStates instanceof Set
        ? options.activeStates
        : options.activeStates
      : options?.highlightStates
        ? options.highlightStates instanceof Set
          ? options.highlightStates
          : options.highlightStates
        : []
  );

  const lines: string[] = [
    'digraph NFA {',
    '  rankdir=LR;',
    '  node [shape=circle, fontname="Helvetica"];',
    '  edge [fontname="Helvetica"];'
  ];

  const hasPin =
    options?.pin &&
    (options.pin instanceof Map ? options.pin.size > 0 : Object.keys(options.pin).length > 0);
  if (hasPin) {
    lines.push('  splines=true;');

    let llX: number;
    let llY: number;
    let urX: number;
    let urY: number;

    if (options?.bounds) {
      llX = options.bounds.minX;
      llY = options.bounds.minY;
      urX = options.bounds.maxX;
      urY = options.bounds.maxY;
    } else {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;

      const entries: [number, [number, number]][] =
        options!.pin instanceof Map
          ? [...options!.pin.entries()]
          : Object.entries(options!.pin!).map(([k, v]) => [Number(k), v]);

      for (const [, [x, y]] of entries) {
        minX = Math.min(minX, x - 36);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }

      // Add margin for node radiuses (including wide labels in merge mode) and edge curves
      const margin = 108; // 1.5 in
      llX = minX - margin;
      llY = minY - margin;
      urX = maxX + margin;
      urY = maxY + margin;
    }

    lines.push(
      `  __anchor_ll [style=invis, shape=point, width=0.001, height=0.001, pos="${(llX / 72).toFixed(4)},${(llY / 72).toFixed(4)}!"];`,
      `  __anchor_ur [style=invis, shape=point, width=0.001, height=0.001, pos="${(urX / 72).toFixed(4)},${(urY / 72).toFixed(4)}!"];`
    );
  } else if (options?.splines) {
    lines.push('  splines=true;');
  }

  const getPinPos = (q: number): [number, number] | undefined => {
    if (!options?.pin) return undefined;
    return options.pin instanceof Map ? options.pin.get(q) : options.pin[q];
  };

  const formatPin = (pos: [number, number]): string => {
    return `pos="${(pos[0] / 72).toFixed(4)},${(pos[1] / 72).toFixed(4)}!"`;
  };

  if (stack.length === 1) {
    const sPos = getPinPos(stack[0].start);
    const pinAttr = sPos ? `, ${formatPin([sPos[0] - 36, sPos[1]])}` : '';
    lines.push(`  __start [id="start-node", shape=point, label="", width=0.1${pinAttr}];`);
    if (states.includes(stack[0].start)) {
      lines.push(`  __start -> q${stack[0].start} [id="start-edge"];`);
    }
  } else if (stack.length > 1) {
    for (let idx = 0; idx < stack.length; idx++) {
      const frag = stack[idx];
      const sPos = getPinPos(frag.start);
      const pinAttr = sPos ? `, ${formatPin([sPos[0] - 36, sPos[1]])}` : '';
      lines.push(`  __start_${idx} [id="start-node-${idx}", shape=point, label="", width=0.1${pinAttr}];`);
      if (states.includes(frag.start)) {
        lines.push(`  __start_${idx} -> q${frag.start} [id="start-edge-${idx}"];`);
      }
    }
  }

  for (const q of [...states].sort((a, b) => a - b)) {
    const isNew = newStates.has(q);
    const isMerged = mergedPair !== undefined && mergedPair.into === q;
    const attrs = [`id="n${q}"`];
    const displayId = getDisplayId(q);

    if (isMerged) {
      attrs.push(`label="${displayId} (merged ${getDisplayId(mergedPair.into)}, ${getDisplayId(mergedPair.removed)})"`, 'color="#d62728"', 'penwidth=2.5');
    } else if (isNew) {
      attrs.push(`label="${displayId} (new)"`, 'color="#d62728"', 'penwidth=2.5');
    } else {
      attrs.push(`label="${displayId}"`);
    }

    const pinPos = getPinPos(q);
    if (pinPos) {
      attrs.push(formatPin(pinPos));
    }



    if (stateCreators && stateCreators[q]) {
      const info = stateCreators[q];
      attrs.push(`tooltip="Created by step ${info.step}: ${escapeLabel(info.rule)}"`);
    }

    if (stack.some((f) => f.accept === q)) {
      attrs.push('shape=doublecircle');
    }

    const isActive = activeSet.has(q);
    if (isActive) {
      attrs.push('class="active"', 'fillcolor="#b3d4fc"', 'style=filled', 'color="#1f77b4"', 'penwidth=2.5');
    }
    lines.push(`  q${q} [${attrs.join(', ')}];`);
  }

  transitions.forEach((t, i) => {
    const isNew = newTransitions.some(
      (nt) => nt.from === t.from && nt.to === t.to && nt.label === t.label
    );
    const attrs = [`id="e${i}"`];
    const rawLabel = escapeLabel(t.label);

    if (isNew) {
      attrs.push(`label="${rawLabel} (new)"`, 'color="#d62728"', 'penwidth=2.5');
    } else {
      attrs.push(`label="${rawLabel}"`);
    }

    if (t.label === 'ε') {
      attrs.push('style=dashed');
    }
    lines.push(`  q${t.from} -> q${t.to} [${attrs.join(', ')}];`);
  });

  lines.push('}');
  return lines.join('\n');
}

