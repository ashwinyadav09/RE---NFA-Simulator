/// <reference types="vite/client" />
import { analyze, runLines, RunResult } from '../engine/index';
import { toDot, VizRenderer } from '../diagram/index';
import InlineWorker from './worker.ts?worker&inline';

const renderer = new VizRenderer();
let currentAnalysis: ReturnType<typeof analyze> | null = null;

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
const postfixEl = document.getElementById('postfix-view');
const tableEl = document.getElementById('transition-table');
const testInputEl = document.getElementById('test-input') as HTMLTextAreaElement | null;
const runButtonEl = document.getElementById('run-button') as HTMLButtonElement | null;
const verdictEl = document.getElementById('verdict');
const traceEl = document.getElementById('trace');

function renderTransitionTable(analysis: ReturnType<typeof analyze>): string {
  const { nfa, transitionTable } = analysis;
  const rows: string[] = [];

  for (const q of nfa.states) {
    const isStart = q === nfa.start ? ' (start)' : '';
    const isAccept = q === nfa.accept ? ' (accept)' : '';
    const stateLabel = `q${q}${isStart}${isAccept}`;
    const transitions = transitionTable[q] || {};
    const labels = Object.keys(transitions);

    if (labels.length === 0) {
      rows.push(`<tr data-state="${q}"><td>${stateLabel}</td><td>-</td><td>-</td></tr>`);
    } else {
      for (const label of labels) {
        const targets = transitions[label].map((dest) => `q${dest}`).join(', ');
        rows.push(`<tr data-state="${q}"><td>${stateLabel}</td><td>${label}</td><td>${targets}</td></tr>`);
      }
    }
  }

  return `
    <table>
      <thead>
        <tr><th>State</th><th>Symbol</th><th>Next State(s)</th></tr>
      </thead>
      <tbody>
        ${rows.join('\n')}
      </tbody>
    </table>
  `;
}

async function handleBuild() {
  if (!inputEl) return;
  const source = inputEl.value;
  if (!source) return;

  const analysis = analyze(source);
  currentAnalysis = analysis;

  if (statsEl) {
    statsEl.textContent = `States: ${analysis.stats.states}, Transitions: ${analysis.stats.transitions}`;
    statsEl.setAttribute('data-states', String(analysis.stats.states));
    statsEl.setAttribute('data-transitions', String(analysis.stats.transitions));
  }

  if (postfixEl) {
    postfixEl.textContent = analysis.postfix
      .map((t) => (t.type === 'SYMBOL' ? t.symbol ?? 'SYMBOL' : t.type))
      .join(' ');
  }

  if (tableEl) {
    tableEl.innerHTML = renderTransitionTable(analysis);
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

function renderTrace(results: RunResult[], lines: string[]): string {
  return results
    .map((res, lineIdx) => {
      const line = lines[lineIdx];
      const codePoints = Array.from(line);
      const steps = [
        `<div class="trace-step" data-step="0">Initial: {${res.initialClosure.join(', ')}}</div>`,
        ...res.afterEachSymbol.map((set, idx) => {
          const char = codePoints[idx] ?? '';
          return `<div class="trace-step" data-step="${idx + 1}" data-states="${set.join(',')}">After '${char}': {${set.join(', ')}}</div>`;
        })
      ];

      if (res.status === 'dead') {
        steps.push(`<div class="trace-status dead">Dead at position ${res.position}</div>`);
      } else if (res.status === 'out_of_alphabet') {
        steps.push(`<div class="trace-status error">Symbol '${res.symbol}' at position ${res.position} outside alphabet</div>`);
      }

      return `<div class="trace-line" data-line="${lineIdx}"><div><strong>String: "${line}"</strong></div>${steps.join('\n')}</div>`;
    })
    .join('\n');
}

function handleRun() {
  if (!currentAnalysis) {
    if (inputEl && inputEl.value) {
      currentAnalysis = analyze(inputEl.value);
    } else {
      return;
    }
  }

  const text = testInputEl ? testInputEl.value : '';
  const lines = text.split(/\r?\n/);
  const results = runLines(currentAnalysis.nfa, currentAnalysis.alphabet, text);

  if (verdictEl) {
    verdictEl.textContent = results.map((r) => r.verdict).join('\n');
  }

  if (traceEl) {
    traceEl.innerHTML = renderTrace(results, lines);
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
