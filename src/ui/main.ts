/// <reference types="vite/client" />
import { analyze } from '../engine/index';
import { toDot, VizRenderer } from '../diagram/index';
import InlineWorker from './worker.ts?worker&inline';

const renderer = new VizRenderer();

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

if (buttonEl) {
  buttonEl.addEventListener('click', handleBuild);
}

if (inputEl) {
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      handleBuild();
    }
  });
}

(window as any).__ready = true;
