export interface TouchGestureCallbacks {
  onPan: (dx: number, dy: number) => void;
  onPinch: (focalPoint: { x: number; y: number }, scaleFactor: number) => void;
  onDoubleTap?: () => void;
}

export function attachTouchGestures(
  canvasEl: HTMLElement,
  callbacks: TouchGestureCallbacks
): (() => void) | undefined {
  if (!canvasEl) return;

  const pointers = new Map<number, { x: number; y: number }>();
  let lastDistance = 0;
  let lastTapTime = 0;

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 1) {
      const now = Date.now();
      if (now - lastTapTime < 350) {
        callbacks.onDoubleTap?.();
        lastTapTime = 0;
      } else {
        lastTapTime = now;
      }
    } else if (pointers.size === 2) {
      const pts = Array.from(pointers.values());
      lastDistance = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    }

    try {
      canvasEl.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    e.preventDefault();
  };

  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType !== 'touch' || !pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId)!;
    const current = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, current);

    if (pointers.size === 1) {
      const dx = current.x - prev.x;
      const dy = current.y - prev.y;
      callbacks.onPan(dx, dy);
    } else if (pointers.size === 2) {
      const pts = Array.from(pointers.values());
      const newDistance = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (lastDistance > 0 && newDistance > 0) {
        const scaleFactor = newDistance / lastDistance;
        const focalPoint = {
          x: (pts[0].x + pts[1].x) / 2,
          y: (pts[0].y + pts[1].y) / 2,
        };
        callbacks.onPinch(focalPoint, scaleFactor);
      }
      lastDistance = newDistance;
    }
    e.preventDefault();
  };

  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) {
      lastDistance = 0;
    }
    try {
      canvasEl.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  canvasEl.addEventListener('pointerdown', onPointerDown);
  canvasEl.addEventListener('pointermove', onPointerMove);
  canvasEl.addEventListener('pointerup', onPointerUp);
  canvasEl.addEventListener('pointercancel', onPointerUp);

  return () => {
    canvasEl.removeEventListener('pointerdown', onPointerDown);
    canvasEl.removeEventListener('pointermove', onPointerMove);
    canvasEl.removeEventListener('pointerup', onPointerUp);
    canvasEl.removeEventListener('pointercancel', onPointerUp);
  };
}

