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
        const rawOutput = result.output as string;
        const svg = format === 'svg' ? postProcessDiagramSvg(rawOutput) : rawOutput;
        return { ok: true, svg };
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

/**
 * Post-processes rendered Graphviz SVG:
 * 1. Sanitizes Graphviz default white background polygon to transparent.
 * 2. Standardizes epsilon edge dashed pattern to 4,3.
 * 3. Wraps edge labels in rounded <rect class="edge-label-pill"> background pills.
 * 4. Ensures clearance between label pills and arrowhead polygons so arrowheads are never covered.
 */
export function postProcessDiagramSvg(svg: string): string {
  // 1. Sanitize Graphviz default white background polygon to transparent
  let out = svg.replace(
    /<polygon fill="white" stroke="none"[^>]*\/>/,
    '<polygon fill="transparent" stroke="none" points="" />'
  );

  // 2. Process edge groups
  out = out.replace(/<g id="([^"]+)" class="edge">([\s\S]*?)<\/g>/g, (edgeGroup, edgeId, inner) => {
    // Idempotency: skip if already post-processed
    if (inner.includes('edge-label-pill')) {
      return edgeGroup;
    }

    // Check if epsilon edge
    const isEps = /<text[^>]*>\s*ε/.test(inner);
    let updatedInner = inner;

    if (isEps) {
      // Standardize dash pattern to 4,3
      updatedInner = updatedInner.replace(/stroke-dasharray="[^"]*"/g, 'stroke-dasharray="4,3"');
    }

    // Find arrowhead polygon
    const polyMatch = /<polygon fill="([^"]*)" stroke="([^"]*)"(?: stroke-width="([^"]*)")? points="([^"]+)"\/>/.exec(updatedInner);
    let arrowBox: { minX: number; maxX: number; minY: number; maxY: number } | null = null;
    if (polyMatch) {
      const pts = polyMatch[4].trim().split(/\s+/).map((p) => {
        const [x, y] = p.split(',').map(Number);
        return { x, y };
      });
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      arrowBox = {
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys)
      };
    }

    // Find text label
    const textMatch = /<text([^>]*)>([\s\S]*?)<\/text>/.exec(updatedInner);
    if (textMatch) {
      const attrs = textMatch[1];
      const textContent = textMatch[2].trim();
      const xMatch = /x="([^"]+)"/.exec(attrs);
      const yMatch = /y="([^"]+)"/.exec(attrs);

      if (xMatch && yMatch) {
        let textX = parseFloat(xMatch[1]);
        const textY = parseFloat(yMatch[1]);

        // Calculate pill geometry
        const textLen = textContent.replace(/&[^;]+;/g, ' ').length;
        const pillWidth = Math.max(18, textLen * 8.5 + 8);
        const pillHeight = 18;
        let pillX = textX - pillWidth / 2;
        const pillY = textY - 13;

        // Check clearance with arrowhead (minimum 4px clearance)
        if (arrowBox) {
          if (arrowBox.minX >= textX) {
            // Arrowhead is to the right
            const overlap = (pillX + pillWidth) - (arrowBox.minX - 4);
            if (overlap > 0) {
              pillX -= overlap;
              textX -= overlap;
            }
          } else if (arrowBox.maxX <= textX) {
            // Arrowhead is to the left
            const overlap = (arrowBox.maxX + 4) - pillX;
            if (overlap > 0) {
              pillX += overlap;
              textX += overlap;
            }
          }
        }

        const pillRect = `<rect class="edge-label-pill" x="${pillX.toFixed(2)}" y="${pillY.toFixed(2)}" width="${pillWidth.toFixed(2)}" height="${pillHeight.toFixed(2)}" rx="3" ry="3" fill="var(--bg-canvas, #ffffff)" stroke="none"/>`;
        const updatedAttrs = attrs.replace(/x="[^"]+"/, `x="${textX.toFixed(2)}"`);
        const updatedText = `<text${updatedAttrs}>${textContent}</text>`;

        updatedInner = updatedInner.replace(textMatch[0], `${pillRect}\n${updatedText}`);
      }
    }

    return `<g id="${edgeId}" class="edge">${updatedInner}</g>`;
  });

  return out;
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
  view?: 'flat';
  postfixCount?: number;
  caps?: Partial<SizeCaps>;
  pin?: Map<number, [number, number]> | Record<number, [number, number]>;
  bounds?: { minX: number; minY: number; maxX: number; maxY: number };
  splines?: boolean;
  activeStates?: number[] | Set<number>;
  highlightStates?: number[] | Set<number>;
  compactLabels?: boolean;
  labelMap?: Map<number, string | number> | Record<number, string | number>;
  stateCreators?: Record<number, { step: number; rule: string }>;
}

export type DiagramCapMode = 'flat' | 'off';

export function checkDiagramCap(
  postfixCount: number,
  customCaps?: Partial<SizeCaps>
): DiagramCapMode {
  const caps = { ...CAPS, ...customCaps };
  if (postfixCount > caps.textbookStepping) {
    return 'off';
  }
  return 'flat';
}

function escapeLabel(label: string): string {
  return label.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
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
  }

  const isSnapshot = 'stack' in input;

  const states = input.states;
  const transitions = input.transitions;
  const stack = isSnapshot
    ? input.stack
    : [{ start: (input as NFA).start, accept: (input as NFA).accept }];
  const newStates = new Set(isSnapshot ? input.newStates ?? [] : []);
  const newTransitions = isSnapshot ? input.newTransitions ?? [] : [];
  const mergedPair = isSnapshot ? input.mergedPair : undefined;
  const stateCreators = isSnapshot ? input.stateCreators : options?.stateCreators;
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
    '  ranksep=0.55;',
    '  nodesep=0.45;',
    '  bgcolor="transparent";',
    '  node [shape=circle, fontname="Helvetica", penwidth=1.5];',
    '  edge [fontname="Helvetica", arrowsize=0.85];'
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



    const isFinalMode = !isSnapshot && options?.labelMap !== undefined;
    if (isFinalMode) {
      const creatorInfo =
        stateCreators && stateCreators[q]
          ? ` - Created by step ${stateCreators[q].step}: ${escapeLabel(stateCreators[q].rule)}`
          : '';
      attrs.push(`tooltip="State ${displayId} (built as ${q})${creatorInfo}"`);
    } else if (stateCreators && stateCreators[q]) {
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

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface StressChartPoint {
  n: number;
  regExpTime?: number | null;
  regExpTimeout?: boolean;
  nfaTime: number;
}

export interface StressChartOptions {
  width?: number;
  height?: number;
  title?: string;
  scale?: 'linear' | 'log';
  standalone?: boolean;
  desc?: string;
}

export function renderStressChartSvg(
  points: StressChartPoint[],
  options: StressChartOptions = {}
): string {
  const width = options.width || 760;
  const height = options.height || 320;
  const title = options.title || 'Backtracking vs Thompson NFA';
  const scale = options.scale || 'linear';
  const standalone = options.standalone || false;
  const escapedTitle = escapeXml(title);
  const desc = options.desc || 'Comparison chart between RegExp backtracking and Thompson NFA execution time.';
  const escapedDesc = escapeXml(desc);

  if (points.length === 0) {
    const widthAttr = standalone ? `width="${width}"` : 'width="100%"';
    const xmlDecl = standalone ? '<?xml version="1.0" encoding="UTF-8"?>\n' : '';
    const descTag = standalone ? `\n  <desc>${escapedDesc}</desc>` : '';
    return `${xmlDecl}<svg viewBox="0 0 ${width} ${height}" ${widthAttr} height="${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapedTitle}">
  <title>${escapedTitle}</title>${descTag}
  <rect width="${width}" height="${height}" fill="#fafafa" rx="6" />
  <text x="${width / 2}" y="24" text-anchor="middle" font-family="sans-serif" font-size="14" font-weight="bold" fill="#202124">${escapedTitle}</text>
  <text x="${width / 2}" y="${height / 2 + 10}" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#777777">Run stress test to see comparison chart</text>
</svg>`;
  }

  // Two panels:
  // Panel A: n in [12, 30], both series, domain [12, 30]
  // Panel B: NFA only, n in [0, 1000], domain [0, 1000]
  const panelA = {
    left: 65,
    top: 50,
    width: 290,
    height: 215,
    minN: 12,
    maxN: 30,
    minY: 0,
    maxY: 8000
  };

  const panelB = {
    left: 425,
    top: 50,
    width: 290,
    height: 215,
    minN: 0,
    maxN: 1000,
    minY: 0,
    maxY: 10 // ms
  };

  const getXA = (n: number): number => {
    return panelA.left + ((n - panelA.minN) / (panelA.maxN - panelA.minN)) * panelA.width;
  };

  const getYA = (ms: number): number => {
    if (scale === 'log') {
      const minLog = Math.log10(0.01);
      const maxLog = Math.log10(8000);
      const clamped = Math.max(0.01, Math.min(ms, 8000));
      const t = (Math.log10(clamped) - minLog) / (maxLog - minLog);
      return panelA.top + panelA.height - t * panelA.height;
    }
    const clamped = Math.max(0, Math.min(ms, panelA.maxY));
    return panelA.top + panelA.height - (clamped / panelA.maxY) * panelA.height;
  };

  const getXB = (n: number): number => {
    return panelB.left + ((n - panelB.minN) / (panelB.maxN - panelB.minN)) * panelB.width;
  };

  const getYB = (ms: number): number => {
    const clamped = Math.max(0, Math.min(ms, panelB.maxY));
    return panelB.top + panelB.height - (clamped / panelB.maxY) * panelB.height;
  };

  const lines: string[] = [];
  if (standalone) {
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  }
  const widthAttr = standalone ? `width="${width}"` : 'width="100%"';
  lines.push(`<svg viewBox="0 0 ${width} ${height}" ${widthAttr} height="${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapedTitle}">`);
  lines.push(`  <title>${escapedTitle}</title>`);
  if (standalone) {
    lines.push(`  <desc>${escapedDesc}</desc>`);
  }
  lines.push(`  <rect width="${width}" height="${height}" fill="#fafafa" rx="6" />`);
  lines.push(`  <text x="${width / 2}" y="22" text-anchor="middle" font-family="sans-serif" font-size="14" font-weight="bold" fill="#202124">${escapedTitle}</text>`);

  // Global Legend
  lines.push(`  <g transform="translate(${width - 240}, 10)" font-family="sans-serif" font-size="11">`);
  lines.push(`    <line x1="0" y1="10" x2="16" y2="10" stroke="#d93025" stroke-width="2.5" />`);
  lines.push(`    <circle cx="8" cy="10" r="3.5" fill="#d93025" />`);
  lines.push(`    <text x="22" y="14" fill="#333333">RegExp</text>`);
  lines.push(`    <line x1="100" y1="10" x2="116" y2="10" stroke="#1a73e8" stroke-width="2.5" />`);
  lines.push(`    <circle cx="108" cy="10" r="3.5" fill="#1a73e8" />`);
  lines.push(`    <text x="122" y="14" fill="#333333">Thompson NFA</text>`);
  lines.push(`  </g>`);

  // ==========================================
  // PANEL A: n = 12 to 30 (Both Series)
  // ==========================================
  const panelATitle = scale === 'log'
    ? 'Panel A: n = 12 to 30 (Backtracking vs NFA) (log scale)'
    : 'Panel A: n = 12 to 30 (Backtracking vs NFA)';
  lines.push(`  <text x="${panelA.left + panelA.width / 2}" y="${panelA.top - 12}" text-anchor="middle" font-family="sans-serif" font-size="12" font-weight="bold" fill="#3c4043">${panelATitle}</text>`);

  // Grid lines & Y ticks for Panel A
  if (scale === 'log') {
    const logTicks: Array<{ val: number; label: string }> = [
      { val: 0.01, label: '≤0.01 ms' },
      { val: 0.1, label: '0.1 ms' },
      { val: 1, label: '1 ms' },
      { val: 10, label: '10 ms' },
      { val: 100, label: '100 ms' },
      { val: 1000, label: '1000 ms' },
      { val: 8000, label: '8000 ms' }
    ];
    for (const { val, label } of logTicks) {
      const yPos = getYA(val);
      const isTop = val === 8000;
      lines.push(`  <line x1="${panelA.left}" y1="${yPos.toFixed(1)}" x2="${panelA.left + panelA.width}" y2="${yPos.toFixed(1)}" stroke="${isTop ? '#ea4335' : '#e0e0e0'}" stroke-width="${isTop ? '1.5' : '1'}" ${isTop ? 'stroke-dasharray="4,4"' : ''} />`);
      lines.push(`  <text x="${panelA.left - 8}" y="${(yPos + 4).toFixed(1)}" text-anchor="end" font-family="sans-serif" font-size="10" fill="${isTop ? '#ea4335' : '#5f6368'}">${label}</text>`);
    }
  } else {
    const yTicksA = [0, 2000, 4000, 6000, 8000];
    for (const yt of yTicksA) {
      const yPos = getYA(yt);
      lines.push(`  <line x1="${panelA.left}" y1="${yPos.toFixed(1)}" x2="${panelA.left + panelA.width}" y2="${yPos.toFixed(1)}" stroke="${yt === 8000 ? '#ea4335' : '#e0e0e0'}" stroke-width="${yt === 8000 ? '1.5' : '1'}" ${yt === 8000 ? 'stroke-dasharray="4,4"' : ''} />`);
      const label = yt === 8000 ? '8000 ms' : `${yt} ms`;
      lines.push(`  <text x="${panelA.left - 8}" y="${(yPos + 4).toFixed(1)}" text-anchor="end" font-family="sans-serif" font-size="10" fill="${yt === 8000 ? '#ea4335' : '#5f6368'}">${label}</text>`);
    }
  }

  // Axes lines for Panel A
  lines.push(`  <line x1="${panelA.left}" y1="${panelA.top}" x2="${panelA.left}" y2="${panelA.top + panelA.height}" stroke="#70757a" stroke-width="1.5" />`);
  lines.push(`  <line x1="${panelA.left}" y1="${panelA.top + panelA.height}" x2="${panelA.left + panelA.width}" y2="${panelA.top + panelA.height}" stroke="#70757a" stroke-width="1.5" />`);

  // X ticks for Panel A
  const xTicksA = [12, 16, 20, 24, 28, 30];
  for (const xt of xTicksA) {
    const xPos = getXA(xt);
    lines.push(`  <line x1="${xPos.toFixed(1)}" y1="${panelA.top + panelA.height}" x2="${xPos.toFixed(1)}" y2="${panelA.top + panelA.height + 5}" stroke="#70757a" stroke-width="1" />`);
    lines.push(`  <text x="${xPos.toFixed(1)}" y="${panelA.top + panelA.height + 16}" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#3c4043">${xt}</text>`);
  }
  lines.push(`  <text x="${panelA.left + panelA.width / 2}" y="${height - 10}" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#5f6368">n (domain [12, 30])</text>`);

  // Filter points for Panel A
  const pointsA = points.filter((p) => p.n >= 12 && p.n <= 30);

  // Panel A: RegExp polyline and points
  const regExpPolyA: string[] = [];
  pointsA.forEach((pt) => {
    if (pt.regExpTime !== null && pt.regExpTime !== undefined) {
      const x = getXA(pt.n);
      const y = getYA(pt.regExpTime);
      regExpPolyA.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
  });

  if (regExpPolyA.length > 1) {
    lines.push(`  <polyline fill="none" stroke="#d93025" stroke-width="2.5" stroke-linejoin="round" points="${regExpPolyA.join(' ')}" />`);
  }

  pointsA.forEach((pt) => {
    if (pt.regExpTime !== null && pt.regExpTime !== undefined) {
      const x = getXA(pt.n);
      const y = getYA(pt.regExpTime);
      if (pt.regExpTimeout) {
        // Red cross marker at ceiling
        lines.push(`  <g id="panelA-timeout" transform="translate(${x.toFixed(1)}, ${panelA.top.toFixed(1)})">`);
        lines.push(`    <circle cx="0" cy="0" r="6" fill="#ea4335" />`);
        lines.push(`    <line x1="-3" y1="-3" x2="3" y2="3" stroke="#fff" stroke-width="2" />`);
        lines.push(`    <line x1="-3" y1="3" x2="3" y2="-3" stroke="#fff" stroke-width="2" />`);
        lines.push(`    <text x="0" y="-8" text-anchor="middle" font-family="sans-serif" font-size="9" font-weight="bold" fill="#ea4335">timeout</text>`);
        lines.push(`    <title>n=${pt.n}: RegExp TIMEOUT (&gt;8000ms)</title>`);
        lines.push(`  </g>`);
      } else {
        lines.push(`  <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="#d93025">`);
        lines.push(`    <title>n=${pt.n}: RegExp ${pt.regExpTime.toFixed(1)}ms</title>`);
        lines.push(`  </circle>`);
      }
    }
  });

  // Panel A: NFA polyline and points
  const nfaPolyA: string[] = [];
  pointsA.forEach((pt) => {
    const x = getXA(pt.n);
    const y = getYA(pt.nfaTime);
    nfaPolyA.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  });

  if (nfaPolyA.length > 1) {
    lines.push(`  <polyline fill="none" stroke="#1a73e8" stroke-width="2" stroke-linejoin="round" points="${nfaPolyA.join(' ')}" />`);
  }

  pointsA.forEach((pt) => {
    const x = getXA(pt.n);
    const y = getYA(pt.nfaTime);
    lines.push(`  <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="#1a73e8">`);
    lines.push(`    <title>n=${pt.n}: NFA ${pt.nfaTime.toFixed(2)}ms</title>`);
    lines.push(`  </circle>`);
  });

  // ==========================================
  // PANEL B: NFA only, n = 12 to 1,000, domain [0, 1000]
  // ==========================================
  lines.push(`  <text x="${panelB.left + panelB.width / 2}" y="${panelB.top - 12}" text-anchor="middle" font-family="sans-serif" font-size="12" font-weight="bold" fill="#3c4043">Panel B: NFA up to n = 1,000</text>`);

  // Grid lines & Y ticks for Panel B
  const yTicksB = [0, 2, 4, 6, 8, 10];
  for (const yt of yTicksB) {
    const yPos = getYB(yt);
    lines.push(`  <line x1="${panelB.left}" y1="${yPos.toFixed(1)}" x2="${panelB.left + panelB.width}" y2="${yPos.toFixed(1)}" stroke="#e0e0e0" stroke-width="1" />`);
    lines.push(`  <text x="${panelB.left - 8}" y="${(yPos + 4).toFixed(1)}" text-anchor="end" font-family="sans-serif" font-size="10" fill="#5f6368">${yt} ms</text>`);
  }

  // Axes lines for Panel B
  lines.push(`  <line x1="${panelB.left}" y1="${panelB.top}" x2="${panelB.left}" y2="${panelB.top + panelB.height}" stroke="#70757a" stroke-width="1.5" />`);
  lines.push(`  <line x1="${panelB.left}" y1="${panelB.top + panelB.height}" x2="${panelB.left + panelB.width}" y2="${panelB.top + panelB.height}" stroke="#70757a" stroke-width="1.5" />`);

  // X ticks for Panel B
  const xTicksB = [0, 200, 400, 600, 800, 1000];
  for (const xt of xTicksB) {
    const xPos = getXB(xt);
    lines.push(`  <line x1="${xPos.toFixed(1)}" y1="${panelB.top + panelB.height}" x2="${xPos.toFixed(1)}" y2="${panelB.top + panelB.height + 5}" stroke="#70757a" stroke-width="1" />`);
    lines.push(`  <text x="${xPos.toFixed(1)}" y="${panelB.top + panelB.height + 16}" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#3c4043">${xt}</text>`);
  }
  lines.push(`  <text x="${panelB.left + panelB.width / 2}" y="${height - 10}" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#5f6368">n (domain [0, 1000])</text>`);

  // Points for Panel B: all points up to 1000
  const pointsB = points.filter((p) => p.n >= 0 && p.n <= 1000).sort((a, b) => a.n - b.n);

  const nfaPolyB: string[] = [];
  pointsB.forEach((pt) => {
    const x = getXB(pt.n);
    const y = getYB(pt.nfaTime);
    nfaPolyB.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  });

  if (nfaPolyB.length > 1) {
    lines.push(`  <polyline fill="none" stroke="#1a73e8" stroke-width="2" stroke-linejoin="round" points="${nfaPolyB.join(' ')}" />`);
  }

  pointsB.forEach((pt) => {
    const x = getXB(pt.n);
    const y = getYB(pt.nfaTime);
    if (pt.nfaTime > panelB.maxY) {
      lines.push(`  <g class="clipped-marker" transform="translate(${x.toFixed(1)}, ${panelB.top.toFixed(1)})">`);
      lines.push(`    <polygon points="0,-6 -5,3 5,3" fill="#1a73e8" stroke="#ffffff" stroke-width="1" />`);
      lines.push(`    <title>n=${pt.n}: NFA (0-1000) ${pt.nfaTime.toFixed(2)}ms (clipped)</title>`);
      lines.push(`  </g>`);
    } else {
      lines.push(`  <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="#1a73e8">`);
      lines.push(`    <title>n=${pt.n}: NFA (0-1000) ${pt.nfaTime.toFixed(2)}ms</title>`);
      lines.push(`  </circle>`);
    }
  });

  lines.push('</svg>');
  return lines.join('\n');
}

