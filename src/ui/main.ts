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
  CAPS,
  validateInvariants,
  checkSizeFormula,
  checkStepReplay,
  runBuiltinSuite,
  computeDifferentialK,
  runDifferential,
  allStrings,
  toJs,
  CheckResult,
  STRESS_FAMILIES,
  STRESS_N_SERIES,
  STRESS_SCALE_N_SERIES,
  runStressNfa,
  detectBrowserEngine,
  PRESETS,
  type Preset
} from '../engine/index';
import { toDot, VizRenderer, computeMasterLayout, checkDiagramCap, type DiagramOptions, renderStressChartSvg, type StressChartPoint } from '../diagram/index';
import type { StressRow, RegExpVerdict } from './stress-types';
import { formatStressCsv } from './csv';
import {
  clampZoom,
  zoomAt,
  panBy,
  fitToContainer,
  initialView,
  sameFrame,
  toTransformString,
  getEffectiveLimits,
  type ViewportState,
  type ViewportMode,
  type Rect
} from './viewport';
import InlineWorker from './worker.ts?worker&inline';

const renderer = new VizRenderer();
(window as any).VizRenderer = VizRenderer;
let currentAnalysis: AnalysisSuccess | null = null;
let userEditedAlphabet: string[] | null = null;
let buildGeneration = 0;
let stepGeneration = 0;
let diffGeneration = 0;
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

let workerInstance: Worker | null = null;
let workerReqSeq = 0;

function getWorker(): Worker {
  if (!workerInstance) {
    workerInstance = new InlineWorker();
    workerInstance.onmessage = (e: MessageEvent) => {
      if (e.data && 'pong' in e.data) {
        const statusEl = document.getElementById('worker-status');
        if (statusEl) {
          statusEl.textContent = JSON.stringify(e.data);
        }
      }
    };
  }
  return workerInstance;
}

let activeWorkerOwner: 'stress' | 'diff' | null = null;
let activeWorkerCanceller: (() => void) | null = null;

function resetWorker(): void {
  if (workerInstance) {
    try {
      workerInstance.terminate();
    } catch {}
    workerInstance = null;
  }
  if (activeWorkerCanceller) {
    const cb = activeWorkerCanceller;
    activeWorkerCanceller = null;
    activeWorkerOwner = null;
    cb();
  }
}

function runRegExpInWorker(
  pattern: string,
  strings: string[],
  timeoutMs = 2000,
  owner: 'stress' | 'diff' = 'diff'
): Promise<{ matches?: boolean[]; timeout?: boolean; cancelled?: boolean; error?: string }> {
  return new Promise((resolve) => {
    const worker = getWorker();
    const id = ++workerReqSeq;
    let settled = false;
    activeWorkerOwner = owner;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      activeWorkerOwner = null;
      activeWorkerCanceller = null;
      resetWorker();
      resolve({ timeout: true });
    }, timeoutMs);

    activeWorkerCanceller = () => {
      if (settled) return;
      settled = true;
      activeWorkerOwner = null;
      activeWorkerCanceller = null;
      clearTimeout(timer);
      resolve({ timeout: true, cancelled: true });
    };

    const onMessage = (e: MessageEvent) => {
      if (e.data && e.data.type === 'regexp-result' && e.data.id === id) {
        if (settled) return;
        settled = true;
        activeWorkerOwner = null;
        activeWorkerCanceller = null;
        clearTimeout(timer);
        worker.removeEventListener('message', onMessage);
        resolve({ matches: e.data.matches, error: e.data.error, timeout: false });
      }
    };

    worker.addEventListener('message', onMessage);
    worker.postMessage({ type: 'test-regexp', id, pattern, strings });
  });
}

// Setup inline worker
try {
  const worker = getWorker();
  worker.postMessage({ ping: 'hello' });
} catch (err) {
  console.error('Worker initialization failed', err);
}

const inputEl = document.getElementById('regex-input') as HTMLInputElement | null;
const presetSelectEl = document.getElementById('preset-select') as HTMLSelectElement | null;
const liveRegionEl = document.getElementById('live-region');
const buttonEl = document.getElementById('build-button') as HTMLButtonElement | null;
const notationSelectEl = document.getElementById('notation-select') as HTMLSelectElement | null;
const concatSelectEl = document.getElementById('concat-select') as HTMLSelectElement | null;
const insertEpsBtn = document.getElementById('insert-eps') as HTMLButtonElement | null;
const insertEmptyBtn = document.getElementById('insert-empty') as HTMLButtonElement | null;
const alphabetInputEl = document.getElementById('alphabet-input') as HTMLInputElement | null;
const alphabetMessageEl = document.getElementById('alphabet-message');
const statsEl = document.getElementById('stats');
const canvasEl = document.getElementById('canvas');
const canvasToolbarEl = document.getElementById('canvas-toolbar');
const zoomInBtn = document.getElementById('zoom-in-btn') as HTMLButtonElement | null;
const zoomOutBtn = document.getElementById('zoom-out-btn') as HTMLButtonElement | null;
const zoomFitBtn = document.getElementById('zoom-fit-btn') as HTMLButtonElement | null;
const zoomResetBtn = document.getElementById('zoom-reset-btn') as HTMLButtonElement | null;
const zoomLevelEl = document.getElementById('zoom-level');

let currentViewport: ViewportState = { zoom: 1.0, panX: 0, panY: 0 };
let currentViewportMode: ViewportMode = 'fit';
let currentContentRect: Rect | null = null;
let currentViewBox: string | null = null;
let currentFitZoom: number | null = null;
const WHEEL_ZOOM_K = 0.0015;

function getCanvasViewport(): HTMLElement | null {
  return document.getElementById('canvas-viewport');
}

function updateToolbarButtonStates(): void {
  const hasContent = currentContentRect !== null;
  if (!hasContent) {
    if (zoomInBtn) zoomInBtn.disabled = true;
    if (zoomOutBtn) zoomOutBtn.disabled = true;
    if (zoomFitBtn) zoomFitBtn.disabled = true;
    if (zoomResetBtn) zoomResetBtn.disabled = true;
    return;
  }
  const limits = getEffectiveLimits(currentFitZoom ?? undefined);
  if (zoomInBtn) zoomInBtn.disabled = currentViewport.zoom >= limits.maxZoom - 1e-4;
  if (zoomOutBtn) zoomOutBtn.disabled = currentViewport.zoom <= limits.minZoom + 1e-4;
  if (zoomFitBtn) zoomFitBtn.disabled = false;
  if (zoomResetBtn) zoomResetBtn.disabled = false;
}

function applyViewport(): void {
  const viewport = getCanvasViewport();
  if (viewport) {
    viewport.style.transform = toTransformString(currentViewport);
  }
  if (canvasEl) {
    canvasEl.setAttribute('data-zoom', currentViewport.zoom.toFixed(4));
    canvasEl.setAttribute('data-pan-x', currentViewport.panX.toFixed(2));
    canvasEl.setAttribute('data-pan-y', currentViewport.panY.toFixed(2));
    canvasEl.setAttribute('data-viewport-mode', currentViewportMode);
  }
  if (zoomLevelEl) {
    zoomLevelEl.textContent = `${Math.round(currentViewport.zoom * 100)}%`;
  }
  updateToolbarButtonStates();
}

function clearViewport(): void {
  currentContentRect = null;
  currentViewBox = null;
  currentFitZoom = null;
  currentViewport = { zoom: 1.0, panX: 0, panY: 0 };
  currentViewportMode = 'fit';
  const viewport = getCanvasViewport();
  if (viewport) {
    viewport.style.transform = '';
  }
  if (canvasEl) {
    canvasEl.removeAttribute('data-zoom');
    canvasEl.removeAttribute('data-pan-x');
    canvasEl.removeAttribute('data-pan-y');
    canvasEl.removeAttribute('data-viewport-mode');
  }
  if (zoomLevelEl) {
    zoomLevelEl.textContent = '100%';
  }
  updateToolbarButtonStates();
}

function extractSvgViewBox(svgString: string): string | null {
  const m = /viewBox=["']([^"']+)["']/.exec(svgString);
  return m ? m[1] : null;
}

function parseRenderedSvgRect(svgString: string): Rect | null {
  const vb = extractSvgViewBox(svgString);
  if (!vb) return null;
  const parts = vb.trim().split(/\s+/).map(Number);
  if (parts.length >= 4 && !isNaN(parts[2]) && !isNaN(parts[3]) && parts[2] > 0 && parts[3] > 0) {
    // Graphviz pt x 4/3 = rendered px per D4
    return {
      width: parts[2] * (4 / 3),
      height: parts[3] * (4 / 3)
    };
  }
  return null;
}

function setCanvasContent(content: string, isText = false): void {
  const viewport = getCanvasViewport();
  if (!viewport) return;

  if (isText || !content.trim()) {
    viewport.textContent = isText ? content : '';
    clearViewport();
    return;
  }

  viewport.innerHTML = content;

  const newViewBox = extractSvgViewBox(content);
  const newRect = parseRenderedSvgRect(content);

  if (!newViewBox || !newRect) {
    clearViewport();
    return;
  }

  const containerRect: Rect = {
    width: canvasEl ? (canvasEl.clientWidth || 800) : 800,
    height: canvasEl ? (canvasEl.clientHeight || 500) : 500
  };

  const fit = fitToContainer(newRect, containerRect);
  currentFitZoom = fit.zoom;
  currentContentRect = newRect;

  if (sameFrame(currentViewBox, newViewBox)) {
    applyViewport();
  } else {
    currentViewBox = newViewBox;
    const init = initialView(newRect, containerRect);
    currentViewport = { zoom: init.zoom, panX: init.panX, panY: init.panY };
    currentViewportMode = init.mode;
    applyViewport();
  }
}
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
const invI1El = document.getElementById('inv-I1');
const invI2El = document.getElementById('inv-I2');
const invI3El = document.getElementById('inv-I3');
const invI4El = document.getElementById('inv-I4');
const invSizeEl = document.getElementById('inv-size');
const invReplayEl = document.getElementById('inv-replay');
const runSuiteBtn = document.getElementById('run-suite') as HTMLButtonElement | null;
const suiteTableEl = document.getElementById('suite-table');
const diffRunBtn = document.getElementById('diff-run') as HTMLButtonElement | null;
const diffStatusEl = document.getElementById('diff-status');
const diffResultsEl = document.getElementById('diff-results');
const stressRunBtn = document.getElementById('stress-run') as HTMLButtonElement | null;
let diffIsActive = false;
let stressIsActive = false;
let liveRegionTimer: ReturnType<typeof setTimeout> | null = null;

function announceLive(message: string): void {
  if (!liveRegionEl) return;
  if (liveRegionTimer !== null) {
    clearTimeout(liveRegionTimer);
    liveRegionTimer = null;
  }
  liveRegionEl.textContent = '';
  liveRegionTimer = setTimeout(() => {
    if (liveRegionEl) {
      liveRegionEl.textContent = message;
    }
    liveRegionTimer = null;
  }, 20);
}

if (presetSelectEl) {
  for (const preset of PRESETS) {
    const opt = document.createElement('option');
    opt.value = preset.id;
    opt.textContent = `${preset.name} [${preset.notation}]`;
    presetSelectEl.appendChild(opt);
  }
}

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
    setCanvasContent('');
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

  for (const el of [invI1El, invI2El, invI3El, invI4El, invSizeEl, invReplayEl]) {
    if (el) {
      el.textContent = '';
      el.removeAttribute('data-pass');
      el.className = 'check-item';
    }
  }
  if (diffStatusEl) diffStatusEl.textContent = '';
  if (diffResultsEl) diffResultsEl.innerHTML = '';

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

  const stepRecord = currentAnalysis.steps[targetStep - 1];
  if (stepRecord) {
    announceLive(`Step ${currentStepIndex} of ${totalSteps}: ${stepRecord.rule}`);
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
      setCanvasContent(stepSvgCache.get(cacheKey)!);
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

  let result = await renderer.render(dot, renderEngine ? { engine: renderEngine } : undefined);

  if (!result.ok && renderEngine === 'neato') {
    layoutFailed = true;
    stepSvgCache.clear();
    const errText = result.error;
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
      setCanvasContent(result.svg);
      attachStateHoverListeners(canvasEl);
      if (bGen === buildGeneration) {
        stepSvgCache.set(cacheKey, result.svg);
      }
    } else {
      setCanvasContent(result.error ? `Error rendering diagram: ${result.error}` : '', true);
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
      setCanvasContent(message, true);
      canvasEl.setAttribute('data-view', 'final');
      canvasEl.removeAttribute('data-current-step');
      canvasEl.removeAttribute('data-zoom');
      canvasEl.removeAttribute('data-pan-x');
      canvasEl.removeAttribute('data-pan-y');
      canvasEl.removeAttribute('data-viewport-mode');
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
      setCanvasContent(stepSvgCache.get(cacheKey)!);
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
      setCanvasContent(result.svg);
      attachStateHoverListeners(canvasEl);
      if (bGen === buildGeneration) {
        stepSvgCache.set(cacheKey, result.svg);
      }
    } else {
      setCanvasContent(result.error ? `Error rendering diagram: ${result.error}` : '', true);
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

function renderValidationChecks(analysis: AnalysisSuccess, concatenation: 'epsilon-link' | 'merge'): void {
  const inv = validateInvariants(analysis.nfa);
  const size = checkSizeFormula(analysis, concatenation);
  const replay = checkStepReplay(analysis);

  const items: Array<{ el: HTMLElement | null; label: string; check: CheckResult }> = [
    { el: invI1El, label: 'I1 (Distinct Start & Accept)', check: inv.I1 },
    { el: invI2El, label: 'I2 (No Transition Enters Start)', check: inv.I2 },
    { el: invI3El, label: 'I3 (No Transition Leaves Accept)', check: inv.I3 },
    { el: invI4El, label: 'I4 (State Degree Constraints)', check: inv.I4 },
    { el: invSizeEl, label: 'Size Formula', check: size },
    { el: invReplayEl, label: 'Step-log Replay', check: replay }
  ];

  for (const item of items) {
    if (item.el) {
      item.el.setAttribute('data-pass', String(item.check.pass));
      item.el.className = `check-item ${item.check.pass ? 'pass' : 'fail'}`;
      item.el.textContent = `${item.check.pass ? 'PASS' : 'FAIL'} - ${item.label}: ${item.check.explanation}`;
    }
  }
}

async function handleBuild() {
  if (!inputEl) return;
  stopPlayback();
  currentViewBox = null;
  const gen = ++buildGeneration;
  ++diffGeneration;
  if (diffStatusEl) diffStatusEl.textContent = '';
  if (diffResultsEl) diffResultsEl.innerHTML = '';
  if (verdictEl) verdictEl.textContent = '';
  if (traceEl) traceEl.innerHTML = '';
  if (runStatusEl) {
    runStatusEl.textContent = '';
    runStatusEl.className = '';
  }
  currentActiveStates = null;
  isDeadRun = false;
  lastRunResults = null;
  lastRunLines = null;
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

  renderValidationChecks(analysis, concatenation);

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
    currentStepIndex = 0;
    if (stepCounterEl) {
      stepCounterEl.textContent = 'step 0 / 0';
    }

    const message = `Diagram is disabled for expressions over ${CAPS.textbookStepping} postfix tokens (limit: ${CAPS.textbookStepping}). Table, simulation, and tests remain available.`;
    if (canvasEl) {
      setCanvasContent(message, true);
      canvasEl.removeAttribute('data-current-step');
      canvasEl.removeAttribute('data-view');
      canvasEl.removeAttribute('data-run-status');
      canvasEl.removeAttribute('data-zoom');
      canvasEl.removeAttribute('data-pan-x');
      canvasEl.removeAttribute('data-pan-y');
      canvasEl.removeAttribute('data-viewport-mode');
    }
    if (layoutNoteEl) {
      layoutNoteEl.textContent = message;
      layoutNoteEl.className = 'warning';
    }
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
  } else {
    masterPositions = null;
    layoutFailed = false;
  }

  if (gen !== buildGeneration) return;

  await navigateToStep(1);
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
    const verdictLines = results.map((r) => r.verdict);
    verdictEl.textContent = verdictLines.join('\n');
    announceLive(`Verdict: ${verdictLines.join(', ')}`);
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

if (presetSelectEl) {
  presetSelectEl.addEventListener('change', () => {
    const selectedId = presetSelectEl.value;
    if (!selectedId) return;
    const preset = PRESETS.find((p) => p.id === selectedId);
    if (!preset) return;

    if (inputEl) inputEl.value = preset.regex;
    if (notationSelectEl) notationSelectEl.value = preset.notation;
    if (preset.concatenation && concatSelectEl) {
      concatSelectEl.value = preset.concatenation;
    }
    if (preset.testInput && testInputEl) {
      testInputEl.value = preset.testInput;
    }
    handleBuild();
  });
}

if (inputEl) {
  inputEl.addEventListener('input', () => {
    if (presetSelectEl && presetSelectEl.value) {
      const activePreset = PRESETS.find((p) => p.id === presetSelectEl.value);
      if (activePreset && activePreset.regex !== inputEl.value) {
        presetSelectEl.value = '';
      }
    }
  });
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

if (zoomInBtn) {
  zoomInBtn.addEventListener('click', () => {
    if (!currentContentRect || !canvasEl) return;
    currentViewportMode = 'manual';
    const center = { x: (canvasEl.clientWidth || 800) / 2, y: (canvasEl.clientHeight || 500) / 2 };
    const limits = getEffectiveLimits(currentFitZoom ?? undefined);
    currentViewport = zoomAt(currentViewport, 1.2, center, limits);
    applyViewport();
  });
}

if (zoomOutBtn) {
  zoomOutBtn.addEventListener('click', () => {
    if (!currentContentRect || !canvasEl) return;
    currentViewportMode = 'manual';
    const center = { x: (canvasEl.clientWidth || 800) / 2, y: (canvasEl.clientHeight || 500) / 2 };
    const limits = getEffectiveLimits(currentFitZoom ?? undefined);
    currentViewport = zoomAt(currentViewport, 1 / 1.2, center, limits);
    applyViewport();
  });
}

if (zoomFitBtn) {
  zoomFitBtn.addEventListener('click', () => {
    if (!currentContentRect || !canvasEl) return;
    currentViewportMode = 'fit';
    const containerRect: Rect = { width: canvasEl.clientWidth || 800, height: canvasEl.clientHeight || 500 };
    const fit = fitToContainer(currentContentRect, containerRect);
    const limits = getEffectiveLimits(fit.zoom);
    currentViewport = { zoom: clampZoom(fit.zoom, limits), panX: fit.panX, panY: fit.panY };
    applyViewport();
  });
}

if (zoomResetBtn) {
  zoomResetBtn.addEventListener('click', () => {
    if (!currentContentRect || !canvasEl) return;
    currentViewportMode = 'manual';
    const panX = ((canvasEl.clientWidth || 800) - currentContentRect.width) / 2;
    const panY = ((canvasEl.clientHeight || 500) - currentContentRect.height) / 2;
    currentViewport = { zoom: 1.0, panX, panY };
    applyViewport();
  });
}

let isDragging = false;
let lastPointerX = 0;
let lastPointerY = 0;

if (canvasEl) {
  canvasEl.addEventListener('wheel', (e: WheelEvent) => {
    if (!currentContentRect) return;

    const isZoom = e.ctrlKey || e.metaKey;
    const isHorizontalPan = Math.abs(e.deltaX) > Math.abs(e.deltaY);
    const isShiftPan = e.shiftKey;

    if (isZoom) {
      e.preventDefault();
      currentViewportMode = 'manual';
      const rect = canvasEl.getBoundingClientRect();
      const focal = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_K);
      const limits = getEffectiveLimits(currentFitZoom ?? undefined);
      currentViewport = zoomAt(currentViewport, factor, focal, limits);
      applyViewport();
    } else if (isHorizontalPan || isShiftPan) {
      e.preventDefault();
      currentViewportMode = 'manual';
      const deltaX = isShiftPan ? (e.deltaY !== 0 ? -e.deltaY : -e.deltaX) : -e.deltaX;
      currentViewport = panBy(currentViewport, { dx: deltaX, dy: 0 });
      applyViewport();
    }
  }, { passive: false });

  canvasEl.addEventListener('pointerdown', (e: PointerEvent) => {
    if (!currentContentRect) return;
    if (!e.isPrimary || e.button !== 0 || e.pointerType === 'touch') return;
    isDragging = true;
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
    canvasEl.setPointerCapture(e.pointerId);
    canvasEl.style.cursor = 'grabbing';
    e.preventDefault();
  });

  canvasEl.addEventListener('pointermove', (e: PointerEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - lastPointerX;
    const dy = e.clientY - lastPointerY;
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
    currentViewportMode = 'manual';
    currentViewport = panBy(currentViewport, { dx, dy });
    applyViewport();
  });

  const endDrag = (e: PointerEvent) => {
    if (!isDragging) return;
    isDragging = false;
    canvasEl.style.cursor = 'grab';
    try {
      canvasEl.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  canvasEl.addEventListener('pointerup', endDrag);
  canvasEl.addEventListener('pointercancel', endDrag);

  canvasEl.addEventListener('keydown', (e: KeyboardEvent) => {
    if (!currentContentRect) return;

    if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      if (zoomInBtn && !zoomInBtn.disabled) zoomInBtn.click();
    } else if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      if (zoomOutBtn && !zoomOutBtn.disabled) zoomOutBtn.click();
    } else if (e.key === '0') {
      e.preventDefault();
      if (zoomResetBtn && !zoomResetBtn.disabled) zoomResetBtn.click();
    } else if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      if (zoomFitBtn && !zoomFitBtn.disabled) zoomFitBtn.click();
    } else if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      currentViewportMode = 'manual';
      const frameW = canvasEl.clientWidth || 800;
      const frameH = canvasEl.clientHeight || 500;
      let dx = 0;
      let dy = 0;
      if (e.key === 'ArrowLeft') dx = frameW * 0.1;
      else if (e.key === 'ArrowRight') dx = -frameW * 0.1;
      else if (e.key === 'ArrowUp') dy = frameH * 0.1;
      else if (e.key === 'ArrowDown') dy = -frameH * 0.1;
      currentViewport = panBy(currentViewport, { dx, dy });
      applyViewport();
    }
  });
}

window.addEventListener('keydown', (e: KeyboardEvent) => {
  const target = e.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
    return;
  }
  if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) {
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
updateToolbarButtonStates();

if (runSuiteBtn && suiteTableEl) {
  runSuiteBtn.addEventListener('click', () => {
    const results = runBuiltinSuite();
    const tbody = suiteTableEl.querySelector('tbody');
    if (tbody) {
      tbody.innerHTML = '';
      for (const r of results) {
        const tr = document.createElement('tr');
        tr.setAttribute('data-id', r.id);
        tr.setAttribute('data-verdict', r.pass ? 'PASS' : 'FAIL');
        tr.className = r.pass ? 'row-pass' : 'row-fail';

        const tdId = document.createElement('td');
        tdId.textContent = r.id;

        const tdSource = document.createElement('td');
        tdSource.textContent = r.source;

        const tdNotation = document.createElement('td');
        tdNotation.textContent = r.notation;

        const tdExpected = document.createElement('td');
        tdExpected.textContent = r.expected;

        const tdGenerated = document.createElement('td');
        tdGenerated.textContent = r.generated;

        const tdVerdict = document.createElement('td');
        tdVerdict.textContent = r.pass ? 'PASS' : 'FAIL';
        tdVerdict.className = r.pass ? 'badge-pass' : 'badge-fail';

        tr.appendChild(tdId);
        tr.appendChild(tdSource);
        tr.appendChild(tdNotation);
        tr.appendChild(tdExpected);
        tr.appendChild(tdGenerated);
        tr.appendChild(tdVerdict);

        tbody.appendChild(tr);
      }
    }
  });
}

if (diffRunBtn) {
  diffRunBtn.addEventListener('click', async () => {
    if (!currentAnalysis) {
      if (diffStatusEl) {
        diffStatusEl.textContent = 'Please build an expression first.';
      }
      return;
    }

    const gen = ++diffGeneration;
    diffIsActive = true;
    diffRunBtn.disabled = true;
    if (stressRunBtn) {
      stressRunBtn.disabled = true;
    }

    try {
      const activeAlphabet = userEditedAlphabet ?? currentAnalysis.alphabet;
      const k = computeDifferentialK(activeAlphabet.length);
      const strings = allStrings(activeAlphabet, k);

      if (diffStatusEl) {
        diffStatusEl.textContent = `Running differential test: k = ${k} (${strings.length.toLocaleString()} strings) over alphabet {${activeAlphabet.join(', ')}}...`;
      }
      if (diffResultsEl) {
        diffResultsEl.innerHTML = '';
      }

      // Yield to allow UI update
      await new Promise((r) => setTimeout(r, 10));
      if (gen !== diffGeneration) return;

      // Run RegExp oracle in Web Worker with 2,000ms cap
      const jsPattern = toJs(currentAnalysis.parseTree);
      const regExpRes = await runRegExpInWorker(jsPattern, strings, 2000);
      if (gen !== diffGeneration) return;

      // Yield to prevent UI freezing
      await new Promise((r) => setTimeout(r, 0));
      if (gen !== diffGeneration) return;

      const diffResult = runDifferential(currentAnalysis.nfa, currentAnalysis.parseTree, activeAlphabet, {
        k,
        regExpResult: regExpRes
      });
      if (gen !== diffGeneration) return;

      let statusSummary = '';
      const oraclesList = Object.values(diffResult.oracles);
      if (oraclesList.some((o) => o.status === 'error')) {
        statusSummary = 'ORACLE ERROR';
      } else if (diffResult.allPassed) {
        if (diffResult.oracles.regExp.status === 'skipped (timeout)') {
          statusSummary = 'ALL PASSED (RegExp oracle skipped: timeout)';
        } else {
          statusSummary = 'ALL PASSED';
        }
      } else {
        statusSummary = 'MISMATCH DETECTED';
      }

      if (diffStatusEl) {
        diffStatusEl.textContent = `Differential test completed for k = ${k} (${diffResult.totalStrings.toLocaleString()} strings tested): ${statusSummary}`;
      }

      if (diffResultsEl) {
        const regExpStatus = diffResult.oracles.regExp.status;
        const regExpBadgeClass =
          regExpStatus === 'pass'
            ? 'badge-pass'
            : regExpStatus === 'skipped (timeout)'
              ? 'badge-skipped'
              : 'badge-fail';

        diffResultsEl.innerHTML = `
          <div class="diff-oracle-row" data-oracle="enumerator">
            <strong>${diffResult.oracles.enumerator.name}:</strong>
            <span class="badge ${diffResult.oracles.enumerator.status === 'pass' ? 'badge-pass' : 'badge-fail'}">${diffResult.oracles.enumerator.status.toUpperCase()}</span>
            (${diffResult.oracles.enumerator.testedCount.toLocaleString()} strings)
          </div>
          <div class="diff-oracle-row" data-oracle="derivatives">
            <strong>${diffResult.oracles.derivatives.name}:</strong>
            <span class="badge ${diffResult.oracles.derivatives.status === 'pass' ? 'badge-pass' : 'badge-fail'}">${diffResult.oracles.derivatives.status.toUpperCase()}</span>
            (${diffResult.oracles.derivatives.testedCount.toLocaleString()} strings)
          </div>
          <div class="diff-oracle-row" data-oracle="regExp">
            <strong>${diffResult.oracles.regExp.name}:</strong>
            <span class="badge ${regExpBadgeClass}">${regExpStatus}</span>
            (${diffResult.oracles.regExp.testedCount.toLocaleString()} strings)
          </div>
          <div class="diff-mismatches-summary">
            ${
              diffResult.mismatches.length === 0
                ? '<p class="mismatches-none">No mismatches found.</p>'
                : `<p class="mismatches-found">Mismatches found (${diffResult.mismatches.length}): <code>${diffResult.mismatches.slice(0, 20).join(', ')}</code></p>`
            }
          </div>
        `;
      }
    } finally {
      diffIsActive = false;
      diffRunBtn.disabled = stressIsActive;
      if (stressRunBtn && !stressIsActive) {
        stressRunBtn.disabled = false;
      }
    }
  });
}

// -------------------------------------------------------------
// Stress Panel Controller
// -------------------------------------------------------------
const stressBrowserInfoEl = document.getElementById('stress-browser-info');
if (stressBrowserInfoEl) {
  const info = detectBrowserEngine(typeof navigator !== 'undefined' ? navigator.userAgent : '');
  stressBrowserInfoEl.textContent = `Browser engine: ${info.label}`;
}

const stressChartContainer = document.getElementById('stress-chart-container');
const stressScaleToggleBtn = document.getElementById('stress-scale-toggle') as HTMLButtonElement | null;
const stressCancelBtn = document.getElementById('stress-cancel') as HTMLButtonElement | null;
const stressFamilySelect = document.getElementById('stress-family') as HTMLSelectElement | null;
const stressTableBody = document.querySelector('#stress-table tbody') as HTMLElement | null;
const stressStatusEl = document.getElementById('stress-status');
const stressCopyCsvBtn = document.getElementById('stress-copy-csv') as HTMLButtonElement | null;
const stressCopyStatusEl = document.getElementById('stress-copy-status');
const stressExportSvgBtn = document.getElementById('stress-export-svg') as HTMLButtonElement | null;

let currentStressScale: 'linear' | 'log' = 'linear';

let stressCancelled = false;
let stressGeneration = 0;
let currentStressRows: StressRow[] = [];

function updateStressActionButtons() {
  const hasRows = currentStressRows.length > 0;
  if (stressCopyCsvBtn) {
    stressCopyCsvBtn.disabled = !hasRows;
  }
  if (stressExportSvgBtn) {
    stressExportSvgBtn.disabled = !hasRows;
  }
}

updateStressActionButtons();

let copyStatusTimer: ReturnType<typeof setTimeout> | null = null;

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback to execCommand
    }
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '-9999px';
    textarea.setAttribute('readonly', '');
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

if (stressCopyCsvBtn) {
  stressCopyCsvBtn.addEventListener('click', async () => {
    if (currentStressRows.length === 0) return;
    const csv = formatStressCsv(currentStressRows);
    const success = await copyTextToClipboard(csv);

    if (stressCopyStatusEl) {
      if (copyStatusTimer !== null) {
        clearTimeout(copyStatusTimer);
        copyStatusTimer = null;
      }

      if (success) {
        stressCopyStatusEl.textContent = 'Copied!';
        stressCopyStatusEl.setAttribute('data-copied', 'true');
      } else {
        stressCopyStatusEl.textContent = 'Copy failed';
        stressCopyStatusEl.setAttribute('data-copied', 'false');
      }

      copyStatusTimer = setTimeout(() => {
        if (stressCopyStatusEl) {
          stressCopyStatusEl.textContent = '';
          stressCopyStatusEl.removeAttribute('data-copied');
        }
        copyStatusTimer = null;
      }, 2000);
    }
  });
}

function stressRowsToChartPoints(rows: StressRow[]): StressChartPoint[] {
  return rows.map((r) => ({
    n: r.n,
    regExpTime:
      r.regExpVerdict === 'TIMEOUT'
        ? 8000
        : r.regExpVerdict === 'SKIPPED' || r.regExpVerdict === 'ERROR'
        ? null
        : r.regExpTimeMs,
    regExpTimeout: r.regExpVerdict === 'TIMEOUT',
    nfaTime: r.nfaTimeMs
  }));
}

function updateStressChart() {
  if (!stressChartContainer) return;
  stressChartContainer.setAttribute('data-scale', currentStressScale);
  const familyId = stressFamilySelect ? stressFamilySelect.value : 'star-star-b';
  const family = STRESS_FAMILIES[familyId] || STRESS_FAMILIES['star-star-b'];
  const title = currentStressRows.length > 0
    ? `${family.name} - Backtracking vs Thompson NFA`
    : undefined;
  stressChartContainer.innerHTML = renderStressChartSvg(
    stressRowsToChartPoints(currentStressRows),
    {
      title,
      scale: currentStressScale
    }
  );
}

if (stressChartContainer) {
  stressChartContainer.setAttribute('data-scale', currentStressScale);
  stressChartContainer.innerHTML = renderStressChartSvg([], {
    scale: currentStressScale
  });
}

if (stressScaleToggleBtn) {
  stressScaleToggleBtn.addEventListener('click', () => {
    currentStressScale = currentStressScale === 'linear' ? 'log' : 'linear';
    stressScaleToggleBtn.setAttribute('aria-pressed', String(currentStressScale === 'log'));
    updateStressChart();
  });
}

function renderStressTableRow(row: StressRow): HTMLTableRowElement {
  const tr = document.createElement('tr');
  const regExpTimeDisplay =
    row.regExpVerdict === 'TIMEOUT'
      ? '> 8,000 ms (timeout)'
      : row.regExpVerdict === 'SKIPPED'
      ? '— (skipped)'
      : row.regExpVerdict === 'ERROR'
      ? 'Error'
      : row.regExpTimeMs !== null
      ? `${row.regExpTimeMs.toFixed(1)} ms`
      : '—';

  const regExpVerdictDisplay =
    row.regExpVerdict === 'SKIPPED' ? '—' : row.regExpVerdict;

  tr.innerHTML = `
    <td>${row.n}</td>
    <td>${row.inputLength}</td>
    <td>${regExpTimeDisplay}</td>
    <td>${row.nfaTimeMs.toFixed(2)} ms</td>
    <td>${regExpVerdictDisplay}</td>
    <td>${row.nfaVerdict}</td>
  `;
  return tr;
}

if (stressCancelBtn) {
  stressCancelBtn.addEventListener('click', () => {
    stressCancelled = true;
    if (activeWorkerOwner === 'stress') {
      resetWorker();
    }
    if (stressStatusEl) {
      stressStatusEl.textContent = 'Stress test cancelling...';
    }
  });
}

if (stressRunBtn) {
  stressRunBtn.addEventListener('click', async () => {
    stressCancelled = false;
    const gen = ++stressGeneration;
    stressIsActive = true;
    currentStressRows = [];
    updateStressActionButtons();
    stressRunBtn.disabled = true;
    if (diffRunBtn) {
      diffRunBtn.disabled = true;
    }
    if (stressFamilySelect) {
      stressFamilySelect.disabled = true;
    }
    if (stressCancelBtn) {
      stressCancelBtn.style.display = 'inline-block';
    }
    if (stressTableBody) {
      stressTableBody.innerHTML = '';
    }

    const familyId = stressFamilySelect ? stressFamilySelect.value : 'star-star-b';
    const family = STRESS_FAMILIES[familyId] || STRESS_FAMILIES['star-star-b'];

    const analysis = analyze(family.expression, { notation: family.notation });
    const jsPattern = analysis.ok ? toJs(analysis.parseTree) : family.expression;

    let regExpStopped = false;

    if (stressChartContainer) {
      updateStressChart();
    }

    try {
      // 1. Series n = 12..30 in steps of 2
      for (const n of STRESS_N_SERIES) {
        if (stressCancelled || gen !== stressGeneration) break;
        if (stressStatusEl) {
          stressStatusEl.textContent = `Testing n = ${n}...`;
        }

        const input = family.generateInput(n);
        await new Promise((r) => setTimeout(r, 0));
        if (stressCancelled || gen !== stressGeneration) break;

        // Run NFA
        const nfaRes = runStressNfa(family.id, n);

        // Run RegExp (in worker, 8s cap)
        let regExpDurationMs: number | null = null;
        let regExpVerdict: RegExpVerdict = 'SKIPPED';

        if (!regExpStopped) {
          const t0 = performance.now();
          const res = await runRegExpInWorker(jsPattern, [input], 8000, 'stress');
          const elapsed = performance.now() - t0;

          if (stressCancelled || gen !== stressGeneration || res.cancelled) {
            break;
          }

          if (res.timeout || elapsed >= 8000) {
            regExpStopped = true;
            regExpDurationMs = 8000;
            regExpVerdict = 'TIMEOUT';
          } else if (res.error) {
            regExpVerdict = 'ERROR';
          } else {
            regExpDurationMs = elapsed;
            const matched = res.matches && res.matches[0];
            regExpVerdict = matched ? 'ACCEPT' : 'REJECT';
          }
        } else {
          regExpVerdict = 'SKIPPED';
        }

        const row: StressRow = {
          family: family.id,
          n,
          inputLength: input.length,
          regExpTimeMs: regExpDurationMs,
          regExpVerdict,
          nfaTimeMs: nfaRes.durationMs,
          nfaVerdict: nfaRes.verdict
        };
        currentStressRows.push(row);
        updateStressActionButtons();

        if (stressTableBody && gen === stressGeneration) {
          stressTableBody.appendChild(renderStressTableRow(row));
        }

        if (stressChartContainer && gen === stressGeneration) {
          updateStressChart();
        }

        await new Promise((r) => setTimeout(r, 0));
      }

      // 2. Scale NFA series up to 1,000
      for (const n of STRESS_SCALE_N_SERIES) {
        if (stressCancelled || gen !== stressGeneration) break;
        if (stressStatusEl) {
          stressStatusEl.textContent = `Testing NFA scale n = ${n}...`;
        }

        const input = family.generateInput(n);
        await new Promise((r) => setTimeout(r, 0));
        if (stressCancelled || gen !== stressGeneration) break;

        const nfaRes = runStressNfa(family.id, n);

        if (stressCancelled || gen !== stressGeneration) break;

        const row: StressRow = {
          family: family.id,
          n,
          inputLength: input.length,
          regExpTimeMs: null,
          regExpVerdict: 'SKIPPED',
          nfaTimeMs: nfaRes.durationMs,
          nfaVerdict: nfaRes.verdict
        };
        currentStressRows.push(row);
        updateStressActionButtons();

        if (stressTableBody && gen === stressGeneration) {
          stressTableBody.appendChild(renderStressTableRow(row));
        }

        if (stressChartContainer && gen === stressGeneration) {
          updateStressChart();
        }

        await new Promise((r) => setTimeout(r, 0));
      }

      if (gen === stressGeneration && stressStatusEl) {
        stressStatusEl.textContent = stressCancelled
          ? 'Stress test cancelled.'
          : 'Stress test complete: NFA completed all inputs up to n = 1,000 in linear time.';
      }
    } finally {
      stressIsActive = false;
      updateStressActionButtons();
      if (gen === stressGeneration) {
        stressRunBtn.disabled = diffIsActive;
        if (stressFamilySelect) {
          stressFamilySelect.disabled = false;
        }
        if (stressCancelBtn) {
          stressCancelBtn.style.display = 'none';
        }
        if (diffRunBtn && !diffIsActive) {
          diffRunBtn.disabled = false;
        }
      }
    }
  });
}
