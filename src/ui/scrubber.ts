/**
 * Construction Step Scrubber
 * Design System: Thompson Drafting Table (design.md §6.6, Amendment Q7)
 * Wraps range input to synchronize with step navigation state.
 */

export interface ScrubberTarget {
  min: string;
  max: string;
  value: string;
  disabled: boolean;
  addEventListener(type: string, listener: () => void): void;
}

export function syncScrubberState(
  target: Pick<ScrubberTarget, 'min' | 'max' | 'value' | 'disabled'>,
  currentStep: number,
  totalSteps: number,
  isFinalView: boolean = false
): void {
  if (totalSteps <= 0 || isFinalView) {
    target.disabled = true;
    target.min = '1';
    target.max = '1';
    target.value = '1';
  } else {
    target.disabled = false;
    target.min = '1';
    target.max = String(totalSteps);
    const clamped = Math.min(Math.max(1, currentStep), totalSteps);
    target.value = String(clamped);
  }
}

export function wireScrubber(
  target: ScrubberTarget,
  onStepChange: (step: number) => void
): () => void {
  const handler = () => {
    const val = parseInt(target.value, 10);
    if (!isNaN(val)) {
      onStepChange(val);
    }
  };

  target.addEventListener('input', handler);
  target.addEventListener('change', handler);

  return handler;
}

