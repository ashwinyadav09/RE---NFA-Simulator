import { describe, it, expect } from 'vitest';
import { formatBuildStamp } from '../src/ui/stamp.js';

describe('formatBuildStamp', () => {
  it('returns commit hash when provided', () => {
    expect(formatBuildStamp('68fce05')).toBe('68fce05');
  });

  it('preserves -dirty suffix when provided', () => {
    expect(formatBuildStamp('68fce05-dirty')).toBe('68fce05-dirty');
  });

  it('falls back to "unknown" when undefined or empty', () => {
    expect(formatBuildStamp(undefined)).toMatch(/^([0-9a-f]{7,}(-dirty)?|unknown)$/i);
    expect(formatBuildStamp('')).toBe('unknown');
  });
});
