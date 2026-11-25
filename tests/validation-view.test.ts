import { describe, it, expect } from 'vitest';
import {
  formatSuiteSummary,
  extractCodeBadge,
  renderInvariantRow,
  updateSummaryStrip,
  renderDifferentialResults,
  escapeHtml
} from '../src/ui/validation-view.js';
import type { CheckResult } from '../src/engine/index.js';

// Mock Element for Node environment testing
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
  private _innerHTML = '';
  get innerHTML(): string {
    return this._innerHTML;
  }
  set innerHTML(val: string) {
    this._innerHTML = val;
    this.children = [];
    // Basic parser for mock DOM child elements
    const tagMatches = [...val.matchAll(/<([a-zA-Z0-9]+)([^>]*)>/g)];
    for (const tm of tagMatches) {
      const child = new MockElement(tm[1]);
      const idMatch = tm[2].match(/id="([^"]+)"/);
      if (idMatch) child.setAttribute('id', idMatch[1]);
      this.children.push(child);
    }
    this.textContent = val.replace(/<[^>]*>/g, '');
  }
  children: MockElement[] = [];
  attributes: Record<string, string> = {};
  classList = {
    classes: new Set<string>(),
    add: (...cls: string[]) => cls.forEach((c) => this.classList.classes.add(c)),
    remove: (...cls: string[]) => cls.forEach((c) => this.classList.classes.delete(c)),
    contains: (c: string) => this.classList.classes.has(c)
  };

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
      this.textContent += child.textContent;
    } else if (child && typeof child === 'object' && child.nodeType === 3) {
      this.textContent += child.textContent;
    }
  }

  querySelector(selector: string): MockElement | null {
    const idMatch = selector.startsWith('#') ? selector.slice(1) : null;
    const match = (el: MockElement): MockElement | null => {
      if (idMatch && el.attributes['id'] === idMatch) return el;
      if (!idMatch && el.tagName.toLowerCase() === selector.toLowerCase()) return el;
      for (const c of el.children) {
        const found = match(c);
        if (found) return found;
      }
      return null;
    };
    return match(this);
  }
}

const mockDoc = {
  createElement: (tag: string) => new MockElement(tag),
  createTextNode: (text: string) => ({ nodeType: 3, textContent: text })
};

if (typeof (globalThis as any).document === 'undefined') {
  (globalThis as any).document = mockDoc;
}

describe('validation-view (src/ui/validation-view.ts)', () => {
  it('formatSuiteSummary formats pass/fail counts correctly', () => {
    expect(formatSuiteSummary([])).toBe('Not run');
    expect(formatSuiteSummary([{ verdict: 'PASS' }, { verdict: 'PASS' }])).toBe('2 / 2 pass');
    expect(formatSuiteSummary([{ verdict: 'PASS' }, { verdict: 'FAIL' }])).toBe('1 / 2 pass · 1 fail');
  });

  it('extractCodeBadge extracts badge code and name', () => {
    expect(extractCodeBadge('I1 (Distinct Start & Accept)')).toEqual({
      code: 'I1',
      name: 'Distinct Start & Accept'
    });
    expect(extractCodeBadge('Size Formula')).toEqual({
      code: 'Size',
      name: 'Size Formula'
    });
    expect(extractCodeBadge('Step-log Replay')).toEqual({
      code: 'Replay',
      name: 'Step-log Replay'
    });
  });

  it('renderInvariantRow sets attributes and preserves PASS/FAIL prefix in textContent', () => {
    const el = new MockElement('div') as unknown as HTMLElement;
    const check: CheckResult = {
      pass: true,
      explanation: 'Passed: start state (6) and accept state (9) are distinct and valid'
    };

    renderInvariantRow(el, 'I1 (Distinct Start & Accept)', check);
    const mockEl = el as unknown as MockElement;

    expect(mockEl.getAttribute('data-pass')).toBe('true');
    expect(mockEl.textContent.startsWith('PASS')).toBe(true);
    expect(mockEl.textContent).toContain('Distinct Start & Accept');
    expect(mockEl.textContent).toContain('Passed: start state (6)');
  });

  it('updateSummaryStrip updates strip cards with live stats', () => {
    const container = new MockElement('div');
    const invPill = new MockElement('span');
    invPill.setAttribute('id', 'strip-invariants-pill');
    const invVal = new MockElement('span');
    invVal.setAttribute('id', 'strip-invariants-val');
    container.appendChild(invPill);
    container.appendChild(invVal);

    updateSummaryStrip(container as unknown as HTMLElement, {
      invariantsPass: 6,
      invariantsTotal: 6
    });

    expect(invPill.textContent).toBe('PASS');
    expect(invVal.textContent).toBe('6 / 6 pass');
  });

  it('SEC-01: renderDifferentialResults escapes HTML in mismatches, creating no element for malicious string', () => {
    const container = new MockElement('div');
    const maliciousPayload = '<img src=x onerror=alert(1)>';
    renderDifferentialResults(container as unknown as HTMLElement, {
      oracles: {
        enumerator: { name: 'Enumerator', status: 'pass', testedCount: 511 },
        derivatives: { name: 'Derivatives', status: 'pass', testedCount: 511 },
        regExp: { name: 'RegExp', status: 'pass', testedCount: 511 }
      },
      mismatches: [maliciousPayload]
    });

    // Malicious payload must not be parsed into an img element
    expect(container.querySelector('img')).toBeNull();
    // HTML characters must be escaped in innerHTML
    expect(container.innerHTML).not.toContain('<img src=x');
    expect(container.innerHTML).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('escapeHtml safely converts special characters to entities', () => {
    expect(escapeHtml('<script>alert("xss & \'evil\'")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss &amp; &#39;evil&#39;&quot;)&lt;/script&gt;'
    );
  });
});
