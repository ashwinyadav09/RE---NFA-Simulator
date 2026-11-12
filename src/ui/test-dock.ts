import type { RunResult } from '../engine/index.js';

export interface TraceCardOptions {
  isCompact?: boolean;
  compactLabelMap?: Record<number, number>;
  onStepSelect?: (states: number[], isDead: boolean, position?: number) => void;
}

/**
 * Format summary string for the test dock header (e.g. "2 accepted · 2 rejected" or "Not run").
 */
export function formatDockSummary(results: RunResult[] | null): string {
  if (!results || results.length === 0) return 'Not run';
  const accepted = results.filter((r) => r.verdict === 'ACCEPT').length;
  const rejected = results.length - accepted;
  return `${accepted} accepted · ${rejected} rejected`;
}

/**
 * Format string display label with quotes.
 */
export function formatStringLabel(line: string): string {
  return `"${line}"`;
}

/**
 * Render structured result cards into container.
 */
export function renderTraceCards(
  container: HTMLElement,
  results: RunResult[],
  lines: string[],
  options: TraceCardOptions = {}
): void {
  const { isCompact, compactLabelMap, onStepSelect } = options;
  container.textContent = '';
  const mapState = (q: number) =>
    isCompact && compactLabelMap ? compactLabelMap[q] ?? q : q;

  for (let lineIdx = 0; lineIdx < results.length; lineIdx++) {
    const res = results[lineIdx];
    const line = lines[lineIdx];
    const codePoints = Array.from(line);

    // Each string is a card container with both .trace-card and .trace-line
    const card = document.createElement('div');
    card.className = 'trace-line trace-card';
    card.setAttribute('data-line', String(lineIdx));

    // Card Header: String label, length, and verdict pill
    const header = document.createElement('div');
    header.className = 'trace-card-header';

    const titleDiv = document.createElement('div');
    titleDiv.className = 'trace-card-title';

    const strong = document.createElement('strong');
    strong.textContent = `String: ${formatStringLabel(line)}`;
    titleDiv.appendChild(strong);

    if (line === '') {
      const epsBadge = document.createElement('span');
      epsBadge.className = 'empty-string-badge font-code-sm text-muted';
      epsBadge.textContent = 'ε (empty string)';
      titleDiv.appendChild(epsBadge);
    }

    const lenSpan = document.createElement('span');
    lenSpan.className = 'trace-card-len';
    lenSpan.textContent = `|w| = ${codePoints.length}`;
    titleDiv.appendChild(lenSpan);
    header.appendChild(titleDiv);

    const pill = document.createElement('span');
    pill.className = `verdict-pill ${res.verdict === 'ACCEPT' ? 'accept' : 'reject'}`;
    pill.textContent = res.verdict;
    header.appendChild(pill);

    card.appendChild(header);

    // Card Steps
    const stepsContainer = document.createElement('div');
    stepsContainer.className = 'trace-card-steps';

    // 1. Initial closure step
    const initialDiv = document.createElement('div');
    initialDiv.className = 'trace-step';
    initialDiv.setAttribute('data-step', '0');
    initialDiv.setAttribute('data-states', res.initialClosure.join(','));
    initialDiv.setAttribute('role', 'button');
    initialDiv.tabIndex = 0;
    initialDiv.style.cursor = 'pointer';

    const initMarker = document.createElement('span');
    initMarker.className = 'trace-step-marker';
    initMarker.textContent = '○';
    initialDiv.appendChild(initMarker);

    const initMapped = res.initialClosure.map(mapState).sort((a, b) => a - b);
    const initText = document.createTextNode(`Initial: {${initMapped.join(', ')}}`);
    initialDiv.appendChild(initText);

    const selectInitial = () => {
      container.querySelectorAll('.trace-step, .trace-status').forEach((el) => {
        el.classList.remove('active');
        el.removeAttribute('aria-pressed');
      });
      initialDiv.classList.add('active');
      initialDiv.setAttribute('aria-pressed', 'true');
      if (onStepSelect) {
        onStepSelect(res.initialClosure, false);
      }
    };
    initialDiv.addEventListener('click', selectInitial);
    initialDiv.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectInitial();
      }
    });
    stepsContainer.appendChild(initialDiv);

    // 2. Per-symbol steps
    for (let idx = 0; idx < res.afterEachSymbol.length; idx++) {
      const set = res.afterEachSymbol[idx];
      const char = codePoints[idx] ?? '';
      const stepDiv = document.createElement('div');
      stepDiv.className = 'trace-step';
      stepDiv.setAttribute('data-step', String(idx + 1));
      stepDiv.setAttribute('data-states', set.join(','));
      stepDiv.setAttribute('role', 'button');
      stepDiv.tabIndex = 0;
      stepDiv.style.cursor = 'pointer';

      const stepMarker = document.createElement('span');
      stepMarker.className = 'trace-step-marker';
      stepMarker.textContent = '●';
      stepDiv.appendChild(stepMarker);

      const mapped = set.map(mapState).sort((a, b) => a - b);
      const stepText = document.createTextNode(`After '${char}': {${mapped.join(', ')}}`);
      stepDiv.appendChild(stepText);

      const selectStep = () => {
        container.querySelectorAll('.trace-step, .trace-status').forEach((el) => {
          el.classList.remove('active');
          el.removeAttribute('aria-pressed');
        });
        stepDiv.classList.add('active');
        stepDiv.setAttribute('aria-pressed', 'true');
        if (onStepSelect) {
          onStepSelect(set, set.length === 0, idx);
        }
      };
      stepDiv.addEventListener('click', selectStep);
      stepDiv.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectStep();
        }
      });
      stepsContainer.appendChild(stepDiv);
    }

    // 3. Status row if dead or out_of_alphabet
    if (res.status === 'dead') {
      const deadDiv = document.createElement('div');
      deadDiv.className = 'trace-status dead';
      deadDiv.setAttribute('data-step', String(res.afterEachSymbol.length + 1));
      deadDiv.setAttribute('role', 'button');
      deadDiv.tabIndex = 0;
      deadDiv.style.cursor = 'pointer';

      const deadMarker = document.createElement('span');
      deadMarker.className = 'trace-step-marker';
      deadMarker.textContent = '⚠';
      deadDiv.appendChild(deadMarker);

      const deadText = document.createTextNode(`Dead at position ${res.position}`);
      deadDiv.appendChild(deadText);

      const selectDead = () => {
        container.querySelectorAll('.trace-step, .trace-status').forEach((el) => {
          el.classList.remove('active');
          el.removeAttribute('aria-pressed');
        });
        deadDiv.classList.add('active');
        deadDiv.setAttribute('aria-pressed', 'true');
        if (onStepSelect) {
          onStepSelect([], true, res.position);
        }
      };
      deadDiv.addEventListener('click', selectDead);
      deadDiv.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectDead();
        }
      });
      stepsContainer.appendChild(deadDiv);
    } else if (res.status === 'out_of_alphabet') {
      const errDiv = document.createElement('div');
      errDiv.className = 'trace-status error';

      const errMarker = document.createElement('span');
      errMarker.className = 'trace-step-marker';
      errMarker.textContent = '✕';
      errDiv.appendChild(errMarker);

      const errText = document.createTextNode(
        `Symbol '${res.symbol}' at position ${res.position} outside alphabet`
      );
      errDiv.appendChild(errText);
      stepsContainer.appendChild(errDiv);
    }

    card.appendChild(stepsContainer);
    container.appendChild(card);
  }
}
