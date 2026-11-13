import { describe, it, expect } from 'vitest';
import { analyze } from '../src/engine/index';
import { normalizeStateLabels } from '../src/ui/state-labels';

describe('normalizeStateLabels', () => {
  it('correctly maps (a|b)*a in epsilon-link mode per hand-checked fixture', () => {
    const analysis = analyze('(a|b)*a', { notation: 'standard', concatenation: 'epsilon-link' });
    expect(analysis.ok).toBe(true);
    if (!analysis.ok) return;

    const map = normalizeStateLabels(analysis.nfa);
    expect(map.get(6)).toBe('q0');
    expect(map.get(4)).toBe('q1');
    expect(map.get(7)).toBe('q2');
    expect(map.get(0)).toBe('q3');
    expect(map.get(2)).toBe('q4');
    expect(map.get(8)).toBe('q5');
    expect(map.get(1)).toBe('q6');
    expect(map.get(3)).toBe('q7');
    expect(map.get(5)).toBe('q8');
    expect(map.get(9)).toBe('q9');
    expect(map.size).toBe(10);
  });

  it('correctly maps single symbol a in epsilon-link mode', () => {
    const analysis = analyze('a', { notation: 'standard', concatenation: 'epsilon-link' });
    expect(analysis.ok).toBe(true);
    if (!analysis.ok) return;

    const map = normalizeStateLabels(analysis.nfa);
    expect(map.get(0)).toBe('q0');
    expect(map.get(1)).toBe('q1');
    expect(map.size).toBe(2);
  });

  it('correctly maps union a|b in epsilon-link mode', () => {
    const analysis = analyze('a|b', { notation: 'standard', concatenation: 'epsilon-link' });
    expect(analysis.ok).toBe(true);
    if (!analysis.ok) return;

    const map = normalizeStateLabels(analysis.nfa);
    expect(map.get(4)).toBe('q0');
    expect(map.get(0)).toBe('q1');
    expect(map.get(2)).toBe('q2');
    expect(map.get(1)).toBe('q3');
    expect(map.get(3)).toBe('q4');
    expect(map.get(5)).toBe('q5');
    expect(map.size).toBe(6);
  });

  it('correctly maps (a|b)*abb in epsilon-link mode', () => {
    const analysis = analyze('(a|b)*abb', { notation: 'standard', concatenation: 'epsilon-link' });
    expect(analysis.ok).toBe(true);
    if (!analysis.ok) return;

    const map = normalizeStateLabels(analysis.nfa);
    expect(map.get(6)).toBe('q0');
    expect(map.get(4)).toBe('q1');
    expect(map.get(7)).toBe('q2');
    expect(map.get(0)).toBe('q3');
    expect(map.get(2)).toBe('q4');
    expect(map.get(8)).toBe('q5');
    expect(map.get(1)).toBe('q6');
    expect(map.get(3)).toBe('q7');
    expect(map.get(9)).toBe('q8');
    expect(map.get(5)).toBe('q9');
    expect(map.get(10)).toBe('q10');
    expect(map.get(11)).toBe('q11');
    expect(map.get(12)).toBe('q12');
    expect(map.get(13)).toBe('q13');
    expect(map.size).toBe(14);
  });

  it('correctly maps epsilon alias @', () => {
    const analysis = analyze('@', { notation: 'standard', concatenation: 'epsilon-link' });
    expect(analysis.ok).toBe(true);
    if (!analysis.ok) return;

    const map = normalizeStateLabels(analysis.nfa);
    expect(map.get(0)).toBe('q0');
    expect(map.get(1)).toBe('q1');
    expect(map.size).toBe(2);
  });

  it('correctly maps empty set alias # (unreachable accept is last)', () => {
    const analysis = analyze('#', { notation: 'standard', concatenation: 'epsilon-link' });
    expect(analysis.ok).toBe(true);
    if (!analysis.ok) return;

    const map = normalizeStateLabels(analysis.nfa);
    expect(map.get(0)).toBe('q0');
    expect(map.get(1)).toBe('q1');
    expect(map.size).toBe(2);
  });

  it('correctly maps (a|b)*a in merge mode with contiguous labels and no gaps', () => {
    const analysis = analyze('(a|b)*a', { notation: 'standard', concatenation: 'merge' });
    expect(analysis.ok).toBe(true);
    if (!analysis.ok) return;

    // States in merge mode: 0, 1, 2, 3, 4, 5, 6, 7, 9 (state 8 was merged into 7)
    const map = normalizeStateLabels(analysis.nfa);
    expect(map.get(6)).toBe('q0');
    expect(map.get(4)).toBe('q1');
    expect(map.get(7)).toBe('q2');
    expect(map.get(0)).toBe('q3');
    expect(map.get(2)).toBe('q4');
    expect(map.get(1)).toBe('q5');
    expect(map.get(3)).toBe('q6');
    expect(map.get(5)).toBe('q7');
    expect(map.get(9)).toBe('q8');
    expect(map.size).toBe(9);

    // Contiguous check: values must be q0 through q8
    const values = Array.from(map.values()).sort((a, b) => {
      const na = Number(a.slice(1));
      const nb = Number(b.slice(1));
      return na - nb;
    });
    expect(values).toEqual(['q0', 'q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8']);
  });
});

