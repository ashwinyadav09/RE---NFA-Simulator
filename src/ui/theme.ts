/**
 * Theme management: Light, Dark, and System modes.
 * Design System: Thompson Drafting Table (design.md §5.1, §15.3, Amendment A8)
 * Storage: 're-nfa:theme' in localStorage (wrapped in try/catch).
 */

export const THEME_STORAGE_KEY = 're-nfa:theme';

export type ThemeMode = 'system' | 'light' | 'dark';

export interface ThemeTargetElement {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

export interface ThemeSelectElement {
  value: string;
  addEventListener(type: string, listener: () => void): void;
}

export function getSavedTheme(storage?: Pick<Storage, 'getItem'>): ThemeMode {
  try {
    const s = storage !== undefined ? storage : (typeof localStorage !== 'undefined' ? localStorage : null);
    const val = s?.getItem(THEME_STORAGE_KEY);
    if (val === 'light' || val === 'dark' || val === 'system') {
      return val;
    }
  } catch (_) {
    // LocalStorage inaccessible (e.g. sandboxed iframe or private mode)
  }
  return 'system';
}

export function saveTheme(theme: ThemeMode, storage?: Pick<Storage, 'setItem'>): void {
  try {
    const s = storage !== undefined ? storage : (typeof localStorage !== 'undefined' ? localStorage : null);
    s?.setItem(THEME_STORAGE_KEY, theme);
  } catch (_) {
    // Ignore storage quota or security errors
  }
}

export function applyTheme(theme: ThemeMode, targetEl?: ThemeTargetElement | null): void {
  const el = targetEl !== undefined ? targetEl : (typeof document !== 'undefined' ? document.documentElement : null);
  if (!el) return;

  if (theme === 'dark' || theme === 'light') {
    el.setAttribute('data-theme', theme);
  } else {
    el.removeAttribute('data-theme');
  }
}

export function initTheme(
  selectEl?: ThemeSelectElement | null,
  storage?: Storage,
  targetEl?: ThemeTargetElement | null
): void {
  const currentTheme = getSavedTheme(storage);
  applyTheme(currentTheme, targetEl);

  const themeSelect = selectEl !== undefined
    ? selectEl
    : (typeof document !== 'undefined' ? (document.getElementById('theme-select') as HTMLSelectElement | null) : null);

  if (themeSelect) {
    themeSelect.value = currentTheme;
    themeSelect.addEventListener('change', () => {
      const selected = (themeSelect.value || 'system') as ThemeMode;
      applyTheme(selected, targetEl);
      saveTheme(selected, storage);
    });
  }
}
