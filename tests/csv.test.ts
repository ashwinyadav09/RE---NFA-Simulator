import { describe, it, expect } from 'vitest';
import { formatStressCsv, escapeCsvField } from '../src/ui/csv';
import type { StressRow } from '../src/ui/stress-types';

describe('formatStressCsv', () => {
  it('outputs RFC 4180 header with CRLF for empty rows', () => {
    const csv = formatStressCsv([]);
    expect(csv).toBe('family,n,string_length,regexp_time_ms,nfa_time_ms,regexp_verdict,nfa_verdict\r\n');
  });

  it('formats rows with table-identical times and verdicts', () => {
    const rows: StressRow[] = [
      {
        family: 'star-star-b',
        n: 12,
        inputLength: 12,
        regExpTimeMs: 0.8123,
        regExpVerdict: 'REJECT',
        nfaTimeMs: 0.1234,
        nfaVerdict: 'REJECT'
      },
      {
        family: 'star-star-b',
        n: 28,
        inputLength: 28,
        regExpTimeMs: 8000,
        regExpVerdict: 'TIMEOUT',
        nfaTimeMs: 0.25,
        nfaVerdict: 'REJECT'
      },
      {
        family: 'star-star-b',
        n: 30,
        inputLength: 30,
        regExpTimeMs: null,
        regExpVerdict: 'SKIPPED',
        nfaTimeMs: 0.31,
        nfaVerdict: 'REJECT'
      }
    ];

    const csv = formatStressCsv(rows);
    const lines = csv.split('\r\n');
    expect(lines.length).toBe(5); // header, 3 rows, trailing empty line after \r\n
    expect(lines[0]).toBe('family,n,string_length,regexp_time_ms,nfa_time_ms,regexp_verdict,nfa_verdict');
    expect(lines[1]).toBe('star-star-b,12,12,0.8 ms,0.12 ms,REJECT,REJECT');
    expect(lines[2]).toBe('star-star-b,28,28,,0.25 ms,TIMEOUT,REJECT');
    expect(lines[3]).toBe('star-star-b,30,30,,0.31 ms,SKIPPED,REJECT');
    expect(lines[4]).toBe('');
  });

  it('escapes fields with comma, quote, and CRLF per RFC 4180', () => {
    const syntheticRow: StressRow = {
      family: 'test,"family"\r\nwith,comma',
      n: 14,
      inputLength: 14,
      regExpTimeMs: 1.23,
      regExpVerdict: 'ACCEPT',
      nfaTimeMs: 0.05,
      nfaVerdict: 'ACCEPT'
    };

    const csv = formatStressCsv([syntheticRow]);
    expect(csv).toContain('"test,""family""\r\nwith,comma",14,14,1.2 ms,0.05 ms,ACCEPT,ACCEPT\r\n');
  });

  it('escapeCsvField escapes strings only when needed', () => {
    expect(escapeCsvField('plain')).toBe('plain');
    expect(escapeCsvField('has,comma')).toBe('"has,comma"');
    expect(escapeCsvField('has"quote')).toBe('"has""quote"');
    expect(escapeCsvField('has\nnewline')).toBe('"has\nnewline"');
  });
});
