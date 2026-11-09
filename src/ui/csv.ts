import type { StressRow } from './stress-types';

export function escapeCsvField(val: string): string {
  if (val.includes('"') || val.includes(',') || val.includes('\n') || val.includes('\r')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

export function formatStressCsv(rows: StressRow[]): string {
  const header = [
    'family',
    'n',
    'string_length',
    'regexp_time_ms',
    'nfa_time_ms',
    'regexp_verdict',
    'nfa_verdict'
  ];
  const lines: string[] = [header.join(',') + '\r\n'];

  for (const row of rows) {
    const regExpTime =
      row.regExpVerdict === 'TIMEOUT' ||
      row.regExpVerdict === 'SKIPPED' ||
      row.regExpVerdict === 'ERROR' ||
      row.regExpTimeMs === null
        ? ''
        : `${row.regExpTimeMs.toFixed(1)} ms`;

    const nfaTime = `${row.nfaTimeMs.toFixed(2)} ms`;
    const regExpVerdict = row.regExpVerdict;
    const nfaVerdict = row.nfaVerdict;

    const fields = [
      escapeCsvField(row.family),
      escapeCsvField(String(row.n)),
      escapeCsvField(String(row.inputLength)),
      escapeCsvField(regExpTime),
      escapeCsvField(nfaTime),
      escapeCsvField(regExpVerdict),
      escapeCsvField(nfaVerdict)
    ];
    lines.push(fields.join(',') + '\r\n');
  }

  return lines.join('');
}
