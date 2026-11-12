import { describe, it, expect, vi, beforeEach } from 'vitest';
import { attachTouchGestures, TouchGestureCallbacks } from '../src/ui/canvas-touch.js';

class MockElement {
  listeners: Record<string, ((e: any) => void)[]> = {};

  addEventListener(type: string, fn: (e: any) => void): void {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(fn);
  }

  removeEventListener(type: string, fn: (e: any) => void): void {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter((l) => l !== fn);
  }

  dispatchEvent(e: any): void {
    const list = this.listeners[e.type] || [];
    for (const fn of list) {
      fn(e);
    }
  }

  setPointerCapture(): void {}
  releasePointerCapture(): void {}
}

describe('canvas-touch module', () => {
  let mockEl: MockElement;
  let callbacks: TouchGestureCallbacks;

  beforeEach(() => {
    mockEl = new MockElement();
    callbacks = {
      onPan: vi.fn(),
      onPinch: vi.fn(),
      onDoubleTap: vi.fn(),
    };
  });

  it('ignores mouse/non-touch pointer events', () => {
    attachTouchGestures(mockEl as unknown as HTMLElement, callbacks);

    mockEl.dispatchEvent({
      type: 'pointerdown',
      pointerType: 'mouse',
      pointerId: 1,
      clientX: 100,
      clientY: 100,
      preventDefault: vi.fn(),
    });

    mockEl.dispatchEvent({
      type: 'pointermove',
      pointerType: 'mouse',
      pointerId: 1,
      clientX: 120,
      clientY: 120,
      preventDefault: vi.fn(),
    });

    expect(callbacks.onPan).not.toHaveBeenCalled();
  });

  it('handles single-finger touch pan', () => {
    attachTouchGestures(mockEl as unknown as HTMLElement, callbacks);

    mockEl.dispatchEvent({
      type: 'pointerdown',
      pointerType: 'touch',
      pointerId: 1,
      clientX: 100,
      clientY: 100,
      preventDefault: vi.fn(),
    });

    mockEl.dispatchEvent({
      type: 'pointermove',
      pointerType: 'touch',
      pointerId: 1,
      clientX: 130,
      clientY: 140,
      preventDefault: vi.fn(),
    });

    expect(callbacks.onPan).toHaveBeenCalledWith(30, 40);
  });

  it('handles two-finger touch pinch zoom', () => {
    attachTouchGestures(mockEl as unknown as HTMLElement, callbacks);

    // Pointer 1 down at (100, 100)
    mockEl.dispatchEvent({
      type: 'pointerdown',
      pointerType: 'touch',
      pointerId: 1,
      clientX: 100,
      clientY: 100,
      preventDefault: vi.fn(),
    });

    // Pointer 2 down at (200, 100) -> initial distance = 100
    mockEl.dispatchEvent({
      type: 'pointerdown',
      pointerType: 'touch',
      pointerId: 2,
      clientX: 200,
      clientY: 100,
      preventDefault: vi.fn(),
    });

    // Pointer 2 moves to (300, 100) -> new distance = 200
    mockEl.dispatchEvent({
      type: 'pointermove',
      pointerType: 'touch',
      pointerId: 2,
      clientX: 300,
      clientY: 100,
      preventDefault: vi.fn(),
    });

    expect(callbacks.onPinch).toHaveBeenCalled();
    const calls = (callbacks.onPinch as any).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const [focal, factor] = calls[0];
    expect(focal.x).toBe(200); // (100 + 300) / 2
    expect(focal.y).toBe(100);
    expect(factor).toBeCloseTo(2.0, 1);
  });

  it('detects double-tap within threshold', () => {
    attachTouchGestures(mockEl as unknown as HTMLElement, callbacks);

    // First tap
    mockEl.dispatchEvent({
      type: 'pointerdown',
      pointerType: 'touch',
      pointerId: 1,
      clientX: 100,
      clientY: 100,
      preventDefault: vi.fn(),
    });
    mockEl.dispatchEvent({
      type: 'pointerup',
      pointerType: 'touch',
      pointerId: 1,
      preventDefault: vi.fn(),
    });

    // Second tap immediately
    mockEl.dispatchEvent({
      type: 'pointerdown',
      pointerType: 'touch',
      pointerId: 1,
      clientX: 100,
      clientY: 100,
      preventDefault: vi.fn(),
    });

    expect(callbacks.onDoubleTap).toHaveBeenCalled();
  });
});

