import type { NFA } from '../engine/index';
import { instance, type Viz } from '@viz-js/viz';

export type RenderResult =
  | { ok: true; svg: string }
  | { ok: false; error: string };

export interface DiagramRenderer {
  render(dot: string): Promise<RenderResult>;
}

export class FakeRenderer implements DiagramRenderer {
  async render(dot: string): Promise<RenderResult> {
    const trimmed = dot.trim();
    if (!trimmed.startsWith('digraph') || !trimmed.endsWith('}') || trimmed.includes('-> }')) {
      return { ok: false, error: 'Invalid DOT syntax' };
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
    const attrs = [`id="e${i}"`, `label="${t.label}"`];
    if (t.label === 'ε') {
      attrs.push('style=dashed');
    }
    lines.push(`  q${t.from} -> q${t.to} [${attrs.join(', ')}];`);
  });

  lines.push('}');
  return lines.join('\n');
}
