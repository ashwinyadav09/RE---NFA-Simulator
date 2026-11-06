/// <reference types="vite/client" />
import { analyze, runLines, RunResult, AnalysisSuccess, ParseNode, Token } from '../engine/index';
import { toDot, VizRenderer } from '../diagram/index';
import InlineWorker from './worker.ts?worker&inline';

const renderer = new VizRenderer();
let currentAnalysis: AnalysisSuccess | null = null;

// Setup inline worker
try {
  const worker = new InlineWorker();
  worker.onmessage = (e: MessageEvent) => {
    const statusEl = document.getElementById('worker-status');
    if (statusEl) {
      statusEl.textContent = JSON.stringify(e.data);
    }
    (window as any).__workerResult = e.data;
  };
  worker.postMessage({ ping: 'hello' });
} catch (err) {
  console.error('Worker initialization failed', err);
  (window as any).__workerError = err;
}

const inputEl = document.getElementById('regex-input') as HTMLInputElement | null;
const buttonEl = document.getElementById('build-button') as HTMLButtonElement | null;
const statsEl = document.getElementById('stats');
const canvasEl = document.getElementById('canvas');
const tokenListEl = document.getElementById('token-list');
const postfixEl = document.getElementById('postfix-view');
const treeViewEl = document.getElementById('tree-view');
const tableEl = document.getElementById('transition-table');
const testInputEl = document.getElementById('test-input') as HTMLTextAreaElement | null;
const runButtonEl = document.getElementById('run-button') as HTMLButtonElement | null;
const verdictEl = document.getElementById('verdict');
const traceEl = document.getElementById('trace');
const errorEl = document.getElementById('error-message');

function renderTransitionTable(container: HTMLElement, analysis: AnalysisSuccess): void {
  const { nfa, transitionTable } = analysis;
  container.textContent = '';

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const trHead = document.createElement('tr');
  for (const header of ['State', 'Symbol', 'Next State(s)']) {
    const th = document.createElement('th');
    th.textContent = header;
    trHead.appendChild(th);
  }
  thead.appendChild(trHead);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const q of nfa.states) {
    const isStart = q === nfa.start ? ' (start)' : '';
    const isAccept = q === nfa.accept ? ' (accept)' : '';
    const stateLabel = `q${q}${isStart}${isAccept}`;
    const transitions = transitionTable[q] || {};
    const labels = Object.keys(transitions);

    if (labels.length === 0) {
      const tr = document.createElement('tr');
      tr.setAttribute('data-state', String(q));
      for (const val of [stateLabel, '-', '-']) {
        const td = document.createElement('td');
        td.textContent = val;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    } else {
      for (const label of labels) {
        const targets = transitions[label].map((dest) => `q${dest}`).join(', ');
        const tr = document.createElement('tr');
        tr.setAttribute('data-state', String(q));
        for (const val of [stateLabel, label, targets]) {
          const td = document.createElement('td');
          td.textContent = val;
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
    }
  }
  table.appendChild(tbody);
  container.appendChild(table);
}

function renderTokenList(container: HTMLElement, tokens: Token[]): void {
  container.textContent = '';
  const spans: string[] = tokens.map((t) => {
    const label = t.type === 'SYMBOL' ? `SYMBOL(${t.symbol})` : t.type;
    return `[${label}@${t.position}]`;
  });
  container.textContent = spans.join(' ');
}

function renderTreeView(container: HTMLElement, tree: ParseNode): void {
  container.textContent = '';
  function nodeToText(node: ParseNode, depth: number): string {
    const indent = '  '.repeat(depth);
    switch (node.k) {
      case 'sym':   return `${indent}sym(${node.v})`;
      case 'eps':   return `${indent}eps`;
      case 'empty': return `${indent}empty`;
      case 'star':  return `${indent}star\n${nodeToText(node.c, depth + 1)}`;
      case 'plus':  return `${indent}plus\n${nodeToText(node.c, depth + 1)}`;
      case 'opt':   return `${indent}opt\n${nodeToText(node.c, depth + 1)}`;
      case 'union': return `${indent}union\n${nodeToText(node.l, depth + 1)}\n${nodeToText(node.r, depth + 1)}`;
      case 'cat':   return `${indent}cat\n${nodeToText(node.l, depth + 1)}\n${nodeToText(node.r, depth + 1)}`;
    }
  }
  container.textContent = nodeToText(tree, 0);
}


function codePointToUtf16Range(source: string, codePointIndex: number): { start: number; end: number } {
  const codePoints = Array.from(source);
  let start = 0;
  for (let i = 0; i < codePointIndex && i < codePoints.length; i++) {
    start += codePoints[i].length;
  }
  const len = codePointIndex < codePoints.length ? codePoints[codePointIndex].length : 1;
  return { start, end: start + len };
}

async function handleBuild() {
  if (!inputEl) return;
  const source = inputEl.value;

  const analysis = analyze(source);
  if (!analysis.ok) {
    if (errorEl) {
      if (analysis.code === 'EMPTY_INPUT') {
        errorEl.textContent = analysis.hint || analysis.message;
        errorEl.className = 'hint';
        errorEl.removeAttribute('data-error-code');
        errorEl.removeAttribute('data-error-position');
      } else {
        errorEl.textContent = `${analysis.message} at position ${analysis.position}`;
        errorEl.setAttribute('data-error-code', analysis.code);
        if (analysis.position !== undefined) {
          errorEl.setAttribute('data-error-position', String(analysis.position));
        }
        errorEl.className = 'error';
      }
    }
    if (analysis.code === 'EMPTY_INPUT') {
      inputEl.removeAttribute('data-error-position');
    } else if (analysis.position !== undefined) {
      inputEl.setAttribute('data-error-position', String(analysis.position));
      inputEl.focus();
      const { start, end } = codePointToUtf16Range(source, analysis.position);
      inputEl.setSelectionRange(start, end);
    }
    (window as any).__buildDone = true;
    return;
  }

  if (errorEl) {
    errorEl.textContent = '';
    errorEl.className = '';
    errorEl.removeAttribute('data-error-code');
    errorEl.removeAttribute('data-error-position');
  }
  inputEl.removeAttribute('data-error-position');

  currentAnalysis = analysis;

  if (statsEl) {
    statsEl.textContent = `States: ${analysis.stats.states}, Transitions: ${analysis.stats.transitions}`;
    statsEl.setAttribute('data-states', String(analysis.stats.states));
    statsEl.setAttribute('data-transitions', String(analysis.stats.transitions));
  }

  if (tokenListEl) {
    renderTokenList(tokenListEl, analysis.tokens);
  }

  if (postfixEl) {
    postfixEl.textContent = analysis.postfix
      .map((t) => (t.type === 'SYMBOL' ? t.symbol ?? 'SYMBOL' : t.type))
      .join(' ');
  }

  if (treeViewEl) {
    renderTreeView(treeViewEl, analysis.parseTree);
  }

  if (tableEl) {
    renderTransitionTable(tableEl, analysis);
  }

  const dot = toDot(analysis.nfa);
  const result = await renderer.render(dot);

  if (canvasEl) {
    if (result.ok) {
      canvasEl.innerHTML = result.svg;
    } else {
      canvasEl.textContent = `Error rendering diagram: ${result.error}`;
    }
  }

  (window as any).__buildDone = true;
}

function renderTrace(container: HTMLElement, results: RunResult[], lines: string[]): void {
  container.textContent = '';
  for (let lineIdx = 0; lineIdx < results.length; lineIdx++) {
    const res = results[lineIdx];
    const line = lines[lineIdx];
    const codePoints = Array.from(line);

    const lineEl = document.createElement('div');
    lineEl.className = 'trace-line';
    lineEl.setAttribute('data-line', String(lineIdx));

    const stringDiv = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = `String: "${line}"`;
    stringDiv.appendChild(strong);
    lineEl.appendChild(stringDiv);

    const initialDiv = document.createElement('div');
    initialDiv.className = 'trace-step';
    initialDiv.setAttribute('data-step', '0');
    initialDiv.textContent = `Initial: {${res.initialClosure.join(', ')}}`;
    lineEl.appendChild(initialDiv);

    for (let idx = 0; idx < res.afterEachSymbol.length; idx++) {
      const set = res.afterEachSymbol[idx];
      const char = codePoints[idx] ?? '';
      const stepDiv = document.createElement('div');
      stepDiv.className = 'trace-step';
      stepDiv.setAttribute('data-step', String(idx + 1));
      stepDiv.setAttribute('data-states', set.join(','));
      stepDiv.textContent = `After '${char}': {${set.join(', ')}}`;
      lineEl.appendChild(stepDiv);
    }

    if (res.status === 'dead') {
      const deadDiv = document.createElement('div');
      deadDiv.className = 'trace-status dead';
      deadDiv.textContent = `Dead at position ${res.position}`;
      lineEl.appendChild(deadDiv);
    } else if (res.status === 'out_of_alphabet') {
      const errDiv = document.createElement('div');
      errDiv.className = 'trace-status error';
      errDiv.textContent = `Symbol '${res.symbol}' at position ${res.position} outside alphabet`;
      lineEl.appendChild(errDiv);
    }

    container.appendChild(lineEl);
  }
}

function handleRun() {
  if (!currentAnalysis) {
    if (inputEl && inputEl.value) {
      const res = analyze(inputEl.value);
      if (res.ok) {
        currentAnalysis = res;
      } else {
        return;
      }
    } else {
      return;
    }
  }

  const text = testInputEl ? testInputEl.value : '';
  const lines = text.split(/\r\n|\r|\n/);
  const results = runLines(currentAnalysis.nfa, currentAnalysis.alphabet, text);

  if (verdictEl) {
    verdictEl.textContent = results.map((r) => r.verdict).join('\n');
  }

  if (traceEl) {
    renderTrace(traceEl, results, lines);
  }

  (window as any).__runDone = true;
}

if (buttonEl) {
  buttonEl.addEventListener('click', handleBuild);
}

if (runButtonEl) {
  runButtonEl.addEventListener('click', handleRun);
}


if (inputEl) {
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      handleBuild();
    }
  });
}

(window as any).__ready = true;
