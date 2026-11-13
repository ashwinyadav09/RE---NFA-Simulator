import { describe, it, expect } from 'vitest';
import { parseRoute, formatRoute, isLegacyAlias, getRouteTitle } from '../src/ui/router';

describe('src/ui/router', () => {
  describe('parseRoute', () => {
    it('defaults empty hash or # to workbench', () => {
      expect(parseRoute('')).toBe('workbench');
      expect(parseRoute('#')).toBe('workbench');
      expect(parseRoute('#/')).toBe('workbench');
    });

    it('parses valid route hashes', () => {
      expect(parseRoute('#workbench')).toBe('workbench');
      expect(parseRoute('#validation')).toBe('validation');
      expect(parseRoute('#stress')).toBe('stress');
      expect(parseRoute('workbench')).toBe('workbench');
      expect(parseRoute('validation')).toBe('validation');
      expect(parseRoute('stress')).toBe('stress');
    });

    it('maps legacy alias hashes correctly', () => {
      expect(parseRoute('#validation-panel')).toBe('validation');
      expect(parseRoute('validation-panel')).toBe('validation');
      expect(parseRoute('#stress-section')).toBe('stress');
      expect(parseRoute('stress-section')).toBe('stress');
    });

    it('falls back to workbench for unknown hashes', () => {
      expect(parseRoute('#unknown')).toBe('workbench');
      expect(parseRoute('#foo-bar')).toBe('workbench');
      expect(parseRoute('#random?query=1')).toBe('workbench');
    });
  });

  describe('formatRoute', () => {
    it('formats route enum to hash string', () => {
      expect(formatRoute('workbench')).toBe('#workbench');
      expect(formatRoute('validation')).toBe('#validation');
      expect(formatRoute('stress')).toBe('#stress');
    });
  });

  describe('isLegacyAlias', () => {
    it('detects legacy aliases', () => {
      expect(isLegacyAlias('#validation-panel')).toBe(true);
      expect(isLegacyAlias('#stress-section')).toBe(true);
      expect(isLegacyAlias('validation-panel')).toBe(true);
      expect(isLegacyAlias('stress-section')).toBe(true);
      expect(isLegacyAlias('#validation')).toBe(false);
      expect(isLegacyAlias('#stress')).toBe(false);
      expect(isLegacyAlias('#workbench')).toBe(false);
    });
  });

  describe('getRouteTitle', () => {
    it('returns document title for each route', () => {
      expect(getRouteTitle('workbench')).toBe('RE → NFA Simulator — Workbench');
      expect(getRouteTitle('validation')).toBe('RE → NFA Simulator — Validation');
      expect(getRouteTitle('stress')).toBe('RE → NFA Simulator — Stress Test');
    });
  });
});

