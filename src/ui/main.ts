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
  CheckResult,
  PRESETS
} from '../engine/index';
import { toDot, VizRenderer, computeMasterLayout, checkDiagramCap, type DiagramOptions } from '../diagram/index';
import { formatStandaloneSvg, getExportFilename } from './export';
import { encodeAppState, decodeAppState, type AppUrlState } from './url';
import { formatBuildStamp } from './stamp';
import { initTheme } from './theme';
import { syncScrubberState, wireScrubber } from './scrubber';
import {
  renderParseTree,
  renderPostfixTimeline,
  updatePostfixTimelineActive,
  renderRawTokens,
  formatPostfixText
} from './parse-view';
import {
  renderStepLog as renderStepLogModule,
  updateStepLogActive,
  renderTransitionTable as renderTransitionTableModule,
  updateTableActiveStates,
  exportTableCsv,
  renderFragmentStack
} from './step-table-view';
import { formatDockSummary, renderTraceCards } from './test-dock';
import { initValidationController, updateSummaryStrip } from './validation-view';
import { initStressController, copyTextToClipboard, showTransientStatus } from './stress-controller';
import {
  initLegend,
  isLegendOpen,
  closeLegend,
  formatPresetDescription
} from './overlays';
import { attachTouchGestures } from './canvas-touch';
import { typesetRegex, updateRegexMirror } from './typeset-regex';
import { PageRoute, parseRoute, formatRoute, isLegacyAlias, getRouteTitle } from './router';
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
import { normalizeStateLabels, computeStateCreators } from './state-labels';
import { FullscreenManager } from './fullscreen';
import InlineWorker from './worker.ts?worker&inline';

const renderer = new VizRenderer();
(window as any).VizRenderer = VizRenderer;
let currentAnalysis: AnalysisSuccess | null = null;
let userEditedAlphabet: string[] | null = null;
let buildGeneration = 0;
let stepGeneration = 0;
let currentStepIndex = 1;
let currentView: 'flat' | 'final' = 'flat';
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
const regexMirrorEl = document.getElementById('regex-mirror');
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
const zoomInBtn = document.getElementById('zoom-in-btn') as HTMLButtonElement | null;
const zoomOutBtn = document.getElementById('zoom-out-btn') as HTMLButtonElement | null;
const zoomFitBtn = document.getElementById('zoom-fit-btn') as HTMLButtonElement | null;
const zoomResetBtn = document.getElementById('zoom-reset-btn') as HTMLButtonElement | null;
const zoomLevelEl = document.getElementById('zoom-level');
const exportSvgBtn = document.getElementById('export-svg-btn') as HTMLButtonElement | null;
const copyLinkBtn = document.getElementById('copy-link-btn') as HTMLButtonElement | null;
const copyLinkStatusEl = document.getElementById('copy-link-status');
const linkNoticeEl = document.getElementById('link-notice');
const buildStampEl = document.getElementById('build-stamp');
if (buildStampEl) {
  buildStampEl.textContent = formatBuildStamp();
}
initTheme();
const legendBtn = document.getElementById('legend-btn') as HTMLButtonElement | null;
const legendEl = document.getElementById('canvas-legend');
const legendCloseBtn = document.getElementById('legend-close') as HTMLButtonElement | null;
if (legendBtn && legendEl) {
  initLegend(legendBtn, legendEl, legendCloseBtn);
}
const keyboardHelpBtn = document.getElementById('keyboard-help-btn') as HTMLButtonElement | null;
const keyboardHelpDialog = document.getElementById('keyboard-help-dialog') as HTMLDialogElement | null;
const keyboardHelpClose = document.getElementById('keyboard-help-close') as HTMLButtonElement | null;
let lastHelpOpener: HTMLElement | null = null;

function openKeyboardHelp(opener?: HTMLElement | null): void {
  if (!keyboardHelpDialog || keyboardHelpDialog.open) return;
  lastHelpOpener = opener ?? (document.activeElement as HTMLElement | null);
  keyboardHelpDialog.showModal();
}

function closeKeyboardHelp(): void {
  if (!keyboardHelpDialog || !keyboardHelpDialog.open) return;
  const opener = lastHelpOpener;
  lastHelpOpener = null;
  keyboardHelpDialog.close();
  if (opener && typeof opener.focus === 'function') {
    opener.focus();
  }
}
let currentDot: string | null = null;
let copyLinkTimer: ReturnType<typeof setTimeout> | null = null;

let currentRoute: PageRoute = 'workbench';
let pendingFitOnWorkbenchVisible = false;

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

function recomputeFit(): void {
  if (!currentContentRect || !canvasEl) return;
  currentViewportMode = 'fit';
  const containerRect: Rect = { width: canvasEl.clientWidth || 800, height: canvasEl.clientHeight || 500 };
  const fit = fitToContainer(currentContentRect, containerRect);
  const limits = getEffectiveLimits(fit.zoom);
  currentViewport = { zoom: clampZoom(fit.zoom, limits), panX: fit.panX, panY: fit.panY };
  applyViewport();
}

const appEl = document.getElementById('app');
const canvasContainerEl = document.getElementById('canvas-container');
const stepperControlsEl = document.getElementById('stepper-controls');
const tablePanelEl = document.querySelector('.table-panel') as HTMLElement | null;
const fullscreenBtn = document.getElementById('fullscreen-btn') as HTMLButtonElement | null;
const exitFullscreenBtn = document.getElementById('exit-fullscreen-btn') as HTMLButtonElement | null;
const fullscreenTableBtn = document.getElementById('fullscreen-table-btn') as HTMLButtonElement | null;
const fullscreenTableCloseBtn = document.getElementById('fullscreen-table-close-btn') as HTMLButtonElement | null;
const fullscreenOverlayEl = document.getElementById('fullscreen-overlay');
const fullscreenTableDrawerEl = document.getElementById('fullscreen-table-drawer');
const fullscreenCanvasSlotEl = document.getElementById('fullscreen-canvas-slot');
const fullscreenStepperSlotEl = document.getElementById('fullscreen-stepper-slot');
const fullscreenTableSlotEl = document.getElementById('fullscreen-table-slot');
const fullscreenRegexEl = document.getElementById('fullscreen-regex');

function syncRegexInput(): void {
  if (inputEl && regexMirrorEl) {
    updateRegexMirror(inputEl, regexMirrorEl);
  }
  if (fullscreenRegexEl && fullscreenManager?.isActive()) {
    if (typeof fullscreenRegexEl.replaceChildren === 'function') {
      fullscreenRegexEl.replaceChildren(typesetRegex(inputEl ? inputEl.value : ''));
    } else {
      fullscreenRegexEl.textContent = '';
      fullscreenRegexEl.appendChild(typesetRegex(inputEl ? inputEl.value : ''));
    }
  }
}

let fullscreenManager: FullscreenManager | null = null;
if (
  fullscreenOverlayEl &&
  appEl &&
  canvasContainerEl &&
  stepperControlsEl &&
  tablePanelEl &&
  fullscreenBtn &&
  exitFullscreenBtn &&
  fullscreenTableBtn &&
  fullscreenTableDrawerEl &&
  fullscreenCanvasSlotEl &&
  fullscreenStepperSlotEl &&
  fullscreenTableSlotEl
) {
  fullscreenManager = new FullscreenManager(
    {
      overlayEl: fullscreenOverlayEl,
      appEl,
      canvasContainerEl,
      stepperControlsEl,
      tablePanelEl,
      fullscreenBtn,
      exitBtn: exitFullscreenBtn,
      tableToggleBtn: fullscreenTableBtn,
      tableCloseBtn: fullscreenTableCloseBtn,
      tableDrawerEl: fullscreenTableDrawerEl,
      canvasSlot: fullscreenCanvasSlotEl,
      stepperSlot: fullscreenStepperSlotEl,
      tableSlot: fullscreenTableSlotEl,
      regexDisplayEl: fullscreenRegexEl
    },
    {
      getRegexText: () => (inputEl ? inputEl.value : ''),
      isModeFit: () => currentViewportMode === 'fit',
      recomputeFit: () => {
        recomputeFit();
      }
    }
  );
}

function updateValidationPageState(): void {
  const summaryEl = document.getElementById('validation-active-summary');
  const emptyStateEl = document.getElementById('validation-empty-state');
  const stripEl = document.getElementById('validation-summary-strip');
  const invEl = document.getElementById('invariants-section');
  const diffEl = document.getElementById('differential-section');

  if (currentAnalysis) {
    if (summaryEl) {
      const expr = inputEl ? inputEl.value : '';
      const notat = notationSelectEl ? notationSelectEl.value : 'standard';
      const concat = concatSelectEl ? concatSelectEl.value : 'epsilon-link';
      summaryEl.style.display = '';
      if (typeof summaryEl.replaceChildren === 'function') {
        summaryEl.replaceChildren(
          document.createTextNode('Validating: '),
          typesetRegex(expr),
          document.createTextNode(` · ${notat} notation · ${concat} concatenation`)
        );
      } else {
        summaryEl.textContent = 'Validating: ';
        summaryEl.appendChild(typesetRegex(expr));
        summaryEl.appendChild(document.createTextNode(` · ${notat} notation · ${concat} concatenation`));
      }
    }
    if (emptyStateEl) emptyStateEl.style.display = 'none';
    if (stripEl) stripEl.style.display = '';
    if (invEl) invEl.style.display = '';
    if (diffEl) diffEl.style.display = '';
  } else {
    if (summaryEl) {
      summaryEl.style.display = 'none';
      summaryEl.textContent = '';
    }
    if (emptyStateEl) emptyStateEl.style.display = '';
    if (stripEl) stripEl.style.display = 'none';
    if (invEl) invEl.style.display = 'none';
    if (diffEl) diffEl.style.display = 'none';
  }
}

function showPage(route: PageRoute, options?: { isInitialLoad?: boolean }): void {
  currentRoute = route;

  const pageWorkbench = document.getElementById('page-workbench');
  const pageValidation = document.getElementById('page-validation');
  const pageStress = document.getElementById('page-stress');

  if (pageWorkbench) {
    if (route === 'workbench') pageWorkbench.removeAttribute('hidden');
    else pageWorkbench.setAttribute('hidden', '');
  }
  if (pageValidation) {
    if (route === 'validation') pageValidation.removeAttribute('hidden');
    else pageValidation.setAttribute('hidden', '');
  }
  if (pageStress) {
    if (route === 'stress') pageStress.removeAttribute('hidden');
    else pageStress.setAttribute('hidden', '');
  }

  const navLinks = document.querySelectorAll<HTMLAnchorElement>('.app-nav .nav-link');
  navLinks.forEach((link) => {
    const href = link.getAttribute('href') || '';
    const linkRoute = parseRoute(href);
    if (linkRoute === route) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });

  document.title = getRouteTitle(route);

  if (!options?.isInitialLoad) {
    window.scrollTo({ top: 0, behavior: 'instant' });
    const liveRegionEl = document.getElementById('live-region');
    if (liveRegionEl) {
      const routeNames: Record<PageRoute, string> = {
        workbench: 'Workbench',
        validation: 'Validation',
        stress: 'Stress Test'
      };
      liveRegionEl.textContent = `Navigated to ${routeNames[route]} page`;
    }
    const headingId = route === 'workbench'
      ? 'workbench-page-heading'
      : route === 'validation'
        ? 'validation-page-heading'
        : 'stress-page-heading';
    const heading = document.getElementById(headingId);
    if (heading) {
      heading.focus();
    }
  }

  if (route === 'workbench') {
    if (pendingFitOnWorkbenchVisible && currentContentRect && currentViewBox && canvasEl) {
      const containerRect: Rect = {
        width: canvasEl.clientWidth || 800,
        height: canvasEl.clientHeight || 500
      };
      const fit = fitToContainer(currentContentRect, containerRect);
      currentFitZoom = fit.zoom;
      const init = initialView(currentContentRect, containerRect);
      currentViewport = { zoom: init.zoom, panX: init.panX, panY: init.panY };
      currentViewportMode = init.mode;
      applyViewport();
      pendingFitOnWorkbenchVisible = false;
    } else if (currentViewportMode === 'fit' && currentContentRect && canvasEl) {
      const containerRect: Rect = {
        width: canvasEl.clientWidth || 800,
        height: canvasEl.clientHeight || 500
      };
      const fit = fitToContainer(currentContentRect, containerRect);
      currentFitZoom = fit.zoom;
      currentViewport = { zoom: fit.zoom, panX: fit.panX, panY: fit.panY };
      applyViewport();
    }
  }

  updateValidationPageState();
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

  const isCanvasVisible = canvasEl && canvasEl.clientWidth > 0 && canvasEl.clientHeight > 0;
  if (!isCanvasVisible) {
    pendingFitOnWorkbenchVisible = true;
    currentContentRect = newRect;
    currentViewBox = newViewBox;
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
const dockSummaryEl = document.getElementById('dock-summary');
const testDockToggleBtn = document.getElementById('test-dock-toggle') as HTMLButtonElement | null;
const testDockEl = document.getElementById('test-dock');
const traceEmptyHintEl = document.getElementById('trace-empty-hint');
if (testDockToggleBtn && testDockEl) {
  testDockToggleBtn.addEventListener('click', () => {
    const isCollapsed = testDockEl.classList.toggle('collapsed');
    testDockToggleBtn.setAttribute('aria-expanded', String(!isCollapsed));
  });
}
if (testInputEl) {
  testInputEl.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (runButtonEl) {
        runButtonEl.click();
      }
    }
  });
}
const errorEl = document.getElementById('error-message');
const layoutNoteEl = document.getElementById('layout-note');
const runStatusEl = document.getElementById('run-status');
const stepFirstBtn = document.getElementById('step-first') as HTMLButtonElement | null;
const stepPrevBtn = document.getElementById('step-prev') as HTMLButtonElement | null;
const stepPlayBtn = document.getElementById('step-play') as HTMLButtonElement | null;
const stepNextBtn = document.getElementById('step-next') as HTMLButtonElement | null;
const stepLastBtn = document.getElementById('step-last') as HTMLButtonElement | null;
const stepCounterEl = document.getElementById('step-counter');
const stepScrubberEl = document.getElementById('step-scrubber') as HTMLInputElement | null;
function updateScrubberDisplay(): void {
  if (!stepScrubberEl) return;
  const totalSteps = currentAnalysis ? currentAnalysis.steps.length : 0;
  const isFinal = currentView === 'final';
  syncScrubberState(stepScrubberEl, currentStepIndex, totalSteps, isFinal);
}
if (stepScrubberEl) {
  wireScrubber(stepScrubberEl, (step) => {
    navigateToStep(step);
  });
}
const stepSpeedSelect = document.getElementById('step-speed') as HTMLSelectElement | null;
const viewToggleSelect = document.getElementById('view-toggle') as HTMLSelectElement | null;
const stepLogEl = document.getElementById('step-log');
const stepLogStatsEl = document.getElementById('step-log-stats');
const activeFragmentStackEl = document.getElementById('active-fragment-stack');
const tableStatsEl = document.getElementById('table-stats');
const copyTableCsvBtn = document.getElementById('copy-table-csv-btn') as HTMLButtonElement | null;
const copyTableCsvStatus = document.getElementById('copy-table-csv-status');
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
const numberingBadgeEl = document.getElementById('numbering-badge');
let diffIsActive = false;
let stressIsActive = false;

const validationController = initValidationController(
  {
    runSuiteBtn,
    suiteTableEl,
    suiteSummaryEl: document.getElementById('suite-summary'),
    summaryStripEl: document.getElementById('validation-summary-strip'),
    diffRunBtn,
    diffStatusEl,
    diffResultsEl,
    stressRunBtn,
    invI1El,
    invI2El,
    invI3El,
    invI4El,
    invSizeEl,
    invReplayEl
  },
  {
    getAnalysis: () => currentAnalysis,
    getUserEditedAlphabet: () => userEditedAlphabet,
    runRegExpInWorker,
    isStressActive: () => stressIsActive,
    onDiffActiveChange: (active) => {
      diffIsActive = active;
    }
  }
);

const stressController = initStressController(
  {
    stressBrowserInfoEl: document.getElementById('stress-browser-info'),
    stressChartContainer: document.getElementById('stress-chart-container'),
    stressScaleToggleBtn: document.getElementById('stress-scale-toggle') as HTMLButtonElement | null,
    stressCancelBtn: document.getElementById('stress-cancel') as HTMLButtonElement | null,
    stressFamilySelect: document.getElementById('stress-family') as HTMLSelectElement | null,
    stressTableBody: document.querySelector('#stress-table tbody') as HTMLElement | null,
    stressStatusEl: document.getElementById('stress-status'),
    stressCopyCsvBtn: document.getElementById('stress-copy-csv') as HTMLButtonElement | null,
    stressCopyStatusEl: document.getElementById('stress-copy-status'),
    stressExportSvgBtn: document.getElementById('stress-export-svg') as HTMLButtonElement | null,
    stressRunBtn,
    diffRunBtn,
    summaryStripEl: document.getElementById('validation-summary-strip')
  },
  {
    runRegExpInWorker,
    resetWorker,
    getActiveWorkerOwner: () => activeWorkerOwner,
    isDiffActive: () => diffIsActive,
    onStressActiveChange: (active) => {
      stressIsActive = active;
    }
  }
);
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
    if (preset.description) {
      opt.title = preset.description;
    }
    presetSelectEl.appendChild(opt);
  }
}

function isCompactLabels(): boolean {
  return !!compactLabelsEl?.checked;
}

function renderTransitionTable(container: HTMLElement, analysis: AnalysisSuccess): void {
  const labelMap = currentView === 'final' ? normalizeStateLabels(analysis.nfa) : undefined;
  renderTransitionTableModule(container, analysis, isCompactLabels(), labelMap);
  if (currentActiveStates) {
    updateTableActiveStates(container, currentActiveStates);
  }
}

function renderTokenList(container: HTMLElement, tokens: Token[]): void {
  renderRawTokens(container, tokens);
}

function renderTreeView(container: HTMLElement, tree: ParseNode): void {
  renderParseTree(container, tree, undefined, inputEl ? inputEl.value : '');
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
  syncRegexInput();
}

function clearResults(): void {
  stopPlayback();
  currentStepIndex = 0;
  currentActiveStates = null;
  if (tableEl) {
    updateTableActiveStates(tableEl, null);
  }
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
  if (dockSummaryEl) {
    dockSummaryEl.textContent = 'Not run';
  }
  if (traceEmptyHintEl) {
    traceEmptyHintEl.hidden = false;
  }
  if (verdictEl) {
    verdictEl.textContent = '';
  }
  if (tableEl) {
    tableEl.innerHTML = '';
    updateTableActiveStates(tableEl, null);
  }
  if (tokenListEl) {
    tokenListEl.textContent = '';
  }
  if (postfixEl) {
    postfixEl.textContent = '';
  }
  const postfixWellEl = document.getElementById('postfix-text-well');
  if (postfixWellEl) {
    postfixWellEl.textContent = '';
  }
  if (treeViewEl) {
    treeViewEl.textContent = '';
  }
  if (stepLogEl) {
    stepLogEl.textContent = '';
  }
  if (stepLogStatsEl) {
    stepLogStatsEl.textContent = '';
  }
  if (activeFragmentStackEl) {
    activeFragmentStackEl.textContent = '';
  }
  if (tableStatsEl) {
    tableStatsEl.textContent = '';
  }
  if (copyTableCsvBtn) {
    copyTableCsvBtn.disabled = true;
  }
  if (copyTableCsvStatus) {
    copyTableCsvStatus.textContent = '';
  }
  if (stepCounterEl) {
    stepCounterEl.textContent = 'step 0 / 0';
  }
  updateScrubberDisplay();

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
  currentDot = null;
  if (exportSvgBtn) exportSvgBtn.disabled = true;
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
  const summaryStripEl = document.getElementById('validation-summary-strip');
  if (summaryStripEl) {
    updateSummaryStrip(summaryStripEl, {});
  }
  const suiteSummaryEl = document.getElementById('suite-summary');
  if (suiteSummaryEl) {
    suiteSummaryEl.textContent = 'Not run';
  }
  if (diffStatusEl) diffStatusEl.textContent = '';
  if (diffResultsEl) diffResultsEl.innerHTML = '';

  currentAnalysis = null;
  updateValidationPageState();
}

function renderPostfixView(container: HTMLElement, tokens: Token[]): void {
  renderPostfixTimeline(container, tokens, currentStepIndex, (step) => {
    stopPlayback();
    navigateToStep(step);
  });
}

function renderStepLog(container: HTMLElement, steps: Step[]): void {
  renderStepLogModule(container, steps, currentStepIndex, (step) => {
    stopPlayback();
    navigateToStep(step);
  });
}

function attachStateHoverListeners(container: HTMLElement): void {
  const nodes = container.querySelectorAll('g.node');
  nodes.forEach((node) => {
    const aEl = node.querySelector('a');
    const tooltip = aEl?.getAttribute('xlink:title') || aEl?.getAttribute('title') || '';
    if (tooltip) {
      node.setAttribute('title', tooltip);
      node.setAttribute('aria-label', tooltip);
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
    currentView = 'flat';
    if (viewToggleSelect) {
      viewToggleSelect.value = currentView;
    }
  }
  currentActiveStates = null;
  if (tableEl) {
    updateTableActiveStates(tableEl, null);
  }
  isDeadRun = false;
  if (canvasEl) {
    canvasEl.removeAttribute('data-view');
    canvasEl.removeAttribute('data-run-status');
  }
  if (numberingBadgeEl) {
    numberingBadgeEl.style.display = 'inline-flex';
  }
  if (tableEl && currentAnalysis) {
    renderTransitionTable(tableEl, currentAnalysis);
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
    stepCounterEl.removeAttribute('title');
  }
  updateScrubberDisplay();

  const stepRecord = currentAnalysis.steps[targetStep - 1];
  if (stepRecord) {
    announceLive(`Step ${currentStepIndex} of ${totalSteps}: ${stepRecord.rule}`);
  }

  if (stepFirstBtn) {
    stepFirstBtn.disabled = currentStepIndex === 1;
    stepFirstBtn.removeAttribute('aria-disabled');
    stepFirstBtn.title = 'First step';
  }
  if (stepPrevBtn) {
    stepPrevBtn.disabled = currentStepIndex === 1;
    stepPrevBtn.removeAttribute('aria-disabled');
    stepPrevBtn.title = 'Previous step';
  }
  if (stepPlayBtn) {
    stepPlayBtn.disabled = false;
    stepPlayBtn.removeAttribute('aria-disabled');
    stepPlayBtn.title = playbackTimer !== null ? 'Pause' : 'Play';
  }
  if (stepNextBtn) {
    stepNextBtn.disabled = currentStepIndex === totalSteps;
    stepNextBtn.removeAttribute('aria-disabled');
    stepNextBtn.title = 'Next step';
  }
  if (stepLastBtn) {
    stepLastBtn.disabled = currentStepIndex === totalSteps;
    stepLastBtn.removeAttribute('aria-disabled');
    stepLastBtn.title = 'Last step';
  }
  if (stepScrubberEl) {
    stepScrubberEl.disabled = false;
    stepScrubberEl.removeAttribute('aria-disabled');
    stepScrubberEl.title = 'Step scrubber';
  }
  if (stepSpeedSelect) {
    stepSpeedSelect.disabled = false;
    stepSpeedSelect.removeAttribute('aria-disabled');
    stepSpeedSelect.title = 'Speed';
  }

  if (stepLogEl) {
    updateStepLogActive(stepLogEl, targetStep);
  }
  if (activeFragmentStackEl && stepRecord) {
    renderFragmentStack(activeFragmentStackEl, stepRecord.stackAfter);
  }

  if (postfixEl) {
    updatePostfixTimelineActive(postfixEl, targetStep);
  }

  const gen = ++stepGeneration;
  const bGen = buildGeneration;
  const cacheKey = `${currentView}-${targetStep}`;

  const snapshot = getStepSnapshot(currentAnalysis.steps, targetStep);
  let dot: string;
  let renderEngine: string | undefined;

  if (masterPositions && !layoutFailed) {
    dot = toDot(snapshot, { view: 'flat', pin: masterPositions, postfixCount: currentAnalysis.postfix.length });
    renderEngine = 'neato';
  } else {
    dot = toDot(snapshot, { view: 'flat', postfixCount: currentAnalysis.postfix.length });
    renderEngine = undefined;
  }

  if (stepSvgCache.has(cacheKey)) {
    currentDot = dot;
    if (exportSvgBtn) exportSvgBtn.disabled = false;
    if (canvasEl) {
      canvasEl.setAttribute('data-current-step', String(targetStep));
      setCanvasContent(stepSvgCache.get(cacheKey)!);
      attachStateHoverListeners(canvasEl);
    }
    return;
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
      currentDot = dot;
      if (exportSvgBtn) exportSvgBtn.disabled = false;
      setCanvasContent(result.svg);
      attachStateHoverListeners(canvasEl);
      if (bGen === buildGeneration) {
        stepSvgCache.set(cacheKey, result.svg);
      }
    } else {
      currentDot = null;
      if (exportSvgBtn) exportSvgBtn.disabled = true;
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
  if (numberingBadgeEl) {
    numberingBadgeEl.style.display = 'none';
  }
  if (tableEl && currentAnalysis) {
    renderTransitionTable(tableEl, currentAnalysis);
  }

  const mode = checkDiagramCap(currentAnalysis.postfix.length);
  if (mode === 'off') {
    currentDot = toDot(currentAnalysis.nfa, {
      compactLabels: isCompactLabels()
    });
    if (exportSvgBtn) exportSvgBtn.disabled = true;
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
    stepCounterEl.textContent = 'Final NFA';
    stepCounterEl.title = `Final NFA (${currentAnalysis.stats.states} states, ${currentAnalysis.stats.transitions} transitions)`;
  }
  updateScrubberDisplay();

  const disabledTitle = 'Switch to NFA view to step through construction';
  if (stepFirstBtn) {
    stepFirstBtn.disabled = false;
    stepFirstBtn.setAttribute('aria-disabled', 'true');
    stepFirstBtn.title = disabledTitle;
  }
  if (stepPrevBtn) {
    stepPrevBtn.disabled = false;
    stepPrevBtn.setAttribute('aria-disabled', 'true');
    stepPrevBtn.title = disabledTitle;
  }
  if (stepPlayBtn) {
    stepPlayBtn.disabled = true;
    stepPlayBtn.setAttribute('aria-disabled', 'true');
    stepPlayBtn.title = disabledTitle;
  }
  if (stepNextBtn) {
    stepNextBtn.disabled = false;
    stepNextBtn.setAttribute('aria-disabled', 'true');
    stepNextBtn.title = disabledTitle;
  }
  if (stepLastBtn) {
    stepLastBtn.disabled = false;
    stepLastBtn.setAttribute('aria-disabled', 'true');
    stepLastBtn.title = disabledTitle;
  }
  if (stepScrubberEl) {
    stepScrubberEl.disabled = true;
    stepScrubberEl.setAttribute('aria-disabled', 'true');
    stepScrubberEl.title = disabledTitle;
  }
  if (stepSpeedSelect) {
    stepSpeedSelect.disabled = true;
    stepSpeedSelect.setAttribute('aria-disabled', 'true');
    stepSpeedSelect.title = disabledTitle;
  }

  if (stepLogEl) {
    updateStepLogActive(stepLogEl, 0);
  }
  if (activeFragmentStackEl && currentAnalysis && currentAnalysis.steps.length > 0) {
    const lastStep = currentAnalysis.steps[currentAnalysis.steps.length - 1];
    renderFragmentStack(activeFragmentStackEl, lastStep.stackAfter);
  }

  if (postfixEl) {
    updatePostfixTimelineActive(postfixEl, 0);
  }

  const gen = ++stepGeneration;
  const bGen = buildGeneration;
  const compact = isCompactLabels();
  const activeStr = currentActiveStates ? currentActiveStates.join(',') : 'none';
  const cacheKey = `final-${compact}-${activeStr}`;

  const labelMap = normalizeStateLabels(currentAnalysis.nfa);
  const stateCreators = computeStateCreators(currentAnalysis.steps);
  const options: DiagramOptions = {
    compactLabels: compact,
    labelMap,
    stateCreators,
    ...(currentActiveStates ? { activeStates: currentActiveStates } : {})
  };

  if (masterPositions && !layoutFailed) {
    options.pin = masterPositions;
  }

  if (stepSvgCache.has(cacheKey)) {
    currentDot = toDot(currentAnalysis.nfa, options);
    if (exportSvgBtn) exportSvgBtn.disabled = false;
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
      labelMap,
      stateCreators,
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
      currentDot = dot;
      if (exportSvgBtn) exportSvgBtn.disabled = false;
      setCanvasContent(result.svg);
      attachStateHoverListeners(canvasEl);
      if (bGen === buildGeneration) {
        stepSvgCache.set(cacheKey, result.svg);
      }
    } else {
      currentDot = null;
      if (exportSvgBtn) exportSvgBtn.disabled = true;
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

async function handleBuild() {
  if (!inputEl) return;
  stopPlayback();
  currentViewBox = null;
  currentDot = null;
  if (exportSvgBtn) exportSvgBtn.disabled = true;
  const gen = ++buildGeneration;
  validationController.resetDiff();
  if (verdictEl) verdictEl.textContent = '';
  if (traceEl) traceEl.innerHTML = '';
  if (runStatusEl) {
    runStatusEl.textContent = '';
    runStatusEl.className = '';
  }
  currentActiveStates = null;
  if (tableEl) {
    updateTableActiveStates(tableEl, null);
  }
  isDeadRun = false;
  lastRunResults = null;
  lastRunLines = null;
  let source = inputEl.value;
  if (source.includes('^')) {
    source = source.replace(/\^\*/g, '*').replace(/\^/g, '*');
    inputEl.value = source;
  }

  const notation = notationSelectEl?.value === 'textbook' ? 'textbook' : 'standard';
  const concatenation = concatSelectEl?.value === 'merge' ? 'merge' : 'epsilon-link';

  let analysis = analyze(source, {
    notation,
    concatenation,
    ...(userEditedAlphabet ? { alphabet: userEditedAlphabet } : {})
  });

  // If a previously edited alphabet lacks a symbol required by the new expression, reset it
  if (!analysis.ok && analysis.code === 'INVALID_ALPHABET' && userEditedAlphabet && analysis.message.includes('Cannot remove symbol')) {
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
  updateValidationPageState();

  if (alphabetInputEl) {
    alphabetInputEl.value = analysis.alphabet.join(', ');
  }
  if (alphabetMessageEl) {
    alphabetMessageEl.textContent = '';
    alphabetMessageEl.className = 'grid-item-alphabet-message';
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

  const postfixWellEl = document.getElementById('postfix-text-well');
  if (postfixWellEl) {
    postfixWellEl.textContent = formatPostfixText(analysis.postfix);
  }

  if (treeViewEl) {
    renderTreeView(treeViewEl, analysis.parseTree);
  }

  if (tableEl) {
    renderTransitionTable(tableEl, analysis);
  }
  if (tableStatsEl) {
    tableStatsEl.textContent = `${analysis.stats.states} states · ${analysis.stats.transitions} transitions`;
  }
  if (copyTableCsvBtn) {
    copyTableCsvBtn.disabled = false;
  }

  if (stepLogEl) {
    renderStepLog(stepLogEl, analysis.steps);
  }
  if (stepLogStatsEl) {
    stepLogStatsEl.textContent = `${analysis.stats.states} st · ${analysis.stats.transitions} tr built`;
  }
  if (activeFragmentStackEl && analysis.steps.length > 0) {
    renderFragmentStack(activeFragmentStackEl, analysis.steps[0].stackAfter);
  }

  validationController.renderChecks(analysis, concatenation);

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

  if (capMode === 'off') {
    if (stepFirstBtn) stepFirstBtn.disabled = true;
    if (stepPrevBtn) stepPrevBtn.disabled = true;
    if (stepPlayBtn) stepPlayBtn.disabled = true;
    if (stepNextBtn) stepNextBtn.disabled = true;
    if (stepLastBtn) stepLastBtn.disabled = true;
    if (flatOption) flatOption.disabled = true;
    if (viewToggleSelect) viewToggleSelect.disabled = false;
    currentStepIndex = 0;
    if (stepCounterEl) {
      stepCounterEl.textContent = 'step 0 / 0';
    }

    currentDot = toDot(analysis.nfa, {
      compactLabels: isCompactLabels()
    });
    if (exportSvgBtn) exportSvgBtn.disabled = true;

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

  if (flatOption) flatOption.disabled = false;
  if (viewToggleSelect) {
    viewToggleSelect.disabled = false;
    currentView = (viewToggleSelect.value as 'flat' | 'final') || 'flat';
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
  renderTraceCards(container, results, lines, {
    isCompact: isCompactLabels(),
    compactLabelMap: currentAnalysis?.compactLabelMap,
    labelMap: currentAnalysis ? normalizeStateLabels(currentAnalysis.nfa) : undefined,
    onStepSelect: (states, isDead, position) => {
      currentActiveStates = [...states];
      if (tableEl) {
        updateTableActiveStates(tableEl, currentActiveStates);
      }
      isDeadRun = isDead;
      if (runStatusEl) {
        if (isDeadRun && position !== undefined) {
          runStatusEl.textContent = `Run is dead at position ${position}: active set is empty.`;
          runStatusEl.className = 'warning';
        } else {
          runStatusEl.textContent = '';
          runStatusEl.className = '';
        }
      }
      renderFinalView();
    }
  });
}

function handleRun() {
  if (!currentAnalysis) {
    if (verdictEl) {
      verdictEl.textContent = '';
    }
    if (traceEl) {
      traceEl.innerHTML = '';
    }
    if (dockSummaryEl) {
      dockSummaryEl.textContent = 'Not run';
    }
    if (traceEmptyHintEl) {
      traceEmptyHintEl.hidden = false;
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
  if (numberingBadgeEl) {
    numberingBadgeEl.style.display = 'none';
  }
  if (tableEl && currentAnalysis) {
    renderTransitionTable(tableEl, currentAnalysis);
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

  if (dockSummaryEl) {
    dockSummaryEl.textContent = formatDockSummary(results);
  }
  if (traceEmptyHintEl) {
    traceEmptyHintEl.hidden = true;
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
        firstInitial.setAttribute('aria-pressed', 'true');
      }
      currentActiveStates = [...results[0].initialClosure];
      if (tableEl) {
        updateTableActiveStates(tableEl, currentActiveStates);
      }
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
        alphabetMessageEl.className = 'grid-item-alphabet-message error';
      }
      // Restore valid alphabet in input
      alphabetInputEl.value = (userEditedAlphabet ?? currentAnalysis.alphabet).join(', ');
    } else {
      if (alphabetMessageEl) {
        alphabetMessageEl.textContent = '';
        alphabetMessageEl.className = 'grid-item-alphabet-message';
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
    const presetDescEl = document.getElementById('preset-description');
    if (!selectedId) {
      if (presetDescEl) presetDescEl.textContent = '';
      return;
    }
    const preset = PRESETS.find((p) => p.id === selectedId);
    if (!preset) return;
    if (presetDescEl) presetDescEl.textContent = formatPresetDescription(selectedId, PRESETS);

    if (inputEl) inputEl.value = preset.regex;
    syncRegexInput();
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
    if (inputEl.value.includes('^')) {
      const start = inputEl.selectionStart;
      const original = inputEl.value;
      const normalized = original.replace(/\^\*/g, '*').replace(/\^/g, '*');
      if (normalized !== original) {
        inputEl.value = normalized;
        if (start !== null) {
          const diff = original.length - normalized.length;
          const newPos = Math.max(0, start - diff);
          inputEl.setSelectionRange(newPos, newPos);
        }
      }
    }
    if (presetSelectEl && presetSelectEl.value) {
      const activePreset = PRESETS.find((p) => p.id === presetSelectEl.value);
      if (activePreset && activePreset.regex !== inputEl.value) {
        presetSelectEl.value = '';
        const presetDescEl = document.getElementById('preset-description');
        if (presetDescEl) presetDescEl.textContent = '';
      }
    }
    syncRegexInput();
  });
  inputEl.addEventListener('scroll', () => {
    if (regexMirrorEl) {
      regexMirrorEl.scrollLeft = inputEl.scrollLeft;
    }
  });
  inputEl.addEventListener('keyup', () => {
    syncRegexInput();
  });
  inputEl.addEventListener('change', () => {
    syncRegexInput();
  });
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === '^') {
      e.preventDefault();
      insertAtCursor('*');
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
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
    const val = (viewToggleSelect.value as 'flat' | 'final') || 'flat';
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
      if (currentActiveStates && tableEl) {
        updateTableActiveStates(tableEl, currentActiveStates);
      }
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
    recomputeFit();
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

if (exportSvgBtn) {
  exportSvgBtn.addEventListener('click', () => {
    if (!currentAnalysis) return;
    const mode = checkDiagramCap(currentAnalysis.postfix.length);
    if (mode === 'off') return;

    let rawSvg: string | undefined;
    if (currentView === 'final') {
      const compact = isCompactLabels();
      const activeStr = currentActiveStates ? currentActiveStates.join(',') : 'none';
      const cacheKey = `final-${compact}-${activeStr}`;
      rawSvg = stepSvgCache.get(cacheKey);
    } else {
      const cacheKey = `${currentView}-${currentStepIndex}`;
      rawSvg = stepSvgCache.get(cacheKey);
    }

    if (!rawSvg) return;
    const standaloneSvg = formatStandaloneSvg(rawSvg);
    const filename = getExportFilename(currentView, currentStepIndex, 'svg');
    const blob = new Blob([standaloneSvg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
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
    if (keyboardHelpDialog?.open) return;
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

  attachTouchGestures(canvasEl, {
    onPan: (dx, dy) => {
      if (!currentContentRect) return;
      currentViewportMode = 'manual';
      currentViewport = panBy(currentViewport, { dx, dy });
      applyViewport();
    },
    onPinch: (focalPoint, scaleFactor) => {
      if (!currentContentRect) return;
      currentViewportMode = 'manual';
      const rect = canvasEl.getBoundingClientRect();
      const focalInCanvas = {
        x: focalPoint.x - rect.left,
        y: focalPoint.y - rect.top,
      };
      const limits = getEffectiveLimits(currentFitZoom ?? undefined);
      currentViewport = zoomAt(currentViewport, scaleFactor, focalInCanvas, limits);
      applyViewport();
    },
    onDoubleTap: () => {
      if (zoomFitBtn && !zoomFitBtn.disabled) {
        zoomFitBtn.click();
      }
    },
  });
}

window.addEventListener('keydown', (e: KeyboardEvent) => {
  const target = e.target as HTMLElement | null;
  const isInput = Boolean(
    target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable)
  );

  if (!isInput && !e.ctrlKey && !e.altKey && !e.metaKey && e.key === '?') {
    if (keyboardHelpDialog && !keyboardHelpDialog.open) {
      e.preventDefault();
      openKeyboardHelp(target);
    }
    return;
  }

  if (keyboardHelpDialog?.open) {
    return;
  }

  if (isInput) {
    return;
  }
  if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) {
    return;
  }
  if (e.key === 'Escape') {
    if (legendEl && isLegendOpen(legendEl)) {
      closeLegend(legendEl, legendBtn);
      return;
    }
    if (fullscreenManager?.isActive()) {
      fullscreenManager.exit();
      return;
    }
    if (currentActiveStates !== null) {
      currentActiveStates = null;
      if (tableEl) {
        updateTableActiveStates(tableEl, null);
      }
      if (traceEl) {
        traceEl.querySelectorAll('.trace-step, .trace-status').forEach((el) => el.classList.remove('active'));
      }
      if (currentView === 'final' && currentAnalysis) {
        renderFinalView();
      }
    }
  } else if (e.key === 'ArrowLeft') {
    if (currentRoute !== 'workbench') return;
    e.preventDefault();
    stopPlayback();
    if (currentStepIndex > 1) {
      navigateToStep(currentStepIndex - 1);
    }
  } else if (e.key === 'ArrowRight') {
    if (currentRoute !== 'workbench') return;
    e.preventDefault();
    stopPlayback();
    if (currentAnalysis && currentStepIndex < currentAnalysis.steps.length) {
      navigateToStep(currentStepIndex + 1);
    }
  }
});

if (keyboardHelpBtn) {
  keyboardHelpBtn.addEventListener('click', () => {
    openKeyboardHelp(keyboardHelpBtn);
  });
}

if (keyboardHelpClose) {
  keyboardHelpClose.addEventListener('click', () => {
    closeKeyboardHelp();
  });
}

if (keyboardHelpDialog) {
  keyboardHelpDialog.addEventListener('close', () => {
    if (lastHelpOpener && typeof lastHelpOpener.focus === 'function') {
      lastHelpOpener.focus();
    }
    lastHelpOpener = null;
  });
}

// Initially disable stepper buttons until a build occurs
if (stepFirstBtn) stepFirstBtn.disabled = true;
if (stepPrevBtn) stepPrevBtn.disabled = true;
if (stepPlayBtn) stepPlayBtn.disabled = true;
if (stepNextBtn) stepNextBtn.disabled = true;
if (stepLastBtn) stepLastBtn.disabled = true;
updateToolbarButtonStates();

if (copyTableCsvBtn) {
  copyTableCsvBtn.disabled = true;
  copyTableCsvBtn.addEventListener('click', async () => {
    if (!currentAnalysis) return;
    const csv = exportTableCsv(currentAnalysis, isCompactLabels());
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(csv);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = csv;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      copyTableCsvBtn.textContent = 'Copied!';
      if (copyTableCsvStatus) {
        copyTableCsvStatus.textContent = 'Transition table copied to clipboard as CSV';
      }
      setTimeout(() => {
        copyTableCsvBtn.textContent = 'Copy CSV';
      }, 2000);
    } catch (err) {
      console.error('Failed to copy CSV:', err);
    }
  });
}


if (copyLinkBtn) {
  copyLinkBtn.addEventListener('click', async () => {
    const state: AppUrlState = {};
    if (inputEl && inputEl.value.trim() !== '') {
      state.regex = inputEl.value;
    }
    if (notationSelectEl && notationSelectEl.value !== 'standard') {
      state.notation = notationSelectEl.value as 'standard' | 'textbook';
    }
    if (concatSelectEl && concatSelectEl.value !== 'epsilon-link') {
      state.concat = concatSelectEl.value as 'epsilon-link' | 'merge';
    }
    if (presetSelectEl && presetSelectEl.value) {
      state.preset = presetSelectEl.value;
    }
    if (userEditedAlphabet && alphabetInputEl && alphabetInputEl.value.trim() !== '') {
      state.alphabet = alphabetInputEl.value;
    }
    if (testInputEl && testInputEl.value !== '') {
      state.input = testInputEl.value;
    }
    if (currentView !== 'flat') {
      state.view = currentView;
    }
    if (currentStepIndex > 1 && currentView !== 'final') {
      state.step = currentStepIndex;
    }
    if (isCompactLabels()) {
      state.compact = true;
    }

    const query = encodeAppState(state);
    const baseUrl = window.location.href.split('?')[0].split('#')[0];
    const routeHash = formatRoute(currentRoute);
    const fullUrl = query ? `${baseUrl}?${query}${routeHash}` : `${baseUrl}${routeHash}`;

    const success = await copyTextToClipboard(fullUrl);
    showTransientStatus(
      copyLinkStatusEl,
      success,
      'Link copied!',
      'Copy failed',
      () => copyLinkTimer,
      (t) => {
        copyLinkTimer = t;
      },
      2000
    );
  });
}

async function initDeepLink(): Promise<void> {
  const initialRoute = parseRoute(window.location.hash);
  if (isLegacyAlias(window.location.hash)) {
    window.history.replaceState(null, '', formatRoute(initialRoute) + window.location.search);
  }
  showPage(initialRoute, { isInitialLoad: true });

  const search = window.location.search;
  if (!search) {
    document.body.setAttribute('data-deep-link-done', 'true');
    return;
  }

  const { state, ignoredKeys } = decodeAppState(search);

  if (state.preset) {
    const preset = PRESETS.find((p) => p.id === state.preset);
    if (!preset) {
      ignoredKeys.push('preset');
    } else {
      if (presetSelectEl) presetSelectEl.value = state.preset;
      const presetDescEl = document.getElementById('preset-description');
      if (presetDescEl) presetDescEl.textContent = formatPresetDescription(state.preset, PRESETS);
      if (inputEl) inputEl.value = preset.regex;
      syncRegexInput();
      if (notationSelectEl) notationSelectEl.value = preset.notation;
      if (preset.concatenation && concatSelectEl) {
        concatSelectEl.value = preset.concatenation;
      }
      if (preset.testInput && testInputEl) {
        testInputEl.value = preset.testInput;
      }
    }
  }

  if (state.regex !== undefined && inputEl) {
    inputEl.value = state.regex;
    syncRegexInput();
    if (presetSelectEl && presetSelectEl.value) {
      const activePreset = PRESETS.find((p) => p.id === presetSelectEl.value);
      if (activePreset && activePreset.regex !== inputEl.value) {
        presetSelectEl.value = '';
        const presetDescEl = document.getElementById('preset-description');
        if (presetDescEl) presetDescEl.textContent = '';
      }
    }
  }

  if (state.notation !== undefined && notationSelectEl) {
    notationSelectEl.value = state.notation;
  }

  if (state.concat !== undefined && concatSelectEl) {
    concatSelectEl.value = state.concat;
  }

  if (state.alphabet !== undefined && alphabetInputEl) {
    userEditedAlphabet = state.alphabet.split(',').map((s) => s.trim()).filter(Boolean);
    alphabetInputEl.value = userEditedAlphabet.join(', ');
  }

  if (state.input !== undefined && testInputEl) {
    testInputEl.value = state.input;
  }

  if (state.compact !== undefined && compactLabelsEl) {
    compactLabelsEl.checked = state.compact;
  }

  if (ignoredKeys.length > 0 && linkNoticeEl) {
    linkNoticeEl.textContent = `Ignored link parameters: ${[...new Set(ignoredKeys)].join(', ')}`;
    linkNoticeEl.className = 'warning';
  }

  if (inputEl && inputEl.value.trim() !== '') {
    await handleBuild();

    if (testInputEl && testInputEl.value !== '') {
      handleRun();
    }

    if (currentAnalysis) {
      const capMode = checkDiagramCap(currentAnalysis.postfix.length);
      const totalSteps = currentAnalysis.steps.length;

      let targetView: 'flat' | 'final' | undefined = state.view;
      if (targetView) {
        if (capMode === 'off' && targetView !== 'final') {
          targetView = 'final';
        }
      }

      if (targetView === 'final') {
        await renderFinalView();
      } else if (targetView || state.step !== undefined) {
        const stepNum = state.step !== undefined ? Math.min(Math.max(1, state.step), totalSteps) : 1;
        if (targetView && viewToggleSelect) {
          viewToggleSelect.value = targetView;
          currentView = targetView;
        }
        await navigateToStep(stepNum);
      }
    }
  }

  document.body.setAttribute('data-deep-link-done', 'true');
}

window.addEventListener('hashchange', () => {
  if (fullscreenManager?.isActive()) {
    fullscreenManager.exit();
  }
  const rawHash = window.location.hash;
  const route = parseRoute(rawHash);
  if (isLegacyAlias(rawHash)) {
    window.history.replaceState(null, '', formatRoute(route) + window.location.search);
  }
  showPage(route);
});

document.querySelectorAll<HTMLAnchorElement>('.app-nav .nav-link').forEach((link) => {
  link.addEventListener('click', (e) => {
    const href = link.getAttribute('href') || '';
    const route = parseRoute(href);
    window.location.hash = formatRoute(route);
    e.preventDefault();
  });
});

initDeepLink();
syncRegexInput();
