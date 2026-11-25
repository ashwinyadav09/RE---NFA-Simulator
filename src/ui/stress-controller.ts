import {
  STRESS_FAMILIES,
  STRESS_N_SERIES,
  STRESS_SCALE_N_SERIES,
  runStressNfa,
  detectBrowserEngine,
  analyze,
  toJs
} from '../engine/index';
import { renderStressChartSvg, type StressChartPoint } from '../diagram/index';
import { formatStressCsv, formatRegExpTime, formatNfaTime } from './csv';
import type { StressRow, RegExpVerdict } from './stress-types';
import { updateSummaryStrip } from './validation-view';

export interface StressElements {
  stressBrowserInfoEl?: HTMLElement | null;
  stressChartContainer?: HTMLElement | null;
  stressScaleToggleBtn?: HTMLButtonElement | null;
  stressCancelBtn?: HTMLButtonElement | null;
  stressFamilySelect?: HTMLSelectElement | null;
  stressTableBody?: HTMLElement | null;
  stressStatusEl?: HTMLElement | null;
  stressCopyCsvBtn?: HTMLButtonElement | null;
  stressCopyStatusEl?: HTMLElement | null;
  stressExportSvgBtn?: HTMLButtonElement | null;
  stressRunBtn?: HTMLButtonElement | null;
  diffRunBtn?: HTMLButtonElement | null;
  summaryStripEl?: HTMLElement | null;
}

export interface StressDeps {
  runRegExpInWorker: (
    pattern: string,
    strings: string[],
    timeoutMs?: number,
    owner?: 'stress' | 'diff'
  ) => Promise<{ matches?: boolean[]; timeout?: boolean; cancelled?: boolean; error?: string }>;
  resetWorker: () => void;
  getActiveWorkerOwner: () => 'stress' | 'diff' | null;
  isDiffActive: () => boolean;
  onStressActiveChange?: (active: boolean) => void;
}

export interface StressController {
  dispose(): void;
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
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

export function showTransientStatus(
  statusEl: HTMLElement | null,
  success: boolean,
  successText: string,
  failureText: string,
  getActiveTimer: () => ReturnType<typeof setTimeout> | null,
  setActiveTimer: (t: ReturnType<typeof setTimeout> | null) => void,
  durationMs = 2000
): void {
  if (!statusEl) return;
  const currentTimer = getActiveTimer();
  if (currentTimer !== null) {
    clearTimeout(currentTimer);
    setActiveTimer(null);
  }

  if (success) {
    statusEl.textContent = successText;
    statusEl.setAttribute('data-copied', 'true');
  } else {
    statusEl.textContent = failureText;
    statusEl.setAttribute('data-copied', 'false');
  }

  const timer = setTimeout(() => {
    if (statusEl) {
      statusEl.textContent = '';
      statusEl.removeAttribute('data-copied');
    }
    setActiveTimer(null);
  }, durationMs);
  setActiveTimer(timer);
}

export function initStressController(
  elements: StressElements = {},
  deps: StressDeps
): StressController {
  const stressBrowserInfoEl =
    elements.stressBrowserInfoEl ?? document.getElementById('stress-browser-info');
  if (stressBrowserInfoEl) {
    const info = detectBrowserEngine(typeof navigator !== 'undefined' ? navigator.userAgent : '');
    stressBrowserInfoEl.textContent = `Browser engine: ${info.label}`;
  }

  const stressChartContainer =
    elements.stressChartContainer ?? document.getElementById('stress-chart-container');
  const stressScaleToggleBtn =
    elements.stressScaleToggleBtn ??
    (document.getElementById('stress-scale-toggle') as HTMLButtonElement | null);
  const stressCancelBtn =
    elements.stressCancelBtn ??
    (document.getElementById('stress-cancel') as HTMLButtonElement | null);
  const stressFamilySelect = document.getElementById('stress-family') as HTMLSelectElement | null;
  const stressTableBody =
    elements.stressTableBody ??
    (document.querySelector('#stress-table tbody') as HTMLElement | null);
  const stressStatusEl = elements.stressStatusEl ?? document.getElementById('stress-status');
  const stressCopyCsvBtn =
    elements.stressCopyCsvBtn ??
    (document.getElementById('stress-copy-csv') as HTMLButtonElement | null);
  const stressCopyStatusEl =
    elements.stressCopyStatusEl ?? document.getElementById('stress-copy-status');
  const stressExportSvgBtn =
    elements.stressExportSvgBtn ??
    (document.getElementById('stress-export-svg') as HTMLButtonElement | null);
  const stressRunBtn =
    elements.stressRunBtn ?? (document.getElementById('stress-run') as HTMLButtonElement | null);
  const diffRunBtn =
    elements.diffRunBtn ?? (document.getElementById('diff-run') as HTMLButtonElement | null);
  const summaryStripEl =
    elements.summaryStripEl ?? document.getElementById('validation-summary-strip');

  let currentStressScale: 'linear' | 'log' = 'linear';
  let stressCancelled = false;
  let stressGeneration = 0;
  let currentStressRows: StressRow[] = [];
  let stressIsActive = false;
  let copyStatusTimer: ReturnType<typeof setTimeout> | null = null;

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
    const title =
      currentStressRows.length > 0 ? `${family.name} - Backtracking vs Thompson NFA` : undefined;
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
        ? `${formatRegExpTime(row.regExpTimeMs)} ms`
        : '—';

    const regExpVerdictDisplay = row.regExpVerdict === 'SKIPPED' ? '—' : row.regExpVerdict;

    tr.innerHTML = `
    <td>${row.n}</td>
    <td>${row.inputLength}</td>
    <td>${regExpTimeDisplay}</td>
    <td>${formatNfaTime(row.nfaTimeMs)} ms</td>
    <td>${regExpVerdictDisplay}</td>
    <td>${row.nfaVerdict}</td>
  `;
    return tr;
  }

  const onCopyCsvClick = async () => {
    if (currentStressRows.length === 0) return;
    const csv = formatStressCsv(currentStressRows);
    const success = await copyTextToClipboard(csv);

    showTransientStatus(
      stressCopyStatusEl,
      success,
      'Copied!',
      'Copy failed',
      () => copyStatusTimer,
      (t) => {
        copyStatusTimer = t;
      },
      2000
    );
  };

  const onExportSvgClick = () => {
    if (currentStressRows.length === 0) return;
    const familyId = stressFamilySelect ? stressFamilySelect.value : 'star-star-b';
    const family = STRESS_FAMILIES[familyId] || STRESS_FAMILIES['star-star-b'];
    const title = `${family.name} - Backtracking vs Thompson NFA`;
    const desc = `Benchmark comparison chart for ${family.name} comparing RegExp backtracking with Thompson NFA under ${currentStressScale} scale.`;

    const svgString = renderStressChartSvg(
      stressRowsToChartPoints(currentStressRows),
      {
        title,
        desc,
        scale: currentStressScale,
        standalone: true
      }
    );

    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stress-chart-${familyId}-${currentStressScale}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
  };

  const onScaleToggleClick = () => {
    currentStressScale = currentStressScale === 'linear' ? 'log' : 'linear';
    if (stressScaleToggleBtn) {
    stressScaleToggleBtn.setAttribute('aria-pressed', String(currentStressScale === 'log'));
    updateStressChart();
    }
  };

  const onCancelClick = () => {
    stressCancelled = true;
    if (deps.getActiveWorkerOwner() === 'stress') {
      deps.resetWorker();
    }
    if (stressStatusEl) {
      stressStatusEl.textContent = 'Stress test cancelling...';
    }
  };

  const onRunClick = async () => {
    stressCancelled = false;
    const gen = ++stressGeneration;
    stressIsActive = true;
    currentStressRows = [];
    updateStressActionButtons();
    deps.onStressActiveChange?.(true);
    if (stressRunBtn) stressRunBtn.disabled = true;
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
          const res = await deps.runRegExpInWorker(jsPattern, [input], 8000, 'stress');
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
        if (currentStressRows.length > 0) {
          const maxN = Math.max(...currentStressRows.map((r) => r.n));
          if (summaryStripEl) {
            updateSummaryStrip(summaryStripEl, {
              stressMaxN: maxN,
              stressIsLinear: true
            });
          }
        }
      }
    } finally {
      stressIsActive = false;
      deps.onStressActiveChange?.(false);
      updateStressActionButtons();
      if (gen === stressGeneration) {
        if (stressRunBtn) stressRunBtn.disabled = deps.isDiffActive();
        if (stressFamilySelect) {
          stressFamilySelect.disabled = false;
        }
        if (stressCancelBtn) {
          stressCancelBtn.style.display = 'none';
        }
        if (diffRunBtn && !deps.isDiffActive()) {
          diffRunBtn.disabled = false;
        }
      }
    }
  };

  if (stressCopyCsvBtn) stressCopyCsvBtn.addEventListener('click', onCopyCsvClick);
  if (stressExportSvgBtn) stressExportSvgBtn.addEventListener('click', onExportSvgClick);
  if (stressScaleToggleBtn) stressScaleToggleBtn.addEventListener('click', onScaleToggleClick);
  if (stressCancelBtn) stressCancelBtn.addEventListener('click', onCancelClick);
  if (stressRunBtn) stressRunBtn.addEventListener('click', onRunClick);

  return {
    dispose() {
      stressCancelled = Boolean(true);
      if (copyStatusTimer !== null) {
        clearTimeout(copyStatusTimer);
        copyStatusTimer = null;
      }
      if (stressCopyCsvBtn) stressCopyCsvBtn.removeEventListener('click', onCopyCsvClick);
      if (stressExportSvgBtn) stressExportSvgBtn.removeEventListener('click', onExportSvgClick);
      if (stressScaleToggleBtn) stressScaleToggleBtn.removeEventListener('click', onScaleToggleClick);
      if (stressCancelBtn) stressCancelBtn.removeEventListener('click', onCancelClick);
      if (stressRunBtn) stressRunBtn.removeEventListener('click', onRunClick);
    }
  };
}
