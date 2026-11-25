import { describe, it, expect, beforeEach } from 'vitest';
import { FullscreenManager, type FullscreenElements, type FullscreenCallbacks } from '../src/ui/fullscreen.js';

class MockNode {
  nodeType = 1;
  parentNode: MockNode | null = null;
  children: MockNode[] = [];
  protected _text = '';

  constructor(text = '') {
    this._text = text;
  }

  get textContent(): string {
    if (this.children.length === 0) return this._text;
    return this.children.map((c) => c.textContent).join('');
  }

  set textContent(val: string) {
    this._text = val;
    this.children = [];
  }

  insertBefore(newChild: MockNode, refChild: MockNode | null): void {
    if (newChild.parentNode) {
      newChild.parentNode.removeChild(newChild);
    }
    newChild.parentNode = this;
    if (!refChild) {
      this.children.push(newChild);
      return;
    }
    const idx = this.children.indexOf(refChild);
    if (idx === -1) {
      this.children.push(newChild);
    } else {
      this.children.splice(idx, 0, newChild);
    }
  }

  appendChild(child: MockNode): void {
    this.insertBefore(child, null);
  }

  removeChild(child: MockNode): void {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentNode = null;
    }
  }
}

class MockElement extends MockNode {
  tagName: string;
  id = '';
  hidden = false;
  attributes: Record<string, string> = {};
  classes = new Set<string>();
  listeners: Record<string, ((e?: any) => void)[]> = {};
  focused = false;

  constructor(tagName = 'div') {
    super('');
    this.tagName = tagName;
  }

  replaceChildren(...nodes: MockNode[]): void {
    while (this.children.length > 0) {
      this.removeChild(this.children[0]);
    }
    for (const n of nodes) {
      this.appendChild(n);
    }
  }

  get classList() {
    return {
      add: (...cls: string[]) => cls.forEach((c) => this.classes.add(c)),
      remove: (...cls: string[]) => cls.forEach((c) => this.classes.delete(c)),
      contains: (c: string) => this.classes.has(c),
    };
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

  hasAttribute(k: string): boolean {
    return k in this.attributes;
  }

  addEventListener(event: string, fn: (e?: any) => void): void {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }

  dispatchEvent(event: { type: string }): void {
    const handlers = this.listeners[event.type] || [];
    for (const h of handlers) h(event);
  }

  click(): void {
    this.dispatchEvent({ type: 'click' });
  }

  focus(): void {
    this.focused = true;
  }

  get ownerDocument(): any {
    return mockDoc;
  }
}

class MockComment extends MockNode {
  data: string;
  constructor(data: string) {
    super();
    this.nodeType = 8;
    this.data = data;
  }
}

const mockDoc = {
  body: new MockElement('body'),
  createElement: (tag: string) => new MockElement(tag),
  createTextNode: (text: string) => new MockNode(text),
  createComment: (data: string) => new MockComment(data),
};

(globalThis as any).document = mockDoc;

describe('FullscreenManager', () => {
  let appEl: MockElement;
  let canvasContainerEl: MockElement;
  let stepperControlsEl: MockElement;
  let tablePanelEl: MockElement;
  let overlayEl: MockElement;
  let fullscreenBtn: MockElement;
  let exitBtn: MockElement;
  let tableToggleBtn: MockElement;
  let tableCloseBtn: MockElement;
  let tableDrawerEl: MockElement;
  let canvasSlot: MockElement;
  let stepperSlot: MockElement;
  let tableSlot: MockElement;
  let regexDisplayEl: MockElement;
  let elements: FullscreenElements;
  let callbacks: FullscreenCallbacks;
  let manager: FullscreenManager;
  let isFit = true;
  let fitRecomputedCount = 0;

  beforeEach(() => {
    appEl = new MockElement('div');
    appEl.id = 'app';
    mockDoc.body.appendChild(appEl);

    stepperControlsEl = new MockElement('div');
    stepperControlsEl.id = 'stepper-controls';
    appEl.appendChild(stepperControlsEl);

    canvasContainerEl = new MockElement('div');
    canvasContainerEl.id = 'canvas-container';
    appEl.appendChild(canvasContainerEl);

    tablePanelEl = new MockElement('div');
    tablePanelEl.id = 'table-panel';
    appEl.appendChild(tablePanelEl);

    overlayEl = new MockElement('div');
    overlayEl.id = 'fullscreen-overlay';
    overlayEl.hidden = true;
    mockDoc.body.appendChild(overlayEl);

    fullscreenBtn = new MockElement('button');
    fullscreenBtn.id = 'fullscreen-btn';
    canvasContainerEl.appendChild(fullscreenBtn);

    exitBtn = new MockElement('button');
    exitBtn.id = 'exit-fullscreen-btn';

    tableToggleBtn = new MockElement('button');
    tableToggleBtn.id = 'fullscreen-table-btn';

    tableCloseBtn = new MockElement('button');
    tableCloseBtn.id = 'fullscreen-table-close-btn';

    tableDrawerEl = new MockElement('div');
    tableDrawerEl.id = 'fullscreen-table-drawer';

    canvasSlot = new MockElement('div');
    stepperSlot = new MockElement('div');
    tableSlot = new MockElement('div');
    regexDisplayEl = new MockElement('div');

    isFit = true;
    fitRecomputedCount = 0;

    elements = {
      overlayEl: overlayEl as any,
      appEl: appEl as any,
      canvasContainerEl: canvasContainerEl as any,
      stepperControlsEl: stepperControlsEl as any,
      tablePanelEl: tablePanelEl as any,
      fullscreenBtn: fullscreenBtn as any,
      exitBtn: exitBtn as any,
      tableToggleBtn: tableToggleBtn as any,
      tableCloseBtn: tableCloseBtn as any,
      tableDrawerEl: tableDrawerEl as any,
      canvasSlot: canvasSlot as any,
      stepperSlot: stepperSlot as any,
      tableSlot: tableSlot as any,
      regexDisplayEl: regexDisplayEl as any,
    };

    callbacks = {
      getRegexText: () => '(a|b)*a',
      isModeFit: () => isFit,
      recomputeFit: () => {
        fitRecomputedCount++;
      },
    };

    manager = new FullscreenManager(elements, callbacks);
  });

  it('[T36-1] entering fullscreen sets app inert, moves elements to slots, focuses exitBtn, and recomputes fit', () => {
    expect(manager.isActive()).toBe(false);
    expect(overlayEl.hidden).toBe(true);
    expect(appEl.hasAttribute('inert')).toBe(false);

    manager.enter();

    expect(manager.isActive()).toBe(true);
    expect(overlayEl.hidden).toBe(false);
    expect(appEl.hasAttribute('inert')).toBe(true);
    expect(mockDoc.body.classList.contains('fullscreen-mode')).toBe(true);
    expect(regexDisplayEl.textContent).toBe('(a|b)*a');

    // Reparented to slots
    expect(canvasContainerEl.parentNode).toBe(canvasSlot);
    expect(stepperControlsEl.parentNode).toBe(stepperSlot);
    expect(tablePanelEl.parentNode).toBe(tableSlot);

    // Focus moved to exitBtn
    expect(exitBtn.focused).toBe(true);

    // Recomputed fit
    expect(fitRecomputedCount).toBe(1);
  });

  it('[T36-2] exiting fullscreen restores app inert, restores elements to original DOM locations, focuses fullscreenBtn, and recomputes fit', () => {
    manager.enter();
    exitBtn.focused = false;
    fullscreenBtn.focused = false;

    manager.exit();

    expect(manager.isActive()).toBe(false);
    expect(overlayEl.hidden).toBe(true);
    expect(appEl.hasAttribute('inert')).toBe(false);
    expect(mockDoc.body.classList.contains('fullscreen-mode')).toBe(false);

    // Restored to appEl in original order
    expect(canvasContainerEl.parentNode).toBe(appEl);
    expect(stepperControlsEl.parentNode).toBe(appEl);
    expect(tablePanelEl.parentNode).toBe(appEl);

    // Order preserved
    expect(appEl.children).toEqual([stepperControlsEl, canvasContainerEl, tablePanelEl]);

    // Focus restored to fullscreenBtn
    expect(fullscreenBtn.focused).toBe(true);

    // Recomputed fit again
    expect(fitRecomputedCount).toBe(2);
  });

  it('[T36-3] handleEscape exits fullscreen when active and does nothing when inactive', () => {
    expect(manager.handleEscape()).toBe(false);

    manager.enter();
    expect(manager.isActive()).toBe(true);

    const handled = manager.handleEscape();
    expect(handled).toBe(true);
    expect(manager.isActive()).toBe(false);
    expect(fullscreenBtn.focused).toBe(true);
  });

  it('[T36-4] table drawer toggle opens/closes drawer and updates aria-expanded, remembering state across enters', () => {
    manager.enter();
    // Default collapsed
    expect(tableDrawerEl.classList.contains('hidden')).toBe(true);
    expect(tableToggleBtn.getAttribute('aria-expanded')).toBe('false');

    // Toggle open
    manager.toggleTableDrawer();
    expect(tableDrawerEl.classList.contains('hidden')).toBe(false);
    expect(tableToggleBtn.getAttribute('aria-expanded')).toBe('true');

    // Exit and re-enter
    manager.exit();
    manager.enter();

    // Still open because remembered for session
    expect(tableDrawerEl.classList.contains('hidden')).toBe(false);
    expect(tableToggleBtn.getAttribute('aria-expanded')).toBe('true');

    // Close via close button
    tableCloseBtn.click();
    expect(tableDrawerEl.classList.contains('hidden')).toBe(true);
    expect(tableToggleBtn.getAttribute('aria-expanded')).toBe('false');
  });

  it('[T36-5] recomputeFit is not called if isModeFit returns false', () => {
    isFit = false;
    manager.enter();
    expect(fitRecomputedCount).toBe(0);
    manager.exit();
    expect(fitRecomputedCount).toBe(0);
  });
});
