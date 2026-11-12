import { describe, it, expect, vi } from 'vitest';
import {
  THEME_STORAGE_KEY,
  getSavedTheme,
  saveTheme,
  applyTheme,
  initTheme,
  type ThemeMode
} from '../src/ui/theme.js';

class MockStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) || null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  clear(): void {
    this.store.clear();
  }
}

class MockElement {
  attrs = new Map<string, string>();
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }
  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }
  getAttribute(name: string): string | null {
    return this.attrs.get(name) || null;
  }
  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }
}

class MockSelect {
  value = '';
  listeners: Record<string, (() => void)[]> = {};
  addEventListener(type: string, listener: () => void): void {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(listener);
  }
  trigger(type: string): void {
    this.listeners[type]?.forEach(fn => fn());
  }
}

describe('theme management (src/ui/theme.ts)', () => {
  it('defaults to system when no theme is saved', () => {
    const storage = new MockStorage();
    expect(getSavedTheme(storage)).toBe('system');
  });

  it('saves and retrieves light and dark themes', () => {
    const storage = new MockStorage();
    saveTheme('dark', storage);
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(getSavedTheme(storage)).toBe('dark');

    saveTheme('light', storage);
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(getSavedTheme(storage)).toBe('light');
  });

  it('handles storage errors gracefully', () => {
    const brokenStorage = {
      getItem: () => { throw new Error('Storage denied'); },
      setItem: () => { throw new Error('Quota exceeded'); }
    };
    expect(getSavedTheme(brokenStorage)).toBe('system');
    expect(() => saveTheme('dark', brokenStorage)).not.toThrow();
  });

  it('applies data-theme attribute correctly to root element', () => {
    const root = new MockElement();
    applyTheme('dark', root);
    expect(root.getAttribute('data-theme')).toBe('dark');

    applyTheme('light', root);
    expect(root.getAttribute('data-theme')).toBe('light');

    applyTheme('system', root);
    expect(root.hasAttribute('data-theme')).toBe(false);
  });

  it('wires theme-select and updates theme on change event', () => {
    const storage = new MockStorage();
    storage.setItem(THEME_STORAGE_KEY, 'dark');
    const root = new MockElement();
    const select = new MockSelect();

    initTheme(select, storage as any, root);
    expect(select.value).toBe('dark');
    expect(root.getAttribute('data-theme')).toBe('dark');

    // Change to light
    select.value = 'light';
    select.trigger('change');
    expect(root.getAttribute('data-theme')).toBe('light');
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe('light');

    // Change to system
    select.value = 'system';
    select.trigger('change');
    expect(root.hasAttribute('data-theme')).toBe(false);
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe('system');
  });
});
