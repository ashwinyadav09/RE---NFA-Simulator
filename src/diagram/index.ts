import type { NFA } from '../engine/index';
import { instance, type Viz } from '@viz-js/viz';

export type RenderResult =
  | { ok: true; svg: string }
  | { ok: false; error: string };

export interface DiagramRenderer {
  render(dot: string): Promise<RenderResult>;
}

/**
 * In-memory fake renderer for testing.
 * Uses a documented heuristic to detect malformed DOT syntax without invoking Graphviz:
 * 1. Must begin with "digraph" or "graph" (optionally preceded by "strict").
 * 2. Braces must be balanced with at least one matching pair.
 * 3. Edges must have both source and target (no orphan arrows like "-> ;", "-> }", or "{ ->").
 */
export class FakeRenderer implements DiagramRenderer {
  async render(dot: string): Promise<RenderResult> {
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

  async render(dot: string): Promise<RenderResult> {
    try {
      const viz = await this.getViz();
      const result = viz.render(dot, { format: 'svg' });
      if (result.status === 'success' && result.output) {
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

function escapeLabel(label: string): string {
  return label.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function toDot(nfa: NFA): string {
  const lines: string[] = [
    'digraph NFA {',
    '  rankdir=LR;',
    '  node [shape=circle, fontname="Helvetica"];',
    '  edge [fontname="Helvetica"];',
    '  __start [id="start-node", shape=point, label="", width=0.1];'
  ];

  for (const q of [...nfa.states].sort((a, b) => a - b)) {
    const attrs = [`id="n${q}"`, `label="${q}"`];
    if (q === nfa.accept) {
      attrs.push('shape=doublecircle');
    }
    lines.push(`  q${q} [${attrs.join(', ')}];`);
  }

  if (nfa.states.includes(nfa.start)) {
    lines.push(`  __start -> q${nfa.start} [id="start-edge"];`);
  }

  nfa.transitions.forEach((t, i) => {
    const attrs = [`id="e${i}"`, `label="${escapeLabel(t.label)}"`];
    if (t.label === 'ε') {
      attrs.push('style=dashed');
    }
    lines.push(`  q${t.from} -> q${t.to} [${attrs.join(', ')}];`);
  });

  lines.push('}');
  return lines.join('\n');
}
