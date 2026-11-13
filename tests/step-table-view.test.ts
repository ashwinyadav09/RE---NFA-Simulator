import { describe, it, expect, vi } from 'vitest';
import type { AnalysisSuccess, Step } from '../src/engine/index.js';
import {
  formatDeltaChips,
  renderFragmentStack,
  renderStepLog,
  updateStepLogActive,
  renderTransitionTable,
  updateTableActiveStates,
  exportTableCsv
} from '../src/ui/step-table-view.js';

// Simple mock element for Node environment unit testing
class MockElement {
  tagName: string;
  className = '';
  textContent = '';
  tabIndex = 0;
  children: MockElement[] = [];
  attributes: Record<string, string> = {};
  style: Record<string, string> = {};
  classList = {
    classes: new Set<string>(),
    add: (...cls: string[]) => cls.forEach((c) => this.classList.classes.add(c)),
    remove: (...cls: string[]) => cls.forEach((c) => this.classList.classes.delete(c)),
    contains: (c: string) => this.classList.classes.has(c)
  };
  listeners: Record<string, ((e: any) => void)[]> = {};

  parent: MockElement | null = null;

  constructor(tagName = 'div') {
    this.tagName = tagName;
  }

  setAttribute(k: string, v: string): void {
    this.attributes[k] = v;
  }

  getAttribute(k: string): string | null {
    return this.attributes[k] ?? null;
  }

  removeAttribute(k: string): void {
    delete this.attributes[k];
  }

  appendChild(child: any): void {
    if (child instanceof MockElement) {
      child.parent = this;
      this.children.push(child);
    } else if (child && typeof child === 'object' && child.nodeType === 3) {
      this.textContent += child.textContent;
    }
  }

  addEventListener(event: string, fn: (e: any) => void): void {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    const match = (el: MockElement) => {
      if (selector === '.step-log-item' && el.className.includes('step-log-item')) {
        results.push(el);
      } else if (selector === 'tbody tr' && el.tagName === 'tr' && el.parent?.tagName === 'tbody') {
        results.push(el);
      }
      for (const c of el.children) match(c);
    };
    match(this);
    return results;
  }

  scrollIntoView = vi.fn();
}

const mockDoc = {
  createElement: (tag: string) => new MockElement(tag),
  createTextNode: (text: string) => ({ nodeType: 3, textContent: text })
};

if (typeof (globalThis as any).document === 'undefined') {
  (globalThis as any).document = mockDoc;
}

describe('step-table-view (src/ui/step-table-view.ts)', () => {
  it('formatDeltaChips formats states and transitions delta counts', () => {
    const step: Step = {
      index: 1,
      token: 'SYMBOL',
      rule: 'symbol',
      description: "symbol 'a' (fragment 0→1)",
      newStates: [0, 1],
      newTransitions: [{ from: 0, to: 1, label: 'a' }],
      result: { start: 0, accept: 1, expression: 'a' },
      stackAfter: [{ start: 0, accept: 1, expression: 'a' }],
      stackDepthAfter: 1
    };
    const deltas = formatDeltaChips(step);
    expect(deltas.states).toBe('+2 st');
    expect(deltas.transitions).toBe('+1 tr');
    expect(deltas.merged).toBeUndefined();

    const mergeStep: Step = {
      ...step,
      mergedPair: { removed: 8, into: 7 }
    };
    const mergeDeltas = formatDeltaChips(mergeStep);
    expect(mergeDeltas.merged).toBe('merged 8 into 7');
  });

  it('renderFragmentStack renders active fragment boxes', () => {
    const container = new MockElement('div') as unknown as HTMLElement;
    renderFragmentStack(container, [{ start: 0, accept: 1 }, { start: 2, accept: 3 }]);
    const mockC = container as unknown as MockElement;
    expect(mockC.children.length).toBe(2);
    expect(mockC.children[0].textContent).toBe('Active Fragment Stack:');
    expect(mockC.children[1].children.length).toBe(2);
    expect(mockC.children[1].children[0].textContent).toBe('[ 0 → 1 ]');
    expect(mockC.children[1].children[1].textContent).toBe('[ 2 → 3 ]');
  });

  it('renderStepLog creates structured step list and updates active states', () => {
    const container = new MockElement('div') as unknown as HTMLElement;
    const steps: Step[] = [
      {
        index: 1,
        token: 'SYMBOL',
        rule: 'symbol',
        description: "symbol 'a'",
        newStates: [0, 1],
        newTransitions: [],
        result: { start: 0, accept: 1, expression: 'a' },
        stackAfter: [],
        stackDepthAfter: 1
      },
      {
        index: 2,
        token: 'STAR',
        rule: 'star',
        description: 'star of fragment 0→1',
        newStates: [2, 3],
        newTransitions: [],
        result: { start: 2, accept: 3, expression: 'a*' },
        stackAfter: [],
        stackDepthAfter: 1
      }
    ];

    renderStepLog(container, steps, 1);
    const mockC = container as unknown as MockElement;
    const items = mockC.querySelectorAll('.step-log-item');
    expect(items.length).toBe(2);
    expect(items[0].getAttribute('data-step-index')).toBe('1');
    expect(items[0].classList.contains('active')).toBe(true);
    expect(items[0].getAttribute('aria-current')).toBe('step');
    expect(items[1].classList.contains('future')).toBe(true);

    // Update active to step 2
    updateStepLogActive(container, 2);
    expect(items[0].classList.contains('past')).toBe(true);
    expect(items[1].classList.contains('active')).toBe(true);
    expect(items[1].getAttribute('aria-current')).toBe('step');
  });

  it('renderTransitionTable renders table rows and handles active state highlighting', () => {
    const container = new MockElement('div') as unknown as HTMLElement;
    const analysis = {
      nfa: {
        states: [0, 1],
        start: 0,
        accept: 1,
        transitions: [{ from: 0, to: 1, label: 'a' }]
      },
      transitionTable: {
        0: { a: [1] },
        1: {}
      },
      compactLabelMap: { 0: 0, 1: 1 }
    } as unknown as AnalysisSuccess;

    renderTransitionTable(container, analysis, false);
    const mockC = container as unknown as MockElement;
    const rows = mockC.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
    expect(rows[0].getAttribute('data-state')).toBe('0');
    expect(rows[1].getAttribute('data-state')).toBe('1');

    // Update active states
    updateTableActiveStates(container, [0]);
    expect(rows[0].classList.contains('active-state-row')).toBe(true);
    expect(rows[1].classList.contains('active-state-row')).toBe(false);

    // Clear active states
    updateTableActiveStates(container, null);
    expect(rows[0].classList.contains('active-state-row')).toBe(false);
  });

  it('exportTableCsv exports formatted CSV text', () => {
    const analysis = {
      nfa: {
        states: [0, 1],
        start: 0,
        accept: 1,
        transitions: [{ from: 0, to: 1, label: 'a' }]
      },
      transitionTable: {
        0: { a: [1] },
        1: {}
      },
      compactLabelMap: { 0: 0, 1: 1 }
    } as unknown as AnalysisSuccess;

    const csv = exportTableCsv(analysis, false);
    expect(csv).toContain('State,Symbol,Next State(s)');
    expect(csv).toContain('"q0 (start)","a","q1"');
    expect(csv).toContain('"q1 (accept)","-","-"');
  });

  it('renderTransitionTable and exportTableCsv use normalized labels and built-as titles when labelMap provided', () => {
    const container = new MockElement() as unknown as HTMLElement;
    const analysis = {
      nfa: {
        states: [6, 9],
        start: 6,
        accept: 9,
        transitions: [{ from: 6, to: 9, label: 'a' }]
      },
      transitionTable: {
        6: { a: [9] },
        9: {}
      },
      compactLabelMap: { 6: 0, 9: 1 }
    } as unknown as AnalysisSuccess;

    const labelMap = new Map<number, string>([
      [6, 'q0'],
      [9, 'q1']
    ]);

    renderTransitionTable(container, analysis, false, labelMap);
    const mockC = container as unknown as MockElement;
    const rows = mockC.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
    // Row retains engine id in data-state
    expect(rows[0].getAttribute('data-state')).toBe('6');
    expect(rows[0].getAttribute('data-display-state')).toBe('q0');
    expect(rows[0].attributes['title']).toBe('State q0 (built as 6)');
    expect(rows[0].children[0].textContent).toBe('q0 (start)');
    expect(rows[0].children[0].attributes['title']).toBe('built as 6');
    expect(rows[0].children[2].textContent).toBe('q1');

    const csv = exportTableCsv(analysis, false, labelMap);
    expect(csv).toContain('"q0 (start)","a","q1"');
    expect(csv).toContain('"q1 (accept)","-","-"');
  });
});
