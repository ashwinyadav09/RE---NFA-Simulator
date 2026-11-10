import { test, expect } from 'vitest';
import { encodeAppState, decodeAppState, type AppUrlState } from '../src/ui/url';

test('round-trip serialization of special characters (+, &, #, %, space, |, (, ), *, ?, ε, ∅, non-ASCII)', () => {
  const state: AppUrlState = {
    regex: '(a+b)*a#&% ε∅ 🚀',
    notation: 'textbook',
    concat: 'merge',
    preset: 'star-star-b',
    alphabet: 'a, b, c, ε, ∅',
    input: 'a+b\n&%# \nε∅',
    view: 'textbook',
    step: 4,
    compact: true
  };

  const encoded = encodeAppState(state);
  // Ensure + is encoded as %2B in the encoded query string
  expect(encoded).toContain('%2B');

  const decoded = decodeAppState(encoded);
  expect(decoded.ignoredKeys).toEqual([]);
  expect(decoded.state).toEqual(state);
});

test('encodeAppState only includes non-default values or defined properties', () => {
  const minimal: AppUrlState = {
    regex: 'a*b'
  };
  const encoded = encodeAppState(minimal);
  expect(encoded).toBe('regex=a*b');

  const decoded = decodeAppState(encoded);
  expect(decoded.ignoredKeys).toEqual([]);
  expect(decoded.state.regex).toBe('a*b');
});

test('decodeAppState ignores unknown query keys silently', () => {
  const query = 'regex=a*b&foo=bar&utm_source=course&step=2';
  const res = decodeAppState(query);
  expect(res.ignoredKeys).toEqual([]);
  expect(res.state.regex).toBe('a*b');
  expect(res.state.step).toBe(2);
  expect((res.state as any).foo).toBeUndefined();
  expect((res.state as any).utm_source).toBeUndefined();
});

test('decodeAppState reports invalid parameter values in ignoredKeys and falls back safely', () => {
  const query = 'regex=a*b&notation=invalid_notation&concat=invalid_concat&view=invalid_view&step=-5&compact=maybe';
  const res = decodeAppState(query);
  expect(res.ignoredKeys.sort()).toEqual(['compact', 'concat', 'notation', 'step', 'view'].sort());
  expect(res.state.regex).toBe('a*b');
  expect(res.state.notation).toBeUndefined();
  expect(res.state.concat).toBeUndefined();
  expect(res.state.view).toBeUndefined();
  expect(res.state.step).toBeUndefined();
  expect(res.state.compact).toBeUndefined();
});

test('decodeAppState enforces limits (query, regex, input)', () => {
  // Regex over 2000 chars is ignored and reported
  const longRegex = 'a'.repeat(2001);
  const resRegex = decodeAppState(`regex=${longRegex}`);
  expect(resRegex.ignoredKeys).toContain('regex');
  expect(resRegex.state.regex).toBeUndefined();

  // Input over 1000 chars is ignored and reported
  const longInput = 'b'.repeat(1001);
  const resInput = decodeAppState(`regex=a&input=${longInput}`);
  expect(resInput.ignoredKeys).toContain('input');
  expect(resInput.state.regex).toBe('a');
  expect(resInput.state.input).toBeUndefined();

  // Entire query over 4096 chars is rejected
  const giantQuery = 'regex=a&extra=' + 'x'.repeat(4100);
  const resGiant = decodeAppState(giantQuery);
  expect(resGiant.ignoredKeys).toContain('query_too_long');
  expect(resGiant.state.regex).toBeUndefined();
});

test('decodeAppState handles leading ? or empty query string cleanly', () => {
  expect(decodeAppState('').state).toEqual({});
  expect(decodeAppState('?').state).toEqual({});
  expect(decodeAppState('?regex=a%7Cb').state).toEqual({ regex: 'a|b' });
});
