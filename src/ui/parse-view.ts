import type { ParseNode, Token } from '../engine/index.js';
import { typesetRegex } from './typeset-regex.js';

/**
 * Format a ParseNode AST into indented text representation for accessibility
 * and legacy text assertions.
 */
export function nodeToText(node: ParseNode, depth: number = 0): string {
  const indent = '  '.repeat(depth);
  switch (node.k) {
    case 'sym':
      return `${indent}sym(${node.v})`;
    case 'eps':
      return `${indent}eps`;
    case 'empty':
      return `${indent}empty`;
    case 'star':
      return `${indent}star\n${nodeToText(node.c, depth + 1)}`;
    case 'plus':
      return `${indent}plus\n${nodeToText(node.c, depth + 1)}`;
    case 'opt':
      return `${indent}opt\n${nodeToText(node.c, depth + 1)}`;
    case 'union':
      return `${indent}union\n${nodeToText(node.l, depth + 1)}\n${nodeToText(node.r, depth + 1)}`;
    case 'cat':
      return `${indent}cat\n${nodeToText(node.l, depth + 1)}\n${nodeToText(node.r, depth + 1)}`;
  }
}

/**
 * Render hierarchical visual tree and screen-reader raw text inside container.
 */
export function renderParseTree(
  container: HTMLElement,
  tree: ParseNode,
  onNodeClick?: (kind: string) => void,
  rootRegex?: string
): void {
  container.textContent = '';

  // 1. Screen-reader accessible indented text for tests & screen readers
  const srOnly = document.createElement('div');
  srOnly.className = 'sr-only';
  srOnly.textContent = nodeToText(tree, 0);
  container.appendChild(srOnly);

  // 2. Visual tree with styled operator and leaf chips and connecting lines
  const visualTree = document.createElement('div');
  visualTree.className = 'visual-tree';
  visualTree.setAttribute('role', 'tree');
  visualTree.setAttribute('aria-label', 'Parse tree');

  if (rootRegex) {
    const rootPill = document.createElement('div');
    rootPill.className = 'parse-tree-root-expr';
    rootPill.appendChild(typesetRegex(rootRegex));
    visualTree.appendChild(rootPill);
  }

  function createVisualNode(node: ParseNode, depth: number = 0): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'tree-node-wrapper';
    wrapper.setAttribute('role', 'treeitem');
    if (depth === 0) {
      wrapper.setAttribute('data-parse-tree-root', 'true');
    }

    const chip = document.createElement('div');
    const isLeaf = node.k === 'sym' || node.k === 'eps' || node.k === 'empty';
    chip.className = `tree-chip ${isLeaf ? 'leaf-chip' : 'operator-chip'}`;
    chip.setAttribute('data-kind', node.k);

    let label: string = node.k;
    if (node.k === 'sym') label = `sym(${node.v})`;
    if (label.includes('*')) {
      chip.appendChild(typesetRegex(label));
    } else {
      chip.textContent = label;
    }

    if (onNodeClick) {
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        onNodeClick(node.k);
      });
    }

    wrapper.appendChild(chip);

    // Subtree collapse cap at depth 6 per docs/design.md §6.10
    if (depth >= 6) {
      const moreChip = document.createElement('div');
      moreChip.className = 'tree-chip leaf-chip';
      moreChip.textContent = '…';
      wrapper.appendChild(moreChip);
      return wrapper;
    }

    const children: ParseNode[] = [];
    if (node.k === 'star' || node.k === 'plus' || node.k === 'opt') {
      children.push(node.c);
    } else if (node.k === 'union' || node.k === 'cat') {
      children.push(node.l, node.r);
    }

    if (children.length > 0) {
      const childrenContainer = document.createElement('div');
      childrenContainer.className = 'tree-children';
      childrenContainer.setAttribute('role', 'group');
      for (const child of children) {
        childrenContainer.appendChild(createVisualNode(child, depth + 1));
      }
      wrapper.appendChild(childrenContainer);
    }

    return wrapper;
  }

  visualTree.appendChild(createVisualNode(tree, 0));
  container.appendChild(visualTree);
}

/**
 * Render postfix chips into the timeline container.
 */
export function renderPostfixTimeline(
  container: HTMLElement,
  tokens: Token[],
  currentStep: number,
  onStepSelect?: (step: number) => void
): void {
  container.textContent = '';
  if (!tokens || tokens.length === 0) return;

  tokens.forEach((token, i) => {
    const stepIndex = i + 1;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'postfix-token';
    btn.setAttribute('data-step-index', String(stepIndex));
    btn.setAttribute('data-token-type', token.type);

    const label =
      token.type === 'SYMBOL'
        ? token.symbol ?? 'SYMBOL'
        : token.type === 'EPSILON'
          ? 'ε'
          : token.type === 'EMPTY'
            ? '∅'
            : token.type;
    btn.textContent = label;

    const titleDesc = token.type === 'SYMBOL' ? `symbol '${token.symbol}'` : token.type.toLowerCase();
    btn.title = `Step ${stepIndex} · ${titleDesc}`;
    btn.setAttribute('aria-label', `Step ${stepIndex}: ${titleDesc}`);

    if (currentStep > 0) {
      if (stepIndex < currentStep) {
        btn.classList.add('done');
      } else if (stepIndex === currentStep) {
        btn.classList.add('active');
      } else {
        btn.classList.add('upcoming');
      }
    }

    if (onStepSelect) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        onStepSelect(stepIndex);
      });
    }

    container.appendChild(btn);
    if (i < tokens.length - 1) {
      container.appendChild(document.createTextNode(' '));
    }
  });
}

/**
 * Synchronize active/done/upcoming classes on existing postfix tokens without re-rendering.
 */
export function updatePostfixTimelineActive(container: HTMLElement, currentStep: number): void {
  const tokens = container.querySelectorAll<HTMLElement>('.postfix-token');
  tokens.forEach((tok) => {
    const stepIndex = parseInt(tok.getAttribute('data-step-index') || '0', 10);
    tok.classList.remove('done', 'active', 'upcoming');
    // Clear inline styles from legacy handlers if any
    tok.style.backgroundColor = '';
    tok.style.color = '';

    if (currentStep <= 0) {
      return;
    }

    if (stepIndex < currentStep) {
      tok.classList.add('done');
    } else if (stepIndex === currentStep) {
      tok.classList.add('active');
      if (typeof tok.scrollIntoView === 'function') {
        tok.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
      }
    } else {
      tok.classList.add('upcoming');
    }
  });
}

/**
 * Format raw token diagnostics list.
 */
export function renderRawTokens(container: HTMLElement, tokens: Token[]): void {
  container.textContent = '';
  const spans: string[] = tokens.map((t) => {
    const label = t.type === 'SYMBOL' ? `SYMBOL(${t.symbol})` : t.type;
    return `[${label}@${t.position}]`;
  });
  container.textContent = spans.join(' ');
}

/**
 * Format postfix tokens into readable math text.
 */
export function formatPostfixText(tokens: Token[]): string {
  return tokens
    .map((t) => {
      switch (t.type) {
        case 'SYMBOL':
          return t.symbol ?? '';
        case 'CONCAT':
          return '·';
        case 'UNION':
          return '|';
        case 'STAR':
          return '*';
        case 'PLUS':
          return '+';
        case 'OPT':
          return '?';
        case 'EPSILON':
          return 'ε';
        case 'EMPTY':
          return '∅';
        default:
          return t.type;
      }
    })
    .join(' ');
}
