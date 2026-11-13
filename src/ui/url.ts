export interface AppUrlState {
  regex?: string;
  notation?: 'standard' | 'textbook';
  concat?: 'epsilon-link' | 'merge';
  preset?: string;
  alphabet?: string;
  input?: string;
  view?: 'flat' | 'final';
  step?: number;
  compact?: boolean;
}

export interface DecodeResult {
  state: AppUrlState;
  ignoredKeys: string[];
}

export const LIMITS = {
  maxQueryLength: 4096,
  maxRegexLength: 2000,
  maxInputLength: 1000,
  maxAlphabetLength: 200,
  maxPresetLength: 100
};

export function encodeAppState(state: AppUrlState): string {
  const params = new URLSearchParams();

  if (state.regex !== undefined && state.regex.trim() !== '') {
    params.set('regex', state.regex);
  }
  if (state.notation !== undefined && state.notation !== 'standard') {
    params.set('notation', state.notation);
  }
  if (state.concat !== undefined && state.concat !== 'epsilon-link') {
    params.set('concat', state.concat);
  }
  if (state.preset !== undefined && state.preset.trim() !== '') {
    params.set('preset', state.preset);
  }
  if (state.alphabet !== undefined && state.alphabet.trim() !== '') {
    params.set('alphabet', state.alphabet);
  }
  if (state.input !== undefined && state.input !== '') {
    params.set('input', state.input);
  }
  if (state.view !== undefined && state.view !== 'flat') {
    params.set('view', state.view);
  }
  if (state.step !== undefined && state.step > 1) {
    params.set('step', String(state.step));
  }
  if (state.compact === true) {
    params.set('compact', '1');
  }

  return params.toString();
}

export function decodeAppState(queryString: string): DecodeResult {
  const query = queryString.startsWith('?') ? queryString.slice(1) : queryString;
  if (!query) {
    return { state: {}, ignoredKeys: [] };
  }

  if (query.length > LIMITS.maxQueryLength) {
    return { state: {}, ignoredKeys: ['query_too_long'] };
  }

  const params = new URLSearchParams(query);
  const state: AppUrlState = {};
  const ignoredKeys: string[] = [];

  const knownKeys = new Set(['regex', 'notation', 'concat', 'preset', 'alphabet', 'input', 'view', 'step', 'compact']);

  for (const [key, rawVal] of params.entries()) {
    if (!knownKeys.has(key)) {
      // D5: Unknown keys are ignored silently.
      continue;
    }

    if (key === 'regex') {
      if (rawVal.length > LIMITS.maxRegexLength) {
        ignoredKeys.push('regex');
      } else {
        state.regex = rawVal;
      }
    } else if (key === 'notation') {
      if (rawVal === 'standard' || rawVal === 'textbook') {
        state.notation = rawVal;
      } else {
        ignoredKeys.push('notation');
      }
    } else if (key === 'concat') {
      if (rawVal === 'epsilon-link' || rawVal === 'merge') {
        state.concat = rawVal;
      } else {
        ignoredKeys.push('concat');
      }
    } else if (key === 'preset') {
      if (rawVal.length > LIMITS.maxPresetLength || rawVal.trim() === '') {
        ignoredKeys.push('preset');
      } else {
        state.preset = rawVal;
      }
    } else if (key === 'alphabet') {
      if (rawVal.length > LIMITS.maxAlphabetLength || rawVal.trim() === '') {
        ignoredKeys.push('alphabet');
      } else {
        state.alphabet = rawVal;
      }
    } else if (key === 'input') {
      if (rawVal.length > LIMITS.maxInputLength) {
        ignoredKeys.push('input');
      } else {
        state.input = rawVal;
      }
    } else if (key === 'view') {
      if (rawVal === 'textbook') {
        state.view = 'flat';
      } else if (rawVal === 'flat' || rawVal === 'final') {
        state.view = rawVal;
      } else {
        ignoredKeys.push('view');
      }
    } else if (key === 'step') {
      if (/^[1-9]\d*$/.test(rawVal)) {
        const num = Number(rawVal);
        if (Number.isSafeInteger(num)) {
          state.step = num;
        } else {
          ignoredKeys.push('step');
        }
      } else {
        ignoredKeys.push('step');
      }
    } else if (key === 'compact') {
      if (rawVal === '1' || rawVal === 'true') {
        state.compact = true;
      } else if (rawVal === '0' || rawVal === 'false') {
        state.compact = false;
      } else {
        ignoredKeys.push('compact');
      }
    }
  }

  return { state, ignoredKeys };
}
