import { describe, test, expect } from 'vitest';
import {
  clampZoom,
  zoomAt,
  panBy,
  fitToContainer,
  initialView,
  sameFrame,
  toTransformString,
  getEffectiveLimits,
  LEGIBLE_MIN_ZOOM,
  type ViewportState,
  type Rect
} from '../src/ui/viewport';

describe('Viewport Pure Maths (AC1 / D3 / D4 / D5)', () => {
  test('clampZoom clamps values to limits, supporting dynamic minZoom below 0.1', () => {
    // Default limits [0.1, 10]
    expect(clampZoom(1.0)).toBe(1.0);
    expect(clampZoom(12.5)).toBe(10.0);
    expect(clampZoom(0.05)).toBe(0.1);

    // Dynamic minZoom for large diagrams (fitZoom = 0.05 < 0.1)
    const largeLimits = getEffectiveLimits(0.05);
    expect(largeLimits.minZoom).toBeCloseTo(0.05);
    expect(clampZoom(0.05, largeLimits)).toBeCloseTo(0.05);
    expect(clampZoom(0.02, largeLimits)).toBeCloseTo(0.05);

    // If fitZoom >= 0.1, minZoom remains 0.1
    const normalLimits = getEffectiveLimits(0.6);
    expect(normalLimits.minZoom).toBe(0.1);
  });

  test('zoomAt preserves the point under the focal point (focal invariance)', () => {
    const current: ViewportState = { zoom: 1.0, panX: 50, panY: 30 };
    const focal = { x: 300, y: 200 };
    const factor = 1.2;

    const next = zoomAt(current, factor, focal);

    // Point in content space before zoom
    const contentXBefore = (focal.x - current.panX) / current.zoom;
    const contentYBefore = (focal.y - current.panY) / current.zoom;

    // Point in content space after zoom
    const contentXAfter = (focal.x - next.panX) / next.zoom;
    const contentYAfter = (focal.y - next.panY) / next.zoom;

    expect(contentXAfter).toBeCloseTo(contentXBefore, 5);
    expect(contentYAfter).toBeCloseTo(contentYBefore, 5);
    expect(next.zoom).toBeCloseTo(1.2, 5);
    // panX = 300 - (300 - 50) * 1.2 = 300 - 300 = 0
    expect(next.panX).toBeCloseTo(0, 5);
    // panY = 200 - (200 - 30) * 1.2 = 200 - 204 = -4
    expect(next.panY).toBeCloseTo(-4, 5);
  });

  test('panBy shifts panX and panY by delta with correct sign', () => {
    const current: ViewportState = { zoom: 1.5, panX: 100, panY: 50 };
    const delta = { dx: 30, dy: -20 };
    const next = panBy(current, delta);

    expect(next.zoom).toBe(1.5);
    expect(next.panX).toBe(130);
    expect(next.panY).toBe(30);
  });

  test('fitToContainer calculates exact scale and centering in rendered px', () => {
    const content: Rect = { width: 2000, height: 400 };
    const container: Rect = { width: 1000, height: 500 };

    const fit = fitToContainer(content, container);
    // fitZoom = min(1000/2000, 500/400) = min(0.5, 1.25) = 0.5
    expect(fit.zoom).toBeCloseTo(0.5);
    // panX = (1000 - 2000 * 0.5) / 2 = 0
    expect(fit.panX).toBeCloseTo(0);
    // panY = (500 - 400 * 0.5) / 2 = 150
    expect(fit.panY).toBeCloseTo(150);
  });

  test('initialView handles all D4 modes: smaller, legible fit, and illegible wide', () => {
    const container: Rect = { width: 1200, height: 600 };

    // 1. Content smaller than frame -> zoom 1, centered, mode fit
    const smallContent: Rect = { width: 400, height: 200 };
    const v1 = initialView(smallContent, container);
    expect(v1.mode).toBe('fit');
    expect(v1.zoom).toBe(1.0);
    expect(v1.panX).toBeCloseTo((1200 - 400) / 2); // 400
    expect(v1.panY).toBeCloseTo((600 - 200) / 2); // 200

    // 2. Moderately oversized (0.5 <= fitZoom < 1) -> fit, mode fit
    const medContent: Rect = { width: 1600, height: 400 };
    // fitZoom = min(1200/1600, 600/400) = min(0.75, 1.5) = 0.75 >= 0.5
    const v2 = initialView(medContent, container);
    expect(v2.mode).toBe('fit');
    expect(v2.zoom).toBeCloseTo(0.75);
    expect(v2.panX).toBeCloseTo((1200 - 1600 * 0.75) / 2); // 0
    expect(v2.panY).toBeCloseTo((600 - 400 * 0.75) / 2); // 150

    // 3. Very wide diagram (fitZoom < LEGIBLE_MIN_ZOOM 0.5) -> zoom 1, left-anchored, vertically centered, mode start
    const wideContent: Rect = { width: 20000, height: 180 };
    // fitZoom = min(1200/20000, 600/180) = 0.06 < 0.5
    const v3 = initialView(wideContent, container);
    expect(v3.mode).toBe('start');
    expect(v3.zoom).toBe(1.0);
    expect(v3.panX).toBe(0); // left edge anchored
    expect(v3.panY).toBeCloseTo((600 - 180) / 2); // 210 (vertically centered)
  });

  test('sameFrame checks D5 persistence rule', () => {
    expect(sameFrame('0.00 0.00 823.00 349.00', '0.00 0.00 823.00 349.00')).toBe(true);
    expect(sameFrame('0 0 823 349', '0.00 0.00 823.00 349.00')).toBe(false);
    expect(sameFrame('0.00 0.00 823.00 349.00', '0.00 0.00 316.00 102.00')).toBe(false);
    expect(sameFrame(null, '0.00 0.00 823.00 349.00')).toBe(false);
    expect(sameFrame('0.00 0.00 823.00 349.00', undefined)).toBe(false);
    expect(sameFrame('', '')).toBe(false);
  });

  test('toTransformString formats CSS transform matrix/translate-scale string', () => {
    const state: ViewportState = { zoom: 1.25, panX: -45.5, panY: 12.34 };
    expect(toTransformString(state)).toBe('translate(-45.50px, 12.34px) scale(1.2500)');
  });
});
