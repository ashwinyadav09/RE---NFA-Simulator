import type { AnalysisSuccess, Step } from '../engine/index.js';

/**
 * Format delta chips string (e.g. "+2 st", "+4 tr").
 */
export function formatDeltaChips(step: Step): { states: string; transitions: string; merged?: string } {
  const states = `+${step.newStates.length} st`;
  const transitions = `+${step.newTransitions.length} tr`;
  let merged: string | undefined;
  if (step.mergedPair) {
    merged = `merged ${step.mergedPair.removed} into ${step.mergedPair.into}`;
  }
  return { states, transitions, merged };
}

/**
 * Render active fragment stack boxes under the step log.
 */
export function renderFragmentStack(
  container: HTMLElement,
  stack?: { start: number; accept: number }[]
): void {
  container.textContent = '';
  if (!stack || stack.length === 0) return;

  const label = document.createElement('span');
  label.className = 'stack-label';
  label.textContent = 'Active Fragment Stack:';
  container.appendChild(label);

  const boxes = document.createElement('div');
  boxes.className = 'stack-boxes';
  for (const frag of stack) {
    const box = document.createElement('span');
    box.className = 'stack-box';
    box.textContent = `[ ${frag.start} → ${frag.accept} ]`;
    boxes.appendChild(box);
  }
  container.appendChild(boxes);
}

/**
 * Render the rich Step Log list into the container.
 */
export function renderStepLog(
  container: HTMLElement,
  steps: Step[],
  currentStep: number,
  onStepSelect?: (stepIndex: number) => void
): void {
  container.textContent = '';
  if (!steps || steps.length === 0) return;

  const list = document.createElement('ol');
  list.className = 'step-list';

  steps.forEach((step) => {
    const li = document.createElement('li');
    li.className = 'step-log-item';
    li.setAttribute('data-step-index', String(step.index));
    li.tabIndex = 0;

    // Header strip: Badge, Rule Name, Fragment, Delta Chips
    const header = document.createElement('div');
    header.className = 'step-item-header';

    const badge = document.createElement('span');
    badge.className = 'step-badge';
    badge.textContent = String(step.index);
    header.appendChild(badge);

    const ruleName = document.createElement('span');
    ruleName.className = 'step-rule-name';
    ruleName.textContent = step.token || step.rule.toUpperCase();
    header.appendChild(ruleName);

    if (step.result) {
      const frag = document.createElement('span');
      frag.className = 'step-fragment';
      frag.textContent = `${step.result.start}→${step.result.accept}`;
      header.appendChild(frag);
    }

    const deltas = formatDeltaChips(step);
    const chipsWrapper = document.createElement('span');
    chipsWrapper.className = 'step-delta-chips';

    const stChip = document.createElement('span');
    stChip.className = 'delta-chip';
    stChip.textContent = deltas.states;
    chipsWrapper.appendChild(stChip);

    const trChip = document.createElement('span');
    trChip.className = 'delta-chip';
    trChip.textContent = deltas.transitions;
    chipsWrapper.appendChild(trChip);

    header.appendChild(chipsWrapper);
    li.appendChild(header);

    // Description line (must preserve "Step N: ..." for tests)
    const desc = document.createElement('div');
    desc.className = 'step-description';
    desc.textContent = `Step ${step.index}: ${step.description}`;
    li.appendChild(desc);

    // Merged note if present
    if (deltas.merged) {
      const mergedLine = document.createElement('div');
      mergedLine.className = 'step-merged-note';
      mergedLine.textContent = `merged states ${step.mergedPair!.removed} and ${step.mergedPair!.into} into ${step.mergedPair!.into}`;
      li.appendChild(mergedLine);
    }

    // State classes
    if (currentStep > 0) {
      if (step.index < currentStep) {
        li.classList.add('past');
      } else if (step.index === currentStep) {
        li.classList.add('active');
        li.setAttribute('aria-current', 'step');
      } else {
        li.classList.add('future');
      }
    }

    if (onStepSelect) {
      const select = () => onStepSelect(step.index);
      li.addEventListener('click', select);
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          select();
        }
      });
    }

    list.appendChild(li);
  });

  container.appendChild(list);
}

/**
 * Synchronize past/active/future classes on existing step log items.
 */
export function updateStepLogActive(container: HTMLElement, currentStep: number): void {
  const items = container.querySelectorAll<HTMLElement>('.step-log-item');
  items.forEach((item) => {
    const stepIndex = parseInt(item.getAttribute('data-step-index') || '0', 10);
    item.classList.remove('past', 'active', 'future');
    item.removeAttribute('aria-current');
    // Clear legacy inline styles if any
    item.style.fontWeight = '';
    item.style.backgroundColor = '';

    if (currentStep <= 0) {
      return;
    }

    if (stepIndex < currentStep) {
      item.classList.add('past');
    } else if (stepIndex === currentStep) {
      item.classList.add('active');
      item.setAttribute('aria-current', 'step');
      if (typeof item.scrollIntoView === 'function') {
        item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    } else {
      item.classList.add('future');
    }
  });
}

/**
 * Render semantic transition table with sticky header and state badges.
 */
export function renderTransitionTable(
  container: HTMLElement,
  analysis: AnalysisSuccess,
  isCompact: boolean,
  labelMap?: Map<number, string>
): void {
  const { nfa, transitionTable, compactLabelMap } = analysis;
  container.textContent = '';

  const table = document.createElement('table');
  table.className = 'transition-data-table';

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
    const displayId = labelMap
      ? (labelMap.get(q) ?? `q${q}`)
      : (isCompact ? compactLabelMap[q] ?? q : q);
    const stateLabel = labelMap
      ? `${displayId}${isStart}${isAccept}`
      : `q${displayId}${isStart}${isAccept}`;
    const transitions = transitionTable[q] || {};
    const labels = Object.keys(transitions);

    const createRow = (col1: string, col2: string, col3: string) => {
      const tr = document.createElement('tr');
      tr.setAttribute('data-state', String(q));
      tr.setAttribute('data-display-state', String(displayId));
      if (labelMap) {
        tr.title = `State ${displayId} (built as ${q})`;
        tr.setAttribute('title', `State ${displayId} (built as ${q})`);
      }
      for (const val of [col1, col2, col3]) {
        const td = document.createElement('td');
        td.textContent = val;
        if (labelMap && val === col1) {
          td.title = `built as ${q}`;
          td.setAttribute('title', `built as ${q}`);
          td.setAttribute('data-built-as', String(q));
        }
        tr.appendChild(td);
      }
      return tr;
    };

    if (labels.length === 0) {
      tbody.appendChild(createRow(stateLabel, '-', '-'));
    } else {
      for (const label of labels) {
        const targets = transitions[label]
          .map((dest) => (labelMap ? labelMap.get(dest) ?? `q${dest}` : `q${isCompact ? compactLabelMap[dest] ?? dest : dest}`))
          .join(', ');
        tbody.appendChild(createRow(stateLabel, label, targets));
      }
    }
  }
  table.appendChild(tbody);
  container.appendChild(table);
}

/**
 * Update active state row highlighting on the transition table.
 */
export function updateTableActiveStates(container: HTMLElement, activeStates: number[] | null): void {
  const rows = container.querySelectorAll<HTMLElement>('tbody tr');
  const activeSet = activeStates ? new Set(activeStates) : null;

  rows.forEach((row) => {
    const stateId = parseInt(row.getAttribute('data-state') || '-1', 10);
    if (activeSet && activeSet.has(stateId)) {
      row.classList.add('active-state-row');
    } else {
      row.classList.remove('active-state-row');
    }
  });
}

/**
 * Format transition table as CSV for export / copy.
 */
export function exportTableCsv(
  analysis: AnalysisSuccess,
  isCompact: boolean,
  labelMap?: Map<number, string>
): string {
  const { nfa, transitionTable, compactLabelMap } = analysis;
  const lines: string[] = ['State,Symbol,Next State(s)'];

  for (const q of nfa.states) {
    const isStart = q === nfa.start ? ' (start)' : '';
    const isAccept = q === nfa.accept ? ' (accept)' : '';
    const displayId = labelMap
      ? (labelMap.get(q) ?? `q${q}`)
      : (isCompact ? compactLabelMap[q] ?? q : q);
    const stateLabel = labelMap
      ? `${displayId}${isStart}${isAccept}`
      : `q${displayId}${isStart}${isAccept}`;
    const transitions = transitionTable[q] || {};
    const labels = Object.keys(transitions);

    if (labels.length === 0) {
      lines.push(`"${stateLabel}","-","-"`);
    } else {
      for (const label of labels) {
        const targets = transitions[label]
          .map((dest) => (labelMap ? labelMap.get(dest) ?? `q${dest}` : `q${isCompact ? compactLabelMap[dest] ?? dest : dest}`))
          .join('; ');
        lines.push(`"${stateLabel}","${label}","${targets}"`);
      }
    }
  }

  return lines.join('\n');
}
