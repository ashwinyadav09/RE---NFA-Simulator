/// <reference types="vite/client" />
import {
  analyze,
  runLines,
  RunResult,
  AnalysisSuccess,
  ParseNode,
  Token,
  Step,
  getStepSnapshot,
  validateAlphabet,
  CAPS
} from '../engine/index';
import { toDot, VizRenderer, computeMasterLayout, checkDiagramCap, type DiagramOptions } from '../diagram/index';
import InlineWorker from './worker.ts?worker&inline';

const renderer = new VizRenderer();
let currentAnalysis: AnalysisSuccess | null = null;
let userEditedAlphabet: string[] | null = null;
let buildGeneration = 0;
let stepGeneration = 0;
let currentStepIndex = 1;
let currentView: 'flat' | 'textbook' | 'final' = 'flat';
let currentActiveStates: number[] | null = null;
let isDeadRun = false;
let lastRunResults: RunResult[] | null = null;
let lastRunLines: string[] | null = null;
let playbackTimer: ReturnType<typeof setInterval> | null = null;
let masterPositions: Map<number, [number, number]> | null = null;
let stepSvgCache = new Map<string, string>();
let layoutFailed = false;

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
const notationSelectEl = document.getElementById('notation-select') as HTMLSelectElement | null;
const concatSelectEl = document.getElementById('concat-select') as HTMLSelectElement | null;
const insertEpsBtn = document.getElementById('insert-eps') as HTMLButtonElement | null;
const insertEmptyBtn = document.getElementById('insert-empty') as HTMLButtonElement | null;
const alphabetInputEl = document.getElementById('alphabet-input') as HTMLInputElement | null;
const alphabetMessageEl = document.getElementById('alphabet-message');
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
const layoutNoteEl = document.getElementById('layout-note');
const runStatusEl = document.getElementById('run-status');
const stepFirstBtn = document.getElementById('step-first') as HTMLButtonElement | null;
const stepPrevBtn = document.getElementById('step-prev') as HTMLButtonElement | null;
const stepPlayBtn = document.getElementById('step-play') as HTMLButtonElement | null;
const stepNextBtn = document.getElementById('step-next') as HTMLButtonElement | null;
const stepLastBtn = document.getElementById('step-last') as HTMLButtonElement | null;
const stepCounterEl = document.getElementById('step-counter');
const stepSpeedSelect = document.getElementById('step-speed') as HTMLSelectElement | null;
const viewToggleSelect = document.getElementById('view-toggle') as HTMLSelectElement | null;
const stepLogEl = document.getElementById('step-log');
const compactLabelsEl = document.getElementById('compact-labels') as HTMLInputElement | null;

function isCompactLabels(): boolean {
  return !!compactLabelsEl?.checked;
}

function renderTransitionTable(container: HTMLElement, analysis: AnalysisSuccess): void {
  const compact = isCompactLabels();
  const { nfa, transitionTable, compactLabelMap } = analysis;
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
    const displayId = compact ? compactLabelMap[q] ?? q : q;
    const stateLabel = `q${displayId}${isStart}${isAccept}`;
    const transitions = transitionTable[q] || {};
    const labels = Object.keys(transitions);

    if (labels.length === 0) {
      const tr = document.createElement('tr');
      tr.setAttribute('data-state', String(q));
      tr.setAttribute('data-display-state', String(displayId));
      for (const val of [stateLabel, '-', '-']) {
        const td = document.createElement('td');
        td.textContent = val;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    } else {
      for (const label of labels) {
        const targets = transitions[label]
          .map((dest) => `q${compact ? compactLabelMap[dest] ?? dest : dest}`)
          .join(', ');
        const tr = document.createElement('tr');
        tr.setAttribute('data-state', String(q));
        tr.setAttribute('data-display-state', String(displayId));
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
      case 'sym': return `${indent}sym(${node.v})`;
      case 'eps': return `${indent}eps`;
      case 'empty': return `${indent}empty`;
      case 'star': return `${indent}star\n${nodeToText(node.c, depth + 1)}`;
      case 'plus': return `${indent}plus\n${nodeToText(node.c, depth + 1)}`;
      case 'opt': return `${indent}opt\n${nodeToText(node.c, depth + 1)}`;
      case 'union': return `${indent}union\n${nodeToText(node.l, depth + 1)}\n${nodeToText(node.r, depth + 1)}`;
      case 'cat': return `${indent}cat\n${nodeToText(node.l, depth + 1)}\n${nodeToText(node.r, depth + 1)}`;
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

function parseAlphabetInput(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.includes(',')) {
    return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (/\s/.test(trimmed)) {
    return trimmed.split(/\s+/).filter(Boolean);
  }
  return Array.from(trimmed);
}

function insertAtCursor(char: string): void {
  if (!inputEl) return;
  const start = inputEl.selectionStart ?? inputEl.value.length;
  const end = inputEl.selectionEnd ?? inputEl.value.length;
  const val = inputEl.value;
  inputEl.value = val.substring(0, start) + char + val.substring(end);
  const nextPos = start + char.length;
  inputEl.focus();
  inputEl.setSelectionRange(nextPos, nextPos);
}

function clearResults(): void {
  stopPlayback();
  currentStepIndex = 0;
  currentActiveStates = null;
  isDeadRun = false;
  lastRunResults = null;
  lastRunLines = null;

  if (statsEl) {
    statsEl.textContent = '';
    statsEl.removeAttribute('data-states');
    statsEl.removeAttribute('data-transitions');
  }
  if (canvasEl) {
    canvasEl.innerHTML = '';
    canvasEl.removeAttribute('data-current-step');
    canvasEl.removeAttribute('data-view');
    canvasEl.removeAttribute('data-run-status');
  }
  if (traceEl) {
    traceEl.innerHTML = '';
  }
  if (verdictEl) {
    verdictEl.textContent = '';
  }
  if (tableEl) {
    tableEl.innerHTML = '';
  }
  if (tokenListEl) {
    tokenListEl.textContent = '';
  }
  if (postfixEl) {
    postfixEl.textContent = '';
  }
  if (treeViewEl) {
    treeViewEl.textContent = '';
  }
  if (stepLogEl) {
    stepLogEl.textContent = '';
  }
  if (stepCounterEl) {
    stepCounterEl.textContent = 'step 0 / 0';
  }

  if (stepFirstBtn) stepFirstBtn.disabled = true;
  if (stepPrevBtn) stepPrevBtn.disabled = true;
  if (stepPlayBtn) stepPlayBtn.disabled = true;
  if (stepNextBtn) stepNextBtn.disabled = true;
  if (stepLastBtn) stepLastBtn.disabled = true;
  if (viewToggleSelect) {
    viewToggleSelect.disabled = true;
    const flatOpt = viewToggleSelect.querySelector('option[value="flat"]') as HTMLOptionElement | null;
    if (flatOpt) flatOpt.disabled = false;
  }

  masterPositions = null;
  (window as any).__masterPositions = null;
  stepSvgCache.clear();
  layoutFailed = false;
  if (layoutNoteEl) {
    layoutNoteEl.textContent = '';
    layoutNoteEl.className = '';
  }
  if (runStatusEl) {
    runStatusEl.textContent = '';
    runStatusEl.className = '';
  }

  currentAnalysis = null;
}

function renderPostfixView(container: HTMLElement, tokens: Token[]): void {
  container.textContent = '';
  tokens.forEach((t, i) => {
    const label = t.type === 'SYMBOL' ? t.symbol ?? 'SYMBOL' : t.type;
    const span = document.createElement('span');
    span.className = 'postfix-token';
    span.setAttribute('data-step-index', String(i + 1));
    span.textContent = label;
    span.style.cursor = 'pointer';
    span.style.marginRight = '6px';
    span.style.padding = '2px 4px';
    span.style.borderRadius = '3px';
    span.addEventListener('click', () => {
      stopPlayback();
      navigateToStep(i + 1);
    });
    container.appendChild(span);
    if (i < tokens.length - 1) {
      container.appendChild(document.createTextNode(' '));
    }
  });
}

function renderStepLog(container: HTMLElement, steps: Step[]): void {
  container.textContent = '';
  const list = document.createElement('ol');
  list.className = 'step-list';
  list.style.paddingLeft = '20px';
  steps.forEach((step) => {
    const li = document.createElement('li');
    li.className = 'step-log-item';
    li.setAttribute('data-step-index', String(step.index));
    li.textContent = `Step ${step.index}: ${step.description}`;
    li.style.cursor = 'pointer';
    li.style.padding = '2px 4px';
    li.style.margin = '2px 0';
    li.style.borderRadius = '3px';
    li.addEventListener('click', () => {
      stopPlayback();
      navigateToStep(step.index);
    });
    list.appendChild(li);
  });
  container.appendChild(list);
}

function attachStateHoverListeners(container: HTMLElement): void {
  const nodes = container.querySelectorAll('g.node');
  nodes.forEach((node) => {
    const aEl = node.querySelector('a');
    const tooltip = aEl?.getAttribute('xlink:title') || aEl?.getAttribute('title') || '';
    if (tooltip) {
      node.setAttribute('title', tooltip);
      const titleEl = node.querySelector('title') as Element | null;
      if (titleEl) {
        titleEl.textContent = tooltip;
      }
      const match = /Created by step (\d+)/.exec(tooltip);
      if (match) {
        node.setAttribute('data-created-by-step', match[1]);
      }
    }
  });
}

async function navigateToStep(stepIndex: number): Promise<void> {
  if (!currentAnalysis || currentAnalysis.steps.length === 0) return;
  const mode = checkDiagramCap(currentAnalysis.postfix.length);
  if (mode === 'off') {
    stopPlayback();
    return;
  }
  if (currentView === 'final') {
    currentView = (viewToggleSelect?.value === 'textbook' ? 'textbook' : 'flat');
    if (viewToggleSelect) {
      viewToggleSelect.value = currentView;
    }
  }
  currentActiveStates = null;
  isDeadRun = false;
  if (canvasEl) {
    canvasEl.removeAttribute('data-view');
    canvasEl.removeAttribute('data-run-status');
  }
  if (runStatusEl) {
    runStatusEl.textContent = '';
    runStatusEl.className = '';
  }

  const totalSteps = currentAnalysis.steps.length;
  const targetStep = Math.max(1, Math.min(stepIndex, totalSteps));
  currentStepIndex = targetStep;

  if (stepCounterEl) {
    stepCounterEl.textContent = `step ${currentStepIndex} / ${totalSteps}`;
  }

  if (stepFirstBtn) stepFirstBtn.disabled = currentStepIndex === 1;
  if (stepPrevBtn) stepPrevBtn.disabled = currentStepIndex === 1;
  if (stepNextBtn) stepNextBtn.disabled = currentStepIndex === totalSteps;
  if (stepLastBtn) stepLastBtn.disabled = currentStepIndex === totalSteps;

  if (stepLogEl) {
    const items = stepLogEl.querySelectorAll('.step-log-item');
    items.forEach((item, idx) => {
      if (idx + 1 === currentStepIndex) {
        item.classList.add('active');
        (item as HTMLElement).style.fontWeight = 'bold';
        (item as HTMLElement).style.backgroundColor = '#eef';
      } else {
        item.classList.remove('active');
        (item as HTMLElement).style.fontWeight = 'normal';
        (item as HTMLElement).style.backgroundColor = 'transparent';
      }
    });
  }

  if (postfixEl) {
    const tokens = postfixEl.querySelectorAll('.postfix-token');
    tokens.forEach((tok, idx) => {
      if (idx + 1 === currentStepIndex) {
        tok.classList.add('active');
        (tok as HTMLElement).style.backgroundColor = '#007acc';
        (tok as HTMLElement).style.color = '#fff';
      } else {
        tok.classList.remove('active');
        (tok as HTMLElement).style.backgroundColor = 'transparent';
        (tok as HTMLElement).style.color = 'inherit';
      }
    });
  }

  const gen = ++stepGeneration;
  const bGen = buildGeneration;
  const cacheKey = `${currentView}-${targetStep}`;

  if (stepSvgCache.has(cacheKey)) {
    if (canvasEl) {
      canvasEl.setAttribute('data-current-step', String(targetStep));
      canvasEl.innerHTML = stepSvgCache.get(cacheKey)!;
      attachStateHoverListeners(canvasEl);
    }
    return;
  }

  const snapshot = getStepSnapshot(currentAnalysis.steps, targetStep);
  let dot: string;
  let renderEngine: string | undefined;

  if (currentView === 'textbook') {
    dot = toDot(snapshot, { view: 'textbook', postfixCount: currentAnalysis.postfix.length });
    renderEngine = undefined;
  } else if (masterPositions && !layoutFailed) {
    dot = toDot(snapshot, { view: 'flat', pin: masterPositions, postfixCount: currentAnalysis.postfix.length });
    renderEngine = 'neato';
  } else {
    dot = toDot(snapshot, { view: 'flat', postfixCount: currentAnalysis.postfix.length });
    renderEngine = undefined;
  }

  if ((window as any).__testRenderDelay && (window as any).__testRenderDelay[targetStep]) {
    await new Promise((r) => setTimeout(r, (window as any).__testRenderDelay[targetStep]));
  }

  let result = await renderer.render(dot, renderEngine ? { engine: renderEngine } : undefined);

  if ((!result.ok || (window as any).__testForcePinnedRenderFailure) && renderEngine === 'neato') {
    layoutFailed = true;
    stepSvgCache.clear();
    const errText = !result.ok ? result.error : 'Forced pinned failure';
    if (layoutNoteEl) {
      layoutNoteEl.textContent = `Note: Pinned layout render failed (${errText}); falling back to unpinned layout.`;
      layoutNoteEl.className = 'warning';
    }
    const fallbackDot = toDot(snapshot, { view: 'flat', postfixCount: currentAnalysis.postfix.length });
    result = await renderer.render(fallbackDot);
  }

  if (bGen !== buildGeneration || gen !== stepGeneration) {
    return;
  }

  if (canvasEl) {
    canvasEl.setAttribute('data-current-step', String(targetStep));
    if (result.ok) {
      canvasEl.innerHTML = result.svg;
      attachStateHoverListeners(canvasEl);
      if (bGen === buildGeneration) {
        stepSvgCache.set(cacheKey, result.svg);
      }
    } else {
      canvasEl.innerHTML = '';
      if (result.error) {
        canvasEl.textContent = `Error rendering diagram: ${result.error}`;
      }
    }
  }
}

async function renderFinalView(): Promise<void> {
  if (!currentAnalysis) return;
  stopPlayback();
  currentView = 'final';
  if (viewToggleSelect) {
    viewToggleSelect.value = 'final';
  }

  const mode = checkDiagramCap(currentAnalysis.postfix.length);
  if (mode === 'off') {
    const message = `Diagram is disabled for expressions over ${CAPS.textbookStepping} postfix tokens (limit: ${CAPS.textbookStepping}). Table, simulation, and tests remain available.`;
    if (canvasEl) {
      canvasEl.innerHTML = '';
      canvasEl.textContent = message;
      canvasEl.setAttribute('data-view', 'final');
      canvasEl.removeAttribute('data-current-step');
    }
    return;
  }

  if (stepCounterEl) {
    stepCounterEl.textContent = `Final NFA (${currentAnalysis.stats.states} states, ${currentAnalysis.stats.transitions} transitions)`;
  }

  if (stepFirstBtn) stepFirstBtn.disabled = false;
  if (stepPrevBtn) stepPrevBtn.disabled = false;
  if (stepNextBtn) stepNextBtn.disabled = false;
  if (stepLastBtn) stepLastBtn.disabled = false;
  if (stepPlayBtn) stepPlayBtn.disabled = true;

  if (stepLogEl) {
    const items = stepLogEl.querySelectorAll('.step-log-item');
    items.forEach((item) => {
      item.classList.remove('active');
      (item as HTMLElement).style.fontWeight = 'normal';
      (item as HTMLElement).style.backgroundColor = 'transparent';
    });
  }

  if (postfixEl) {
    const tokens = postfixEl.querySelectorAll('.postfix-token');
    tokens.forEach((tok) => {
      tok.classList.remove('active');
      (tok as HTMLElement).style.backgroundColor = 'transparent';
      (tok as HTMLElement).style.color = 'inherit';
    });
  }

  const gen = ++stepGeneration;
  const bGen = buildGeneration;
  const compact = isCompactLabels();
  const activeStr = currentActiveStates ? currentActiveStates.join(',') : 'none';
  const cacheKey = `final-${compact}-${activeStr}`;

  if (stepSvgCache.has(cacheKey)) {
    if (canvasEl) {
      canvasEl.setAttribute('data-view', 'final');
      canvasEl.removeAttribute('data-current-step');
      if (isDeadRun) {
        canvasEl.setAttribute('data-run-status', 'dead');
      } else {
        canvasEl.removeAttribute('data-run-status');
      }
      canvasEl.innerHTML = stepSvgCache.get(cacheKey)!;
      attachStateHoverListeners(canvasEl);
    }
    return;
  }

  const options: DiagramOptions = {
    compactLabels: compact,
    ...(currentActiveStates ? { activeStates: currentActiveStates } : {})
  };

  let renderEngine: string | undefined;
  if (masterPositions && !layoutFailed) {
    options.pin = masterPositions;
    renderEngine = 'neato';
  } else {
    renderEngine = undefined;
  }

  const dot = toDot(currentAnalysis.nfa, options);
  let result = await renderer.render(dot, renderEngine ? { engine: renderEngine } : undefined);

  if (!result.ok && renderEngine === 'neato') {
    layoutFailed = true;
    stepSvgCache.clear();
    const fallbackDot = toDot(currentAnalysis.nfa, {
      compactLabels: compact,
      ...(currentActiveStates ? { activeStates: currentActiveStates } : {})
    });
    result = await renderer.render(fallbackDot);
  }

  if (bGen !== buildGeneration || gen !== stepGeneration) {
    return;
  }

  if (canvasEl) {
    canvasEl.setAttribute('data-view', 'final');
    canvasEl.removeAttribute('data-current-step');
    if (isDeadRun) {
      canvasEl.setAttribute('data-run-status', 'dead');
    } else {
      canvasEl.removeAttribute('data-run-status');
    }

    if (result.ok) {
      canvasEl.innerHTML = result.svg;
      attachStateHoverListeners(canvasEl);
      if (bGen === buildGeneration) {
        stepSvgCache.set(cacheKey, result.svg);
      }
    } else {
      canvasEl.innerHTML = '';
      if (result.error) {
        canvasEl.textContent = `Error rendering diagram: ${result.error}`;
      }
    }
  }
}


function togglePlayback(): void {
  if (!currentAnalysis || currentAnalysis.steps.length === 0) return;
  if (playbackTimer !== null) {
    stopPlayback();
  } else {
    startPlayback();
  }
}

function startPlayback(): void {
  if (!currentAnalysis || currentAnalysis.steps.length === 0) return;
  const totalSteps = currentAnalysis.steps.length;
  if (currentStepIndex >= totalSteps) {
    currentStepIndex = 1;
    navigateToStep(1);
  }
  if (stepPlayBtn) {
    stepPlayBtn.textContent = 'Pause';
  }
  const speed = Number(stepSpeedSelect?.value || 750);
  playbackTimer = setInterval(() => {
    if (currentStepIndex < totalSteps) {
      navigateToStep(currentStepIndex + 1);
    } else {
      stopPlayback();
    }
  }, speed);
}

function stopPlayback(): void {
  if (playbackTimer !== null) {
    clearInterval(playbackTimer);
    playbackTimer = null;
  }
  if (stepPlayBtn) {
    stepPlayBtn.textContent = 'Play';
  }
}

async function handleBuild() {
  if (!inputEl) return;
  stopPlayback();
  const gen = ++buildGeneration;
  const source = inputEl.value;

  const notation = notationSelectEl?.value === 'textbook' ? 'textbook' : 'standard';
  const concatenation = concatSelectEl?.value === 'merge' ? 'merge' : 'epsilon-link';

  let analysis = analyze(source, {
    notation,
    concatenation,
    ...(userEditedAlphabet ? { alphabet: userEditedAlphabet } : {})
  });

  // If a previously edited alphabet lacks a symbol required by the new expression, reset it
  if (!analysis.ok && analysis.code === 'INVALID_ALPHABET' && userEditedAlphabet) {
    userEditedAlphabet = null;
    analysis = analyze(source, { notation, concatenation });
  }

  if (!analysis.ok) {
    clearResults();
    if (errorEl) {
      if (analysis.code === 'EMPTY_INPUT') {
        errorEl.textContent = analysis.hint || analysis.message;
        errorEl.className = 'hint';
        errorEl.removeAttribute('data-error-code');
        errorEl.removeAttribute('data-error-position');
      } else {
        errorEl.textContent =
          analysis.position !== undefined
            ? `${analysis.message} at position ${analysis.position}`
            : analysis.message;
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
    (window as any).__masterPositions = null;
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

  if (alphabetInputEl) {
    alphabetInputEl.value = analysis.alphabet.join(', ');
  }
  if (alphabetMessageEl) {
    alphabetMessageEl.textContent = '';
    alphabetMessageEl.className = '';
  }

  if (statsEl) {
    statsEl.textContent = `States: ${analysis.stats.states}, Transitions: ${analysis.stats.transitions}`;
    statsEl.setAttribute('data-states', String(analysis.stats.states));
    statsEl.setAttribute('data-transitions', String(analysis.stats.transitions));
  }

  if (tokenListEl) {
    renderTokenList(tokenListEl, analysis.tokens);
  }

  if (postfixEl) {
    renderPostfixView(postfixEl, analysis.postfix);
  }

  if (treeViewEl) {
    renderTreeView(treeViewEl, analysis.parseTree);
  }

  if (tableEl) {
    renderTransitionTable(tableEl, analysis);
  }

  if (stepLogEl) {
    renderStepLog(stepLogEl, analysis.steps);
  }

  if (stepPlayBtn) {
    stepPlayBtn.disabled = false;
  }

  stepSvgCache.clear();
  layoutFailed = false;
  if (layoutNoteEl) {
    layoutNoteEl.textContent = '';
    layoutNoteEl.className = '';
  }

  const postfixLen = analysis.postfix.length;
  const capMode = checkDiagramCap(postfixLen);
  const flatOption = viewToggleSelect?.querySelector('option[value="flat"]') as HTMLOptionElement | null;
  const textbookOption = viewToggleSelect?.querySelector('option[value="textbook"]') as HTMLOptionElement | null;

  if (capMode === 'off') {
    if (stepFirstBtn) stepFirstBtn.disabled = true;
    if (stepPrevBtn) stepPrevBtn.disabled = true;
    if (stepPlayBtn) stepPlayBtn.disabled = true;
    if (stepNextBtn) stepNextBtn.disabled = true;
    if (stepLastBtn) stepLastBtn.disabled = true;
    if (flatOption) flatOption.disabled = true;
    if (textbookOption) textbookOption.disabled = true;
    if (viewToggleSelect) viewToggleSelect.disabled = false;

    const message = `Diagram is disabled for expressions over ${CAPS.textbookStepping} postfix tokens (limit: ${CAPS.textbookStepping}). Table, simulation, and tests remain available.`;
    if (canvasEl) {
      canvasEl.innerHTML = '';
      canvasEl.textContent = message;
    }
    if (layoutNoteEl) {
      layoutNoteEl.textContent = message;
      layoutNoteEl.className = 'warning';
    }
    (window as any).__masterPositions = null;
    (window as any).__buildDone = true;
    return;
  }

  if (capMode === 'textbook') {
    if (flatOption) flatOption.disabled = true;
    if (textbookOption) textbookOption.disabled = false;
    currentView = 'textbook';
    if (viewToggleSelect) {
      viewToggleSelect.disabled = false;
      viewToggleSelect.value = 'textbook';
    }
    if (layoutNoteEl) {
      layoutNoteEl.textContent = `Flat stepping is disabled for expressions over ${CAPS.flatStepping} postfix tokens (limit: ${CAPS.flatStepping}). Showing textbook view.`;
      layoutNoteEl.className = 'warning';
    }
  } else {
    if (flatOption) flatOption.disabled = false;
    if (textbookOption) textbookOption.disabled = false;
    if (viewToggleSelect) {
      viewToggleSelect.disabled = false;
      currentView = (viewToggleSelect.value as 'flat' | 'textbook') || 'flat';
    }
  }

  if (postfixLen <= CAPS.flatStepping) {
    let epsNfa = analysis.nfa;
    if (concatenation !== 'epsilon-link') {
      const epsAnalysis = analyze(source, {
        notation,
        concatenation: 'epsilon-link',
        ...(userEditedAlphabet ? { alphabet: userEditedAlphabet } : {})
      });
      if (epsAnalysis.ok) {
        epsNfa = epsAnalysis.nfa;
      }
    }

    if ((window as any).__testForceLayoutFailure) {
      masterPositions = null;
      layoutFailed = true;
      if (layoutNoteEl) {
        layoutNoteEl.textContent = 'Note: Master layout failed (Forced test failure); falling back to unpinned layout.';
        layoutNoteEl.className = 'warning';
      }
    } else {
      const layoutRes = await computeMasterLayout(epsNfa, renderer);
      if (gen !== buildGeneration) return;
      if (layoutRes.ok) {
        masterPositions = layoutRes.positions;
        layoutFailed = false;
        if (layoutNoteEl) {
          layoutNoteEl.textContent = '';
          layoutNoteEl.className = '';
        }
      } else {
        masterPositions = null;
        layoutFailed = true;
        if (layoutNoteEl) {
          layoutNoteEl.textContent = `Note: Master layout failed (${layoutRes.error}); falling back to unpinned layout.`;
          layoutNoteEl.className = 'warning';
        }
      }
    }
  } else {
    masterPositions = null;
    layoutFailed = false;
  }

  if (gen !== buildGeneration) return;

  await navigateToStep(1);

  if (gen !== buildGeneration) return;

  (window as any).__masterPositions = masterPositions;
  (window as any).__buildDone = true;
}

function renderTrace(
  container: HTMLElement,
  results: RunResult[],
  lines: string[]
): void {
  const compact = isCompactLabels();
  container.textContent = '';
  const mapState = (q: number) =>
    currentAnalysis && compact ? currentAnalysis.compactLabelMap[q] ?? q : q;

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
    initialDiv.setAttribute('data-states', res.initialClosure.join(','));
    initialDiv.style.cursor = 'pointer';
    const initMapped = res.initialClosure.map(mapState).sort((a, b) => a - b);
    initialDiv.textContent = `Initial: {${initMapped.join(', ')}}`;

    initialDiv.addEventListener('click', () => {
      container.querySelectorAll('.trace-step, .trace-status').forEach((el) => el.classList.remove('active'));
      initialDiv.classList.add('active');
      currentActiveStates = [...res.initialClosure];
      isDeadRun = false;
      if (runStatusEl) {
        runStatusEl.textContent = '';
        runStatusEl.className = '';
      }
      renderFinalView();
    });
    lineEl.appendChild(initialDiv);

    for (let idx = 0; idx < res.afterEachSymbol.length; idx++) {
      const set = res.afterEachSymbol[idx];
      const char = codePoints[idx] ?? '';
      const stepDiv = document.createElement('div');
      stepDiv.className = 'trace-step';
      stepDiv.setAttribute('data-step', String(idx + 1));
      stepDiv.setAttribute('data-states', set.join(','));
      stepDiv.style.cursor = 'pointer';
      const mapped = set.map(mapState).sort((a, b) => a - b);
      stepDiv.textContent = `After '${char}': {${mapped.join(', ')}}`;

      stepDiv.addEventListener('click', () => {
        container.querySelectorAll('.trace-step, .trace-status').forEach((el) => el.classList.remove('active'));
        stepDiv.classList.add('active');
        currentActiveStates = [...set];
        isDeadRun = set.length === 0;
        if (runStatusEl) {
          if (isDeadRun) {
            runStatusEl.textContent = `Run is dead at position ${idx}: active set is empty.`;
            runStatusEl.className = 'warning';
          } else {
            runStatusEl.textContent = '';
            runStatusEl.className = '';
          }
        }
        renderFinalView();
      });
      lineEl.appendChild(stepDiv);
    }

    if (res.status === 'dead') {
      const deadDiv = document.createElement('div');
      deadDiv.className = 'trace-status dead';
      deadDiv.style.cursor = 'pointer';
      deadDiv.textContent = `Dead at position ${res.position}`;
      deadDiv.addEventListener('click', () => {
        container.querySelectorAll('.trace-step, .trace-status').forEach((el) => el.classList.remove('active'));
        deadDiv.classList.add('active');
        currentActiveStates = [];
        isDeadRun = true;
        if (runStatusEl) {
          runStatusEl.textContent = `Run is dead at position ${res.position}: active set is empty.`;
          runStatusEl.className = 'warning';
        }
        renderFinalView();
      });
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
    if (verdictEl) {
      verdictEl.textContent = '';
    }
    if (traceEl) {
      traceEl.innerHTML = '';
    }
    if (runStatusEl) {
      runStatusEl.textContent = '';
      runStatusEl.className = '';
    }
    (window as any).__runDone = true;
    return;
  }

  currentView = 'final';
  if (viewToggleSelect) {
    viewToggleSelect.value = 'final';
  }

  const text = testInputEl ? testInputEl.value : '';
  const lines = text.split(/\r\n|\r|\n/);
  const activeAlphabet = userEditedAlphabet ?? currentAnalysis.alphabet;
  const results = runLines(currentAnalysis.nfa, activeAlphabet, text);

  lastRunResults = results;
  lastRunLines = lines;

  if (verdictEl) {
    verdictEl.textContent = results.map((r) => r.verdict).join('\n');
  }

  if (runStatusEl) {
    runStatusEl.textContent = '';
    runStatusEl.className = '';
  }

  if (traceEl) {
    renderTrace(traceEl, results, lines);
    if (results.length > 0) {
      const firstInitial = traceEl.querySelector('.trace-step[data-step="0"]') as HTMLElement | null;
      if (firstInitial) {
        firstInitial.classList.add('active');
      }
      currentActiveStates = [...results[0].initialClosure];
      isDeadRun = false;
      const mode = checkDiagramCap(currentAnalysis.postfix.length);
      if (mode !== 'off') {
        renderFinalView();
      }
    }
  }

  (window as any).__runDone = true;
}

if (buttonEl) {
  buttonEl.addEventListener('click', handleBuild);
}

if (runButtonEl) {
  runButtonEl.addEventListener('click', handleRun);
}

if (notationSelectEl) {
  notationSelectEl.addEventListener('change', handleBuild);
}

if (concatSelectEl) {
  concatSelectEl.addEventListener('change', handleBuild);
}

if (insertEpsBtn) {
  insertEpsBtn.addEventListener('click', () => insertAtCursor('ε'));
}

if (insertEmptyBtn) {
  insertEmptyBtn.addEventListener('click', () => insertAtCursor('∅'));
}

if (alphabetInputEl) {
  alphabetInputEl.addEventListener('change', () => {
    if (!currentAnalysis) return;
    const newAlpha = parseAlphabetInput(alphabetInputEl.value);
    const required = currentAnalysis.tokens
      .filter((t) => t.type === 'SYMBOL' && t.symbol !== undefined)
      .map((t) => t.symbol!);
    const valRes = validateAlphabet(newAlpha, required);
    if (!valRes.ok) {
      if (alphabetMessageEl) {
        alphabetMessageEl.textContent = valRes.message;
        alphabetMessageEl.className = 'error';
      }
      // Restore valid alphabet in input
      alphabetInputEl.value = (userEditedAlphabet ?? currentAnalysis.alphabet).join(', ');
    } else {
      if (alphabetMessageEl) {
        alphabetMessageEl.textContent = '';
        alphabetMessageEl.className = '';
      }
      userEditedAlphabet = valRes.alphabet;
      currentAnalysis.alphabet = valRes.alphabet;
      alphabetInputEl.value = valRes.alphabet.join(', ');
    }
  });
}

if (inputEl) {
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      handleBuild();
    }
  });
}

if (stepFirstBtn) {
  stepFirstBtn.addEventListener('click', () => {
    stopPlayback();
    navigateToStep(1);
  });
}

if (stepPrevBtn) {
  stepPrevBtn.addEventListener('click', () => {
    stopPlayback();
    navigateToStep(currentStepIndex - 1);
  });
}

if (stepPlayBtn) {
  stepPlayBtn.addEventListener('click', togglePlayback);
}

if (stepNextBtn) {
  stepNextBtn.addEventListener('click', () => {
    stopPlayback();
    navigateToStep(currentStepIndex + 1);
  });
}

if (stepLastBtn) {
  stepLastBtn.addEventListener('click', () => {
    stopPlayback();
    if (currentAnalysis) {
      navigateToStep(currentAnalysis.steps.length);
    }
  });
}

if (stepSpeedSelect) {
  stepSpeedSelect.addEventListener('change', () => {
    if (playbackTimer !== null) {
      stopPlayback();
      startPlayback();
    }
  });
}

if (viewToggleSelect) {
  viewToggleSelect.addEventListener('change', () => {
    const val = (viewToggleSelect.value as 'flat' | 'textbook' | 'final') || 'flat';
    currentView = val;
    if (currentAnalysis) {
      if (val === 'final') {
        renderFinalView();
      } else {
        navigateToStep(currentStepIndex);
      }
    }
  });
}

if (compactLabelsEl) {
  compactLabelsEl.addEventListener('change', () => {
    if (currentAnalysis) {
      renderTransitionTable(tableEl!, currentAnalysis);
      if (lastRunResults && lastRunLines && traceEl) {
        renderTrace(traceEl, lastRunResults, lastRunLines);
      }
      if (currentView === 'final') {
        renderFinalView();
      }
    }
  });
}

window.addEventListener('keydown', (e: KeyboardEvent) => {
  const target = e.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
    return;
  }
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    stopPlayback();
    if (currentStepIndex > 1) {
      navigateToStep(currentStepIndex - 1);
    }
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    stopPlayback();
    if (currentAnalysis && currentStepIndex < currentAnalysis.steps.length) {
      navigateToStep(currentStepIndex + 1);
    }
  }
});

// Initially disable stepper buttons until a build occurs
if (stepFirstBtn) stepFirstBtn.disabled = true;
if (stepPrevBtn) stepPrevBtn.disabled = true;
if (stepPlayBtn) stepPlayBtn.disabled = true;
if (stepNextBtn) stepNextBtn.disabled = true;
if (stepLastBtn) stepLastBtn.disabled = true;

(window as any).__ready = true;
