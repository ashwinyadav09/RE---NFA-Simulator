import { describe, it, expect } from 'vitest';
import { isPostfixStar, typesetRegex, updateRegexMirror } from '../src/ui/typeset-regex.js';

class MockNode {
  nodeType: number;
  protected _text: string;
  constructor(nodeType: number, text = '') {
    this.nodeType = nodeType;
    this._text = text;
  }

  get textContent(): string {
    return this._text;
  }

  set textContent(v: string) {
    this._text = v;
  }
}

class MockElement extends MockNode {
  tagName: string;
  private _className = '';
  classes = new Set<string>();
  children: MockElement[] = [];
  childNodes: (MockElement | MockNode)[] = [];
  attributes: Record<string, string> = {};
  scrollLeft = 0;
  value = '';

  constructor(tagName = 'div') {
    super(1, '');
    this.tagName = tagName;
  }

  get className(): string {
    return this._className;
  }

  set className(val: string) {
    this._className = val;
    this.classes = new Set(val.split(/\s+/).filter(Boolean));
  }

  get classList() {
    return {
      add: (...cls: string[]) => {
        cls.forEach((c) => this.classes.add(c));
        this._className = Array.from(this.classes).join(' ');
      },
      remove: (...cls: string[]) => {
        cls.forEach((c) => this.classes.delete(c));
        this._className = Array.from(this.classes).join(' ');
      },
      contains: (c: string) => this.classes.has(c),
    };
  }

  override get textContent(): string {
    return this.childNodes.map((n) => n.textContent).join('');
  }

  override set textContent(val: string) {
    this.childNodes = val ? [new MockNode(3, val)] : [];
    this.children = [];
  }

  appendChild(child: any): void {
    this.childNodes.push(child);
    if (child instanceof MockElement) {
      this.children.push(child);
    }
  }

  replaceChildren(...nodes: any[]): void {
    this.childNodes = [];
    this.children = [];
    for (const n of nodes) {
      this.appendChild(n);
    }
  }

  querySelector(selector: string): MockElement | null {
    if (selector.startsWith('.')) {
      const cls = selector.slice(1);
      const search = (el: MockElement): MockElement | null => {
        if (el.classList.contains(cls)) return el;
        for (const c of el.children) {
          const res = search(c);
          if (res) return res;
        }
        return null;
      };
      return search(this);
    }
    const tag = selector.toLowerCase();
    const searchTag = (el: MockElement): MockElement | null => {
      if (el.tagName.toLowerCase() === tag) return el;
      for (const c of el.children) {
        const res = searchTag(c);
        if (res) return res;
      }
      return null;
    };
    return searchTag(this);
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    if (selector.startsWith('.')) {
      const cls = selector.slice(1);
      const search = (el: MockElement) => {
        for (const c of el.children) {
          if (c.classList.contains(cls)) results.push(c);
          search(c);
        }
      };
      search(this);
    }
    return results;
  }
}

const mockDoc = {
  createElement: (tag: string) => new MockElement(tag),
  createTextNode: (text: string) => new MockNode(3, text),
};

(globalThis as any).document = mockDoc;

describe('typeset-regex', () => {
  it('[T37-1] isPostfixStar correctly identifies postfix Kleene stars', () => {
    // Postfix stars
    expect(isPostfixStar('a*', 1)).toBe(true);
    expect(isPostfixStar('(a|b)*', 5)).toBe(true);
    expect(isPostfixStar('a**', 1)).toBe(true);
    expect(isPostfixStar('a**', 2)).toBe(true);
    expect(isPostfixStar('a+*', 2)).toBe(true);
    expect(isPostfixStar('a?*', 2)).toBe(true);
    expect(isPostfixStar('a *', 2)).toBe(true);

    // Non-postfix stars
    expect(isPostfixStar('*', 0)).toBe(false);
    expect(isPostfixStar('*a', 0)).toBe(false);
    expect(isPostfixStar('(*)', 1)).toBe(false);
    expect(isPostfixStar('( * )', 2)).toBe(false);
    expect(isPostfixStar('a|*', 2)).toBe(false);
    expect(isPostfixStar('a| *', 3)).toBe(false);
  });

  it('[T37-2] typesetRegex wraps postfix stars in .raised-star spans with text nodes', () => {
    const el = typesetRegex('(a|b)*abb');
    expect(el.textContent).toBe('(a|b)*abb');

    const starSpans = el.querySelectorAll('.raised-star');
    expect(starSpans.length).toBe(1);
    expect(starSpans[0].textContent).toBe('*');
  });

  it('[T37-3] typesetRegex is strictly XSS-safe (creates plain text nodes, zero HTML injection)', () => {
    const xss = '<img src=x onerror=alert(1)>*';
    const el = typesetRegex(xss);
    expect(el.querySelector('img')).toBe(null);
    expect(el.textContent).toBe('<img src=x onerror=alert(1)>*');

    const starSpans = el.querySelectorAll('.raised-star');
    expect(starSpans.length).toBe(1);
  });

  it('[T37-4] updateRegexMirror synchronizes text content and horizontal scroll', () => {
    const input = new MockElement('input');
    const mirror = new MockElement('div');

    input.value = '(a|b)*a';
    input.scrollLeft = 42;

    updateRegexMirror(input as any, mirror as any);

    expect(mirror.textContent).toBe('(a|b)*a');
    expect(mirror.scrollLeft).toBe(42);
    expect(mirror.querySelectorAll('.raised-star').length).toBe(1);

    // Empty input clears mirror
    input.value = '';
    updateRegexMirror(input as any, mirror as any);
    expect(mirror.textContent).toBe('');
  });
});
