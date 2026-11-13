export interface ViewportState {
  zoom: number;
  panX: number;
  panY: number;
}

export interface ViewportLimits {
  minZoom: number;
  maxZoom: number;
}

export interface Rect {
  width: number;
  height: number;
}

export type ViewportMode = 'fit' | 'start' | 'manual';

export const LEGIBLE_MIN_ZOOM = 0.5;
export const DEFAULT_MAX_ZOOM = 10.0;
export const DEFAULT_MIN_ZOOM = 0.1;

export function getEffectiveLimits(fitZoom?: number, maxZoom = DEFAULT_MAX_ZOOM): ViewportLimits {
  const minZoom = fitZoom !== undefined ? Math.min(DEFAULT_MIN_ZOOM, fitZoom) : DEFAULT_MIN_ZOOM;
  return { minZoom, maxZoom };
}

export function clampZoom(zoom: number, limits?: ViewportLimits): number {
  const min = limits ? limits.minZoom : DEFAULT_MIN_ZOOM;
  const max = limits ? limits.maxZoom : DEFAULT_MAX_ZOOM;
  return Math.min(Math.max(zoom, min), max);
}

export function zoomAt(
  current: ViewportState,
  factor: number,
  focalPoint: { x: number; y: number },
  limits?: ViewportLimits
): ViewportState {
  const newZoom = clampZoom(current.zoom * factor, limits);
  const actualFactor = newZoom / current.zoom;
  const panX = focalPoint.x - (focalPoint.x - current.panX) * actualFactor;
  const panY = focalPoint.y - (focalPoint.y - current.panY) * actualFactor;
  return { zoom: newZoom, panX, panY };
}

export function panBy(current: ViewportState, delta: { dx: number; dy: number }): ViewportState {
  return {
    zoom: current.zoom,
    panX: current.panX + delta.dx,
    panY: current.panY + delta.dy
  };
}

export function fitToContainer(
  content: Rect,
  container: Rect,
  padding = 0
): { zoom: number; panX: number; panY: number } {
  const availW = Math.max(1, container.width - 2 * padding);
  const availH = Math.max(1, container.height - 2 * padding);
  const rawFitZoom = Math.min(availW / content.width, availH / content.height);
  // Floor to 4 decimal places to prevent toFixed(4) rounding up beyond available container bounds
  const fitZoom = Math.floor(rawFitZoom * 10000) / 10000;
  const panX = (container.width - content.width * fitZoom) / 2;
  const panY = (container.height - content.height * fitZoom) / 2;
  return { zoom: fitZoom, panX, panY };
}

export function initialView(
  content: Rect,
  container: Rect,
  padding = 0
): ViewportState & { mode: 'fit' | 'start' } {
  const isSmaller = content.width <= container.width && content.height <= container.height;
  if (isSmaller) {
    return {
      zoom: 1.0,
      panX: (container.width - content.width) / 2,
      panY: (container.height - content.height) / 2,
      mode: 'fit'
    };
  }

  const availW = Math.max(1, container.width - 2 * padding);
  const availH = Math.max(1, container.height - 2 * padding);
  const rawFitZoom = Math.min(availW / content.width, availH / content.height);
  const fitZoom = Math.floor(rawFitZoom * 10000) / 10000;

  if (fitZoom >= LEGIBLE_MIN_ZOOM) {
    return {
      zoom: fitZoom,
      panX: (container.width - content.width * fitZoom) / 2,
      panY: (container.height - content.height * fitZoom) / 2,
      mode: 'fit'
    };
  }

  return {
    zoom: 1.0,
    panX: 0,
    panY: (container.height - content.height * 1.0) / 2,
    mode: 'start'
  };
}

export function sameFrame(
  prevViewBox: string | null | undefined,
  nextViewBox: string | null | undefined
): boolean {
  if (!prevViewBox || !nextViewBox) return false;
  const p = prevViewBox.trim();
  const n = nextViewBox.trim();
  if (p === '' || n === '') return false;
  return p === n;
}

export function toTransformString(state: ViewportState): string {
  return `translate(${state.panX.toFixed(2)}px, ${state.panY.toFixed(2)}px) scale(${state.zoom.toFixed(4)})`;
}
