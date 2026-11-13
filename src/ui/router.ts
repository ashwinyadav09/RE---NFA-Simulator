/**
 * Pure client-side hash routing for RE → NFA Simulator.
 * Supports #workbench (default), #validation, #stress.
 * Maps legacy aliases #validation-panel and #stress-section.
 */

export type PageRoute = 'workbench' | 'validation' | 'stress';

export const LEGACY_ROUTE_MAP: Record<string, PageRoute> = {
  '#validation-panel': 'validation',
  'validation-panel': 'validation',
  '#stress-section': 'stress',
  'stress-section': 'stress',
};

const TITLES: Record<PageRoute, string> = {
  workbench: 'RE → NFA Simulator — Workbench',
  validation: 'RE → NFA Simulator — Validation',
  stress: 'RE → NFA Simulator — Stress Test',
};

export function parseRoute(hash: string): PageRoute {
  if (!hash) return 'workbench';
  const clean = hash.trim();
  if (clean === '#' || clean === '#/' || clean === '') return 'workbench';

  if (clean in LEGACY_ROUTE_MAP) {
    return LEGACY_ROUTE_MAP[clean];
  }

  const bare = clean.startsWith('#') ? clean.slice(1) : clean;
  if (bare in LEGACY_ROUTE_MAP) {
    return LEGACY_ROUTE_MAP[bare];
  }

  if (bare === 'workbench' || bare === 'validation' || bare === 'stress') {
    return bare;
  }

  return 'workbench';
}

export function formatRoute(route: PageRoute): string {
  return '#' + route;
}

export function isLegacyAlias(hash: string): boolean {
  if (!hash) return false;
  const clean = hash.trim();
  return clean in LEGACY_ROUTE_MAP;
}

export function getRouteTitle(route: PageRoute): string {
  return TITLES[route] || TITLES.workbench;
}

