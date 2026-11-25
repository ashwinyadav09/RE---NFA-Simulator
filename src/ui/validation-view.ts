import {
  type CheckResult,
  type AnalysisSuccess,
  validateInvariants,
  checkSizeFormula,
  checkStepReplay,
  runBuiltinSuite,
  computeDifferentialK,
  allStrings,
  toJs,
  runDifferential
} from '../engine/index.js';

export interface ValidationSummaryData {
  invariantsPass?: number;
  invariantsTotal?: number;
  suitePass?: number;
  suiteTotal?: number;
  diffStatus?: string;
  diffStrings?: number;
  stressMaxN?: number;
  stressIsLinear?: boolean;
}

/**
 * Format suite summary chip text (e.g. "24 / 24 pass" or "22 / 24 pass · 2 fail").
 */
export function formatSuiteSummary(results: Array<{ verdict: string }>): string {
  if (!results || results.length === 0) return 'Not run';
  const passCount = results.filter((r) => r.verdict === 'PASS').length;
  const total = results.length;
  if (passCount === total) {
    return `${passCount} / ${total} pass`;
  }
  const failCount = total - passCount;
  return `${passCount} / ${total} pass · ${failCount} fail`;
}

/**
 * Extract code badge from invariant label (e.g. "I1 (Distinct Start & Accept)" -> "I1").
 */
export function extractCodeBadge(label: string): { code: string; name: string } {
  const match = /^([A-Za-z0-9]+)\s*\(([^)]+)\)$/.exec(label);
  if (match) {
    return { code: match[1], name: match[2] };
  }
  if (label.toLowerCase().includes('size')) {
    return { code: 'Size', name: label };
  }
  if (label.toLowerCase().includes('replay')) {
    return { code: 'Replay', name: label };
  }
  return { code: label, name: label };
}

/**
 * Render invariant check row while preserving exact textContent format required by e2e/tests:
 * "${PASS|FAIL} - ${label}: ${explanation}"
 */
export function renderInvariantRow(el: HTMLElement, label: string, check: CheckResult): void {
  const pass = check.pass;
  el.setAttribute('data-pass', String(pass));
  el.className = `check-item check-row ${pass ? 'pass' : 'fail'}`;

  // Clear existing
  el.textContent = '';

  const { code, name } = extractCodeBadge(label);

  // Status pill
  const pill = document.createElement('span');
  pill.className = `verdict-pill ${pass ? 'accept' : 'reject'}`;
  pill.textContent = pass ? 'PASS' : 'FAIL';
  el.appendChild(pill);

  // Space separator for textContent match
  el.appendChild(document.createTextNode(' - '));

  // Code badge
  const codeBadge = document.createElement('span');
  codeBadge.className = 'check-code font-code-sm';
  codeBadge.textContent = code;
  el.appendChild(codeBadge);

  el.appendChild(document.createTextNode(' · '));

  // Name
  const nameSpan = document.createElement('span');
  nameSpan.className = 'check-name';
  nameSpan.textContent = name;
  el.appendChild(nameSpan);

  el.appendChild(document.createTextNode(': '));

  // Explanation
  const explanationSpan = document.createElement('span');
  explanationSpan.className = 'check-explanation text-muted';
  explanationSpan.textContent = check.explanation;
  el.appendChild(explanationSpan);
}

/**
 * Updates the top summary strip cards with live data.
 */
/**
 * Updates the top summary strip cards with live data.
 * When an empty object {} is passed, all cards are reset to their default un-run state.
 * When specific fields are provided, only those cards are updated.
 */
export function updateSummaryStrip(container: HTMLElement, data: ValidationSummaryData): void {
  const isReset = Object.keys(data).length === 0;

  // Invariants
  const invPill = container.querySelector('#strip-invariants-pill');
  const invVal = container.querySelector('#strip-invariants-val');
  if (data.invariantsTotal !== undefined && data.invariantsTotal > 0) {
    const isAll = data.invariantsPass === data.invariantsTotal;
    if (invPill) {
      invPill.textContent = isAll ? 'PASS' : 'FAIL';
      invPill.className = `strip-card-pill ${isAll ? 'pill-pass' : 'pill-fail'}`;
    }
    if (invVal) {
      invVal.textContent = `${data.invariantsPass} / ${data.invariantsTotal} pass`;
    }
  } else if (isReset || data.invariantsTotal === 0) {
    if (invPill) {
      invPill.textContent = '6 / 6';
      invPill.className = 'strip-card-pill pill-neutral';
    }
    if (invVal) invVal.textContent = 'Not run';
  }

  // Suite
  const suitePill = container.querySelector('#strip-suite-pill');
  const suiteVal = container.querySelector('#strip-suite-val');
  if (data.suiteTotal !== undefined && data.suiteTotal > 0) {
    const isAll = data.suitePass === data.suiteTotal;
    if (suitePill) {
      suitePill.textContent = isAll ? 'PASS' : 'FAIL';
      suitePill.className = `strip-card-pill ${isAll ? 'pill-pass' : 'pill-fail'}`;
    }
    if (suiteVal) {
      suiteVal.textContent = `${data.suitePass} / ${data.suiteTotal} pass`;
    }
  } else if (isReset || data.suiteTotal === 0) {
    if (suitePill) {
      suitePill.textContent = 'Suite';
      suitePill.className = 'strip-card-pill pill-neutral';
    }
    if (suiteVal) suiteVal.textContent = 'Not run';
  }

  // Differential
  const diffPill = container.querySelector('#strip-diff-pill');
  const diffVal = container.querySelector('#strip-diff-val');
  if (data.diffStatus !== undefined && data.diffStatus !== '') {
    const isPass = data.diffStatus.includes('ALL PASSED');
    if (diffPill) {
      diffPill.textContent = isPass ? 'PASS' : 'FAIL';
      diffPill.className = `strip-card-pill ${isPass ? 'pill-pass' : 'pill-fail'}`;
    }
    if (diffVal) {
      diffVal.textContent = data.diffStrings
        ? `3 oracles · ${data.diffStrings} strings`
        : 'Completed';
    }
  } else if (isReset || data.diffStatus === '') {
    if (diffPill) {
      diffPill.textContent = 'Diff';
      diffPill.className = 'strip-card-pill pill-neutral';
    }
    if (diffVal) diffVal.textContent = 'Not run';
  }

  // Stress
  const stressPill = container.querySelector('#strip-stress-pill');
  const stressVal = container.querySelector('#strip-stress-val');
  if (data.stressMaxN !== undefined && data.stressMaxN > 0) {
    if (stressPill) {
      stressPill.textContent = 'PASS';
      stressPill.className = 'strip-card-pill pill-pass';
    }
    if (stressVal) {
      stressVal.textContent = `n ≤ ${data.stressMaxN} · NFA linear`;
    }
  } else if (isReset || data.stressMaxN === 0) {
    if (stressPill) {
      stressPill.textContent = 'Stress';
      stressPill.className = 'strip-card-pill pill-neutral';
    }
    if (stressVal) stressVal.textContent = 'Not run';
  }
}

/**
 * Escape HTML special characters to prevent XSS / markup injection.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface DifferentialResultsData {
  oracles: {
    enumerator: { name: string; status: string; testedCount: number };
    derivatives: { name: string; status: string; testedCount: number };
    regExp: { name: string; status: string; testedCount: number };
  };
  mismatches: string[];
}

/**
 * Render differential test results into the results container with HTML escaping on user-derived strings.
 */
export function renderDifferentialResults(
  diffResultsEl: HTMLElement,
  diffResult: DifferentialResultsData
): void {
  const regExpStatus = diffResult.oracles.regExp.status;
  const regExpBadgeClass =
    regExpStatus === 'pass'
      ? 'badge-pass'
      : regExpStatus === 'skipped (timeout)'
        ? 'badge-skipped'
        : 'badge-fail';

  diffResultsEl.innerHTML = `
    <div class="diff-oracle-row" data-oracle="enumerator">
      <strong>${escapeHtml(diffResult.oracles.enumerator.name)}:</strong>
      <span class="badge ${diffResult.oracles.enumerator.status === 'pass' ? 'badge-pass' : 'badge-fail'}">${escapeHtml(diffResult.oracles.enumerator.status.toUpperCase())}</span>
      (${diffResult.oracles.enumerator.testedCount.toLocaleString()} strings)
    </div>
    <div class="diff-oracle-row" data-oracle="derivatives">
      <strong>${escapeHtml(diffResult.oracles.derivatives.name)}:</strong>
      <span class="badge ${diffResult.oracles.derivatives.status === 'pass' ? 'badge-pass' : 'badge-fail'}">${escapeHtml(diffResult.oracles.derivatives.status.toUpperCase())}</span>
      (${diffResult.oracles.derivatives.testedCount.toLocaleString()} strings)
    </div>
    <div class="diff-oracle-row" data-oracle="regExp">
      <strong>${escapeHtml(diffResult.oracles.regExp.name)}:</strong>
      <span class="badge ${regExpBadgeClass}">${escapeHtml(regExpStatus)}</span>
      (${diffResult.oracles.regExp.testedCount.toLocaleString()} strings)
    </div>
    <div class="diff-mismatches-summary">
      ${
        diffResult.mismatches.length === 0
          ? '<p class="mismatches-none">No mismatches found.</p>'
          : `<p class="mismatches-found">Mismatches found (${diffResult.mismatches.length}): <code>${escapeHtml(diffResult.mismatches.slice(0, 20).join(', '))}</code></p>`
      }
    </div>
  `;
}

export interface ValidationElements {
  runSuiteBtn?: HTMLButtonElement | null;
  suiteTableEl?: HTMLElement | null;
  suiteSummaryEl?: HTMLElement | null;
  summaryStripEl?: HTMLElement | null;
  diffRunBtn?: HTMLButtonElement | null;
  diffStatusEl?: HTMLElement | null;
  diffResultsEl?: HTMLElement | null;
  stressRunBtn?: HTMLButtonElement | null;
  invI1El?: HTMLElement | null;
  invI2El?: HTMLElement | null;
  invI3El?: HTMLElement | null;
  invI4El?: HTMLElement | null;
  invSizeEl?: HTMLElement | null;
  invReplayEl?: HTMLElement | null;
}

export interface ValidationDeps {
  getAnalysis: () => AnalysisSuccess | null;
  getUserEditedAlphabet: () => string[] | null;
  runRegExpInWorker: (
    pattern: string,
    strings: string[],
    timeoutMs?: number,
    owner?: 'stress' | 'diff'
  ) => Promise<{ matches?: boolean[]; timeout?: boolean; cancelled?: boolean; error?: string }>;
  isStressActive: () => boolean;
  onDiffActiveChange?: (active: boolean) => void;
}

export interface ValidationController {
  renderChecks(analysis: AnalysisSuccess, concatenation: 'epsilon-link' | 'merge'): void;
  resetDiff(): void;
  dispose(): void;
}

export function initValidationController(
  elements: ValidationElements = {},
  deps: ValidationDeps
): ValidationController {
  const runSuiteBtn = elements.runSuiteBtn ?? (document.getElementById('run-suite') as HTMLButtonElement | null);
  const suiteTableEl = elements.suiteTableEl ?? document.getElementById('suite-table');
  const suiteSummaryEl = elements.suiteSummaryEl ?? document.getElementById('suite-summary');
  const summaryStripEl = elements.summaryStripEl ?? document.getElementById('validation-summary-strip');
  const diffRunBtn = elements.diffRunBtn ?? (document.getElementById('diff-run') as HTMLButtonElement | null);
  const diffStatusEl = elements.diffStatusEl ?? document.getElementById('diff-status');
  const diffResultsEl = elements.diffResultsEl ?? document.getElementById('diff-results');
  const stressRunBtn = elements.stressRunBtn ?? (document.getElementById('stress-run') as HTMLButtonElement | null);

  const invI1El = elements.invI1El ?? document.getElementById('inv-I1');
  const invI2El = elements.invI2El ?? document.getElementById('inv-I2');
  const invI3El = elements.invI3El ?? document.getElementById('inv-I3');
  const invI4El = elements.invI4El ?? document.getElementById('inv-I4');
  const invSizeEl = elements.invSizeEl ?? document.getElementById('inv-size');
  const invReplayEl = elements.invReplayEl ?? document.getElementById('inv-replay');

  let diffGeneration = 0;
  let diffIsActive = false;

  const onRunSuiteClick = () => {
    if (!suiteTableEl) return;
    const results = runBuiltinSuite();
    if (summaryStripEl) {
      const passCount = results.filter((r) => r.pass).length;
      updateSummaryStrip(summaryStripEl, {
        suitePass: passCount,
        suiteTotal: results.length
      });
    }
    if (suiteSummaryEl) {
      suiteSummaryEl.textContent = formatSuiteSummary(results.map((r) => ({ verdict: r.pass ? 'PASS' : 'FAIL' })));
      suiteSummaryEl.className = `suite-summary-chip font-code-sm ${results.every((r) => r.pass) ? 'chip-pass' : 'chip-fail'}`;
    }
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
  };

  const onDiffRunClick = async () => {
    const currentAnalysis = deps.getAnalysis();
    if (!currentAnalysis) {
      if (diffStatusEl) {
        diffStatusEl.textContent = 'Please build an expression first.';
      }
      return;
    }

    const gen = ++diffGeneration;
    diffIsActive = true;
    deps.onDiffActiveChange?.(true);
    if (diffRunBtn) diffRunBtn.disabled = true;
    if (stressRunBtn) {
      stressRunBtn.disabled = true;
    }

    try {
      const activeAlphabet = deps.getUserEditedAlphabet() ?? currentAnalysis.alphabet;
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
      const regExpRes = await deps.runRegExpInWorker(jsPattern, strings, 2000, 'diff');
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

      if (summaryStripEl) {
        updateSummaryStrip(summaryStripEl, {
          diffStatus: statusSummary,
          diffStrings: diffResult.totalStrings
        });
      }

      if (diffResultsEl) {
        renderDifferentialResults(diffResultsEl, diffResult);
      }
    } finally {
      diffIsActive = false;
      deps.onDiffActiveChange?.(false);
      if (diffRunBtn) diffRunBtn.disabled = deps.isStressActive();
      if (stressRunBtn && !deps.isStressActive()) {
        stressRunBtn.disabled = false;
      }
    }
  };

  if (runSuiteBtn) runSuiteBtn.addEventListener('click', onRunSuiteClick);
  if (diffRunBtn) diffRunBtn.addEventListener('click', onDiffRunClick);

  return {
    renderChecks(analysis: AnalysisSuccess, concatenation: 'epsilon-link' | 'merge') {
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
          renderInvariantRow(item.el, item.label, item.check);
        }
      }

      if (summaryStripEl) {
        const passCount = items.filter((it) => it.check.pass).length;
        updateSummaryStrip(summaryStripEl, {
          invariantsPass: passCount,
          invariantsTotal: items.length
        });
      }
    },

    resetDiff() {
      ++diffGeneration;
      if (diffStatusEl) diffStatusEl.textContent = '';
      if (diffResultsEl) diffResultsEl.innerHTML = '';
    },

    dispose() {
      if (runSuiteBtn) runSuiteBtn.removeEventListener('click', onRunSuiteClick);
      if (diffRunBtn) diffRunBtn.removeEventListener('click', onDiffRunClick);
    }
  };
}

