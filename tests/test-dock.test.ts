import { describe, it, expect, vi } from 'vitest';
import type { RunResult } from '../src/engine/index.js';
import {
  formatDockSummary,
  formatStringLabel,
  renderTraceCards
} from '../src/ui/test-dock.js';

// Simple mock element for Node environment unit testing
class MockElement {
  tagName: string;
  private _className = '';
  get className(): string {
    return this._className;
  }
  set className(val: string) {
    this._className = val;
    this.classList.classes = new Set(val.split(/\s+/).filter(Boolean));
  }
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
      if (selector === '.trace-step' && el.classList.contains('trace-step')) {
        results.push(el);
      } else if (selector === '.trace-line' && el.classList.contains('trace-line')) {
        results.push(el);
      } else if (selector === '.trace-status' && el.classList.contains('trace-status')) {
        results.push(el);
      }
      for (const c of el.children) match(c);
    };
    match(this);
    return results;
  }
}

const mockDoc = {
  createElement: (tag: string) => new MockElement(tag),
  createTextNode: (text: string) => ({ nodeType: 3, textContent: text })
};

if (typeof (globalThis as any).document === 'undefined') {
  (globalThis as any).document = mockDoc;
}

describe('test-dock (src/ui/test-dock.ts)', () => {
  it('formatDockSummary formats summary string correctly', () => {
    expect(formatDockSummary(null)).toBe('Not run');
    expect(formatDockSummary([])).toBe('Not run');

    const results: RunResult[] = [
      {
        accepted: true,
        verdict: 'ACCEPT',
        initialClosure: [0, 1],
        afterEachSymbol: [[0, 1]],
        trace: [[0, 1], [0, 1]],
        status: 'ok'
      },
      {
        accepted: false,
        verdict: 'REJECT',
        initialClosure: [0, 1],
        afterEachSymbol: [[]],
        trace: [[0, 1], []],
        status: 'ok'
      }
    ];

    expect(formatDockSummary(results)).toBe('1 accepted · 1 rejected');
  });

  it('formatStringLabel formats string with quotes', () => {
    expect(formatStringLabel('')).toBe('""');
    expect(formatStringLabel('ba')).toBe('"ba"');
  });

  it('renderTraceCards renders structured result cards and handles step selection', () => {
    const container = new MockElement('div') as unknown as HTMLElement;
    const results: RunResult[] = [
      {
        accepted: true,
        verdict: 'ACCEPT',
        initialClosure: [0, 2],
        afterEachSymbol: [[1, 3], [4]],
        trace: [[0, 2], [1, 3], [4]],
        status: 'ok'
      },
      {
        accepted: false,
        verdict: 'REJECT',
        initialClosure: [0],
        afterEachSymbol: [[]],
        trace: [[0], []],
        status: 'dead',
        position: 0
      }
    ];

    const onStepSelect = vi.fn();
    renderTraceCards(container, results, ['ba', 'c'], { onStepSelect });

    const mockC = container as unknown as MockElement;
    const cards = mockC.querySelectorAll('.trace-line');
    expect(cards.length).toBe(2);

    // Initial step in card 1
    const stepsCard1 = cards[0].querySelectorAll('.trace-step');
    expect(stepsCard1.length).toBe(3); // Initial, After 'b', After 'a'
    expect(stepsCard1[0].getAttribute('data-step')).toBe('0');
    expect(stepsCard1[0].getAttribute('data-states')).toBe('0,2');

    // Trigger click on Initial step
    stepsCard1[0].listeners['click']?.[0]({} as any);
    expect(onStepSelect).toHaveBeenCalledWith([0, 2], false);

    // Dead status in card 2
    const deadRows = cards[1].querySelectorAll('.trace-status');
    expect(deadRows.length).toBe(1);
    expect(deadRows[0].textContent).toContain('Dead at position 0');
  });
});
