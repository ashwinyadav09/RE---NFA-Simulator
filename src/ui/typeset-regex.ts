/**
 * Identifies if a star at index is a postfix Kleene star.
 * In regular expressions, a star is postfix when preceded by an operand or closing paren/bracket,
 * not at the beginning of an expression or immediately after an open parenthesis or union operator.
 */
export function isPostfixStar(text: string, index: number): boolean {
  if (text[index] !== '*') return false;
  if (index === 0) return false;
  let i = index - 1;
  while (i >= 0 && /\s/.test(text[i])) {
    i--;
  }
  if (i < 0) return false;
  const prev = text[i];
  return prev !== '(' && prev !== '|';
}

/**
 * Typesets a regular expression by wrapping postfix Kleene stars in a `.raised-star` span.
 * Strictly uses DOM text nodes (never innerHTML) to prevent XSS.
 */
export function typesetRegex(text: string): HTMLElement {
  const doc = typeof document !== 'undefined' ? document : (globalThis as any).document;
  if (!doc) {
    const fallbackNode = {
      tagName: 'span',
      className: 'typeset-regex',
      textContent: text,
      childNodes: [],
      children: [],
      appendChild: () => {},
      replaceChildren: () => {},
    } as unknown as HTMLElement;
    return fallbackNode;
  }
  const container = doc.createElement('span');
  container.className = 'typeset-regex';

  let currentChunk = '';
  for (let i = 0; i < text.length; i++) {
    if (isPostfixStar(text, i)) {
      if (currentChunk) {
        container.appendChild(doc.createTextNode(currentChunk));
        currentChunk = '';
      }
      const starSpan = doc.createElement('span');
      starSpan.className = 'raised-star';
      starSpan.appendChild(doc.createTextNode('*'));
      container.appendChild(starSpan);
    } else {
      currentChunk += text[i];
    }
  }
  if (currentChunk) {
    container.appendChild(doc.createTextNode(currentChunk));
  }
  return container;
}

/**
 * Synchronizes the typeset mirror behind an input element.
 * Updates text nodes and scroll offset without innerHTML.
 */
export function updateRegexMirror(inputEl: HTMLInputElement, mirrorEl: HTMLElement): void {
  const doc = typeof document !== 'undefined' ? document : (globalThis as any).document;
  if (typeof mirrorEl.replaceChildren === 'function') {
    mirrorEl.replaceChildren();
  } else {
    mirrorEl.textContent = '';
  }

  const text = inputEl.value;
  if (!text) {
    mirrorEl.scrollLeft = 0;
    return;
  }

  const fragment = typesetRegex(text);
  const childNodes = Array.from(fragment.childNodes || (fragment as any).children || []);
  for (const child of childNodes) {
    mirrorEl.appendChild(child);
  }
  mirrorEl.scrollLeft = inputEl.scrollLeft;
}
