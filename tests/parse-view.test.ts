import { describe, it, expect, vi } from 'vitest';
import type { ParseNode, Token } from '../src/engine/index.js';
import {
  nodeToText,
  formatPostfixText,
  renderParseTree,
  renderPostfixTimeline,
  updatePostfixTimelineActive,
  renderRawTokens
} from '../src/ui/parse-view.js';

// Simple mock element for Node environment unit testing
class MockElement {
  tagName: string;
  className = '';
  textContent = '';
  title = '';
  type = '';
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

  constructor(tagName = 'div') {
    this.tagName = tagName;
  }

  setAttribute(k: string, v: string): void {
    this.attributes[k] = v;
  }

  getAttribute(k: string): string | null {
    return this.attributes[k] ?? null;
  }

  appendChild(child: any): void {
    if (child instanceof MockElement) {
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
      if (selector === '.postfix-token' && el.className.includes('postfix-token')) {
        results.push(el);
      }
      for (const c of el.children) match(c);
    };
    match(this);
    return results;
  }

  scrollIntoView = vi.fn();
}

// Minimal mock document
const mockDoc = {
  createElement: (tag: string) => new MockElement(tag),
  createTextNode: (text: string) => ({ nodeType: 3, textContent: text })
};

// Install global mock document if not present
if (typeof (globalThis as any).document === 'undefined') {
  (globalThis as any).document = mockDoc;
}

describe('parse-view (src/ui/parse-view.ts)', () => {
  it('nodeToText correctly serializes ParseNode trees', () => {
    const leaf: ParseNode = { k: 'sym', v: 'a' };
    expect(nodeToText(leaf)).toBe('sym(a)');

    const eps: ParseNode = { k: 'eps' };
    expect(nodeToText(eps)).toBe('eps');

    const empty: ParseNode = { k: 'empty' };
    expect(nodeToText(empty)).toBe('empty');

    const star: ParseNode = { k: 'star', c: leaf };
    expect(nodeToText(star)).toBe('star\n  sym(a)');

    const plus: ParseNode = { k: 'plus', c: leaf };
    expect(nodeToText(plus)).toBe('plus\n  sym(a)');

    const opt: ParseNode = { k: 'opt', c: leaf };
    expect(nodeToText(opt)).toBe('opt\n  sym(a)');

    const union: ParseNode = {
      k: 'union',
      l: { k: 'sym', v: 'a' },
      r: { k: 'sym', v: 'b' }
    };
    expect(nodeToText(union)).toBe('union\n  sym(a)\n  sym(b)');

    const cat: ParseNode = {
      k: 'cat',
      l: { k: 'star', c: union },
      r: { k: 'sym', v: 'a' }
    };
    expect(nodeToText(cat)).toBe('cat\n  star\n    union\n      sym(a)\n      sym(b)\n  sym(a)');
  });

  it('formatPostfixText formats tokens with readable operators', () => {
    const tokens: Token[] = [
      { type: 'SYMBOL', symbol: 'a', position: 0 },
      { type: 'SYMBOL', symbol: 'b', position: 2 },
      { type: 'UNION', position: 1 },
      { type: 'STAR', position: 4 },
      { type: 'SYMBOL', symbol: 'a', position: 5 },
      { type: 'CONCAT', position: 6 }
    ];
    expect(formatPostfixText(tokens)).toBe('a b | * a ·');
  });

  it('renderParseTree creates sr-only accessibility text and visual tree items', () => {
    const container = new MockElement('div') as unknown as HTMLElement;
    const tree: ParseNode = {
      k: 'cat',
      l: { k: 'star', c: { k: 'sym', v: 'a' } },
      r: { k: 'sym', v: 'b' }
    };

    renderParseTree(container, tree);

    const mockC = container as unknown as MockElement;
    expect(mockC.children.length).toBe(2);
    expect(mockC.children[0].className).toBe('sr-only');
    expect(mockC.children[0].textContent).toContain('cat\n  star\n    sym(a)\n  sym(b)');
    expect(mockC.children[1].className).toBe('visual-tree');
  });

  it('renderPostfixTimeline renders interactive token buttons', () => {
    const container = new MockElement('div') as unknown as HTMLElement;
    const tokens: Token[] = [
      { type: 'SYMBOL', symbol: 'a', position: 0 },
      { type: 'STAR', position: 1 }
    ];

    const onSelect = vi.fn();
    renderPostfixTimeline(container, tokens, 1, onSelect);

    const mockC = container as unknown as MockElement;
    const buttons = mockC.querySelectorAll('.postfix-token');
    expect(buttons.length).toBe(2);
    expect(buttons[0].getAttribute('data-step-index')).toBe('1');
    expect(buttons[0].textContent).toBe('a');
    expect(buttons[0].classList.contains('active')).toBe(true);

    expect(buttons[1].getAttribute('data-step-index')).toBe('2');
    expect(buttons[1].textContent).toBe('STAR');
    expect(buttons[1].classList.contains('upcoming')).toBe(true);
  });

  it('updatePostfixTimelineActive shifts active/done/upcoming classes', () => {
    const container = new MockElement('div') as unknown as HTMLElement;
    const tokens: Token[] = [
      { type: 'SYMBOL', symbol: 'a', position: 0 },
      { type: 'SYMBOL', symbol: 'b', position: 1 },
      { type: 'CONCAT', position: 2 }
    ];

    renderPostfixTimeline(container, tokens, 1);
    const mockC = container as unknown as MockElement;
    const buttons = mockC.querySelectorAll('.postfix-token');

    expect(buttons[0].classList.contains('active')).toBe(true);
    expect(buttons[1].classList.contains('upcoming')).toBe(true);

    // Step forward to 2
    updatePostfixTimelineActive(container, 2);
    expect(buttons[0].classList.contains('done')).toBe(true);
    expect(buttons[1].classList.contains('active')).toBe(true);
    expect(buttons[2].classList.contains('upcoming')).toBe(true);

    // Final view (step <= 0)
    updatePostfixTimelineActive(container, 0);
    expect(buttons[0].classList.contains('active')).toBe(false);
    expect(buttons[1].classList.contains('active')).toBe(false);
  });

  it('renderRawTokens formats debug token list', () => {
    const container = new MockElement('div') as unknown as HTMLElement;
    const tokens: Token[] = [
      { type: 'SYMBOL', symbol: 'a', position: 0 },
      { type: 'UNION', position: 1 }
    ];

    renderRawTokens(container, tokens);
    const mockC = container as unknown as MockElement;
    expect(mockC.textContent).toBe('[SYMBOL(a)@0] [UNION@1]');
  });
});

