import { describe, it, expect, beforeEach } from 'vitest';
import {
  LEGEND_ITEMS,
  getLegendItems,
  isLegendOpen,
  openLegend,
  closeLegend,
  toggleLegend,
  formatPresetDescription,
  renderLegendItems,
  initLegend,
} from '../src/ui/overlays.js';
import type { Preset } from '../src/engine/index.js';

class MockElement {
  tagName: string;
  private _classList = new Set<string>();
  attributes: Record<string, string> = {};
  listeners: Record<string, ((e: any) => void)[]> = {};
  innerHTML = '';

  get classList() {
    return {
      add: (...cls: string[]) => cls.forEach((c) => this._classList.add(c)),
      remove: (...cls: string[]) => cls.forEach((c) => this._classList.delete(c)),
      contains: (c: string) => this._classList.has(c),
    };
  }

  get children(): any[] {
    const matches = this.innerHTML.match(/<div class="legend-item"/g);
    return matches ? new Array(matches.length) : [];
  }

  constructor(tagName = 'div') {
    this.tagName = tagName;
  }

  setAttribute(k: string, v: string): void {
    this.attributes[k] = v;
  }

  getAttribute(k: string): string | null {
    return this.attributes[k] ?? null;
  }

  querySelector(_sel: string): MockElement | null {
    return null;
  }

  addEventListener(type: string, fn: (e: any) => void): void {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(fn);
  }

  removeEventListener(type: string, fn: (e: any) => void): void {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter((l) => l !== fn);
  }

  dispatchEvent(e: any): void {
    const list = this.listeners[e.type] || [];
    for (const fn of list) {
      fn(e);
    }
  }

  click(): void {
    let stopped = false;
    const ev = {
      type: 'click',
      target: this,
      stopPropagation: () => {
        stopped = true;
      },
    };
    this.dispatchEvent(ev);
    if (!stopped && (globalThis as any).document?.dispatchEvent) {
      (globalThis as any).document.dispatchEvent(ev);
    }
  }

  focus(): void {}

  contains(other: any): boolean {
    return this === other;
  }
}

const mockDoc = new MockElement('document');
if (typeof (globalThis as any).document === 'undefined') {
  (globalThis as any).document = mockDoc;
}

describe('overlays module', () => {
  let legendEl: MockElement;
  let legendBtn: MockElement;
  let closeBtn: MockElement;

  beforeEach(() => {
    legendEl = new MockElement('div');
    legendEl.classList.add('hidden');
    legendBtn = new MockElement('button');
    legendBtn.setAttribute('aria-expanded', 'false');
    closeBtn = new MockElement('button');
  });

  it('provides all 6 canonical legend vocabulary items', () => {
    const items = getLegendItems();
    expect(items).toHaveLength(6);
    expect(items.map((i) => i.id)).toEqual([
      'start-state',
      'accept-state',
      'symbol-transition',
      'eps-transition',
      'new-step',
      'active-sim',
    ]);
    expect(items[0].title).toBe('Start State');
    expect(items[1].title).toBe('Accept State');
    expect(items[4].title).toBe('New at this step');
    expect(items[5].title).toBe('Active in simulation');
  });

  it('renders legend items into container HTML', () => {
    const container = new MockElement('div') as unknown as HTMLElement;
    renderLegendItems(container);
    expect((container as unknown as MockElement).innerHTML).toContain('Start State');
    expect((container as unknown as MockElement).innerHTML).toContain('Accept State');
    expect((container as unknown as MockElement).innerHTML).toContain('Active in simulation');
    expect((container as unknown as MockElement).children).toHaveLength(6);
  });

  it('handles openLegend and closeLegend state transitions', () => {
    const lEl = legendEl as unknown as HTMLElement;
    const bEl = legendBtn as unknown as HTMLElement;

    expect(isLegendOpen(lEl)).toBe(false);

    openLegend(lEl, bEl);
    expect(isLegendOpen(lEl)).toBe(true);
    expect(lEl.classList.contains('hidden')).toBe(false);
    expect(bEl.getAttribute('aria-expanded')).toBe('true');

    closeLegend(lEl, bEl);
    expect(isLegendOpen(lEl)).toBe(false);
    expect(lEl.classList.contains('hidden')).toBe(true);
    expect(bEl.getAttribute('aria-expanded')).toBe('false');
  });

  it('handles toggleLegend cycling correctly', () => {
    const lEl = legendEl as unknown as HTMLElement;
    const bEl = legendBtn as unknown as HTMLElement;

    const state1 = toggleLegend(lEl, bEl);
    expect(state1).toBe(true);
    expect(isLegendOpen(lEl)).toBe(true);

    const state2 = toggleLegend(lEl, bEl);
    expect(state2).toBe(false);
    expect(isLegendOpen(lEl)).toBe(false);
  });

  it('formats preset description correctly', () => {
    const samplePresets: readonly Preset[] = [
      {
        id: 'sample-1',
        name: 'Sample 1',
        regex: 'a',
        notation: 'standard',
        description: 'First sample description',
      },
      {
        id: 'sample-2',
        name: 'Sample 2',
        regex: 'b',
        notation: 'standard',
      },
    ];

    expect(formatPresetDescription('sample-1', samplePresets)).toBe('First sample description');
    expect(formatPresetDescription('sample-2', samplePresets)).toBe('');
    expect(formatPresetDescription('non-existent', samplePresets)).toBe('');
  });

  it('wires up click, close, and outside-click events via initLegend', () => {
    const cleanup = initLegend(
      legendBtn as unknown as HTMLElement,
      legendEl as unknown as HTMLElement,
      closeBtn as unknown as HTMLElement
    );

    // Click toggle button opens
    legendBtn.click();
    expect(isLegendOpen(legendEl as unknown as HTMLElement)).toBe(true);

    // Click close button closes
    closeBtn.click();
    expect(isLegendOpen(legendEl as unknown as HTMLElement)).toBe(false);

    // Click toggle button opens again
    legendBtn.click();
    expect(isLegendOpen(legendEl as unknown as HTMLElement)).toBe(true);

    // Click outside closes
    const outsideEl = new MockElement('div');
    outsideEl.click();
    expect(isLegendOpen(legendEl as unknown as HTMLElement)).toBe(false);

    cleanup?.();
  });
});
