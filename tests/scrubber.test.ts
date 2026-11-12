import { describe, it, expect, vi } from 'vitest';
import { syncScrubberState, wireScrubber, type ScrubberTarget } from '../src/ui/scrubber.js';

class MockScrubber implements ScrubberTarget {
  min = '1';
  max = '1';
  value = '1';
  disabled = true;
  listeners: Record<string, (() => void)[]> = {};

  addEventListener(type: string, listener: () => void): void {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(listener);
  }

  trigger(type: string): void {
    this.listeners[type]?.forEach(fn => fn());
  }
}

describe('scrubber (src/ui/scrubber.ts)', () => {
  it('disables scrubber when total steps is 0', () => {
    const s = new MockScrubber();
    syncScrubberState(s, 0, 0);
    expect(s.disabled).toBe(true);
    expect(s.value).toBe('1');
  });

  it('disables scrubber in final view', () => {
    const s = new MockScrubber();
    syncScrubberState(s, 3, 6, true);
    expect(s.disabled).toBe(true);
  });

  it('enables scrubber and clamps step within valid bounds [1, totalSteps]', () => {
    const s = new MockScrubber();
    syncScrubberState(s, 4, 10, false);
    expect(s.disabled).toBe(false);
    expect(s.min).toBe('1');
    expect(s.max).toBe('10');
    expect(s.value).toBe('4');

    // Clamp over max
    syncScrubberState(s, 15, 10, false);
    expect(s.value).toBe('10');

    // Clamp under min
    syncScrubberState(s, 0, 10, false);
    expect(s.value).toBe('1');
  });

  it('wires input and change events to onStepChange callback', () => {
    const s = new MockScrubber();
    const onStepChange = vi.fn();
    wireScrubber(s, onStepChange);

    s.value = '5';
    s.trigger('input');
    expect(onStepChange).toHaveBeenCalledWith(5);

    s.value = '8';
    s.trigger('change');
    expect(onStepChange).toHaveBeenCalledWith(8);
  });
});

