export type RegExpVerdict = 'ACCEPT' | 'REJECT' | 'TIMEOUT' | 'SKIPPED' | 'ERROR';
export type NfaVerdict = 'ACCEPT' | 'REJECT';

export interface StressRow {
  family: string;
  n: number;
  inputLength: number;
  regExpTimeMs: number | null;
  regExpVerdict: RegExpVerdict;
  nfaTimeMs: number;
  nfaVerdict: NfaVerdict;
}

