import type { Preset } from '../engine';

export interface LegendItem {
  id: string;
  title: string;
  desc: string;
}

export const LEGEND_ITEMS: readonly LegendItem[] = [
  { id: 'start-state', title: 'Start State', desc: 'Initial state; entry point of the automaton' },
  { id: 'accept-state', title: 'Accept State', desc: 'Terminal state indicating acceptance of input string' },
  { id: 'symbol-transition', title: 'Symbol Transition', desc: 'Consumes matching character from input' },
  { id: 'eps-transition', title: 'ε-Transition', desc: 'Moves state without consuming input (epsilon)' },
  { id: 'new-step', title: 'New at this step', desc: 'Added by the active sub-expression construction' },
  { id: 'active-sim', title: 'Active in simulation', desc: 'States reachable after current input trace prefix' },
];

export function getLegendItems(): readonly LegendItem[] {
  return LEGEND_ITEMS;
}

export function isLegendOpen(legendEl: HTMLElement): boolean {
  return !legendEl.classList.contains('hidden');
}

export function openLegend(legendEl: HTMLElement, legendBtn?: HTMLElement | null): void {
  legendEl.classList.remove('hidden');
  if (legendBtn) {
    legendBtn.setAttribute('aria-expanded', 'true');
  }
}

export function closeLegend(legendEl: HTMLElement, legendBtn?: HTMLElement | null): void {
  legendEl.classList.add('hidden');
  if (legendBtn) {
    legendBtn.setAttribute('aria-expanded', 'false');
  }
}

export function toggleLegend(legendEl: HTMLElement, legendBtn?: HTMLElement | null): boolean {
  if (isLegendOpen(legendEl)) {
    closeLegend(legendEl, legendBtn);
    return false;
  } else {
    openLegend(legendEl, legendBtn);
    return true;
  }
}

export function formatPresetDescription(presetId: string, presets: readonly Preset[]): string {
  const preset = presets.find((p) => p.id === presetId);
  return preset?.description || '';
}

function getLegendSampleSvg(id: string): string {
  switch (id) {
    case 'start-state':
      return `<svg class="legend-sample" width="32" height="32" viewBox="0 0 32 32" aria-hidden="true"><circle cx="4" cy="16" r="2.5" fill="currentColor"></circle><line x1="5" y1="16" x2="16" y2="16" stroke="currentColor" stroke-width="1.5"></line><circle cx="22" cy="16" r="7" fill="var(--bg-canvas)" stroke="currentColor" stroke-width="1.5"></circle></svg>`;
    case 'accept-state':
      return `<svg class="legend-sample" width="32" height="32" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="11" fill="var(--bg-canvas)" stroke="currentColor" stroke-width="1.5"></circle><circle cx="16" cy="16" r="7.5" fill="var(--bg-canvas)" stroke="currentColor" stroke-width="1.25"></circle></svg>`;
    case 'symbol-transition':
      return `<svg class="legend-sample" width="32" height="32" viewBox="0 0 32 32" aria-hidden="true"><line x1="2" y1="18" x2="26" y2="18" stroke="currentColor" stroke-width="1.5"></line><polygon points="26,18 20,15 20,21" fill="currentColor"></polygon><text x="14" y="12" font-size="10" font-family="var(--font-mono)" text-anchor="middle" fill="currentColor">a</text></svg>`;
    case 'eps-transition':
      return `<svg class="legend-sample" width="32" height="32" viewBox="0 0 32 32" aria-hidden="true"><line x1="2" y1="18" x2="26" y2="18" stroke="var(--text-muted)" stroke-width="1.5" stroke-dasharray="3 2"></line><polygon points="26,18 20,15 20,21" fill="var(--text-muted)"></polygon><text x="14" y="12" font-size="10" font-family="var(--font-mono)" text-anchor="middle" fill="var(--text-muted)">ε</text></svg>`;
    case 'new-step':
      return `<svg class="legend-sample" width="32" height="32" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="9" fill="var(--bg-canvas)" stroke="var(--vermilion-new, #c84b31)" stroke-width="2.5"></circle></svg>`;
    case 'active-sim':
      return `<svg class="legend-sample" width="32" height="32" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="9" fill="var(--color-primary-soft, rgba(46, 117, 182, 0.2))" stroke="var(--color-primary, #2e75b6)" stroke-width="2"></circle></svg>`;
    default:
      return '';
  }
}

export function renderLegendItems(container: HTMLElement): void {
  const items = getLegendItems();
  container.innerHTML = items
    .map(
      (item) => `
    <div class="legend-item" data-legend="${item.id}">
      ${getLegendSampleSvg(item.id)}
      <div class="legend-text">
        <div class="legend-item-title">${item.title}</div>
        <div class="legend-item-desc">${item.desc}</div>
      </div>
    </div>`
    )
    .join('');
}

export function initLegend(
  legendBtn: HTMLElement | null,
  legendEl: HTMLElement | null,
  closeBtn: HTMLElement | null
): (() => void) | undefined {
  if (!legendEl || !legendBtn) return;

  const bodyEl = legendEl.querySelector('.canvas-legend-body') as HTMLElement | null;
  if (bodyEl && bodyEl.children.length === 0) {
    renderLegendItems(bodyEl);
  }

  const handleToggle = (e: MouseEvent) => {
    e.stopPropagation();
    toggleLegend(legendEl, legendBtn);
  };

  const handleClose = (e: MouseEvent) => {
    e.stopPropagation();
    closeLegend(legendEl, legendBtn);
    legendBtn.focus();
  };

  const handleDocClick = (e: MouseEvent) => {
    if (isLegendOpen(legendEl)) {
      const target = e.target as Node;
      if (!legendEl.contains(target) && !legendBtn.contains(target)) {
        closeLegend(legendEl, legendBtn);
      }
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && isLegendOpen(legendEl)) {
      e.stopPropagation();
      closeLegend(legendEl, legendBtn);
    }
  };

  legendBtn.addEventListener('click', handleToggle);
  if (closeBtn) {
    closeBtn.addEventListener('click', handleClose);
  }
  document.addEventListener('click', handleDocClick);
  document.addEventListener('keydown', handleKeyDown);

  return () => {
    legendBtn.removeEventListener('click', handleToggle);
    if (closeBtn) closeBtn.removeEventListener('click', handleClose);
    document.removeEventListener('click', handleDocClick);
    document.removeEventListener('keydown', handleKeyDown);
  };
}
