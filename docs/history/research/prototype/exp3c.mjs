import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
if (!isMainThread) {
  if (workerData.mode === 'pat') {
    const { src, s } = workerData; const re = new RegExp(src); const t = performance.now(); const ok = re.test(s); parentPort.postMessage({ ms: performance.now() - t, ok });
  } else {
    parentPort.on('message', (job) => {
      const t = performance.now(); const exp = new Set(job.expected); let bad = false;
      const re = new RegExp('^' + job.wrapped + '$'); for (const w of job.S) if (re.test(w) !== exp.has(w)) { bad = true; break; }
      parentPort.postMessage({ i: job.i, ms: performance.now() - t, bad });
    });
  }
} else {
  const { compileNaive, makeSim } = await import('./engine.mjs');
  const { lang, toJs, print, allStrings } = await import('./oracles.mjs');
  const fc = (await import('fast-check')).default; const { astArbLarge, size } = await import('./lib-props.mjs');
  const url = new URL(import.meta.url);
  // (A) same random-expression harness, 5000 expressions, 2 s cap each
  const N = 5000, CAP = 2000; const asts = fc.sample(astArbLarge, { numRuns: N, seed: 99 }); const S6 = allStrings(['a', 'b'], 6);
  let w = new Worker(url, { workerData: { mode: 'jobs' } });
  const send = (job) => new Promise((res) => { const to = setTimeout(() => { w.terminate(); w = new Worker(url, { workerData: { mode: 'jobs' } }); res({ timeout: true }); }, CAP); w.once('message', (m) => { clearTimeout(to); res(m); }); w.postMessage(job); });
  let timeouts = 0, bad = 0, done = 0, maxMs = 0; const ex = []; const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    if ((Date.now() - t0) > 150000) { console.log(`(stopped at ${i} after 150 s)`); break; }
    const r = await send({ i, wrapped: toJs(asts[i]), S: S6, expected: [...lang(asts[i], 6)] });
    if (r.timeout) { timeouts++; ex.length < 4 && ex.push(`${print(asts[i])}  [${size(asts[i])} nodes]`); continue; }
    done++; if (r.bad) bad++; maxMs = Math.max(maxMs, r.ms);
  }
  w.terminate();
  console.log(`(A) ${done + timeouts} random expressions through V8's RegExp (strings <= 6): finished ${done}, TIMED OUT >${CAP} ms: ${timeouts}; wrong answers ${bad}; slowest finished ${maxMs.toFixed(0)} ms; pathological examples: ${JSON.stringify(ex)}`);
  // (B) which pathological families are actually exponential in V8?
  const runPat = (src, s) => new Promise((res) => { const ww = new Worker(url, { workerData: { mode: 'pat', src, s } }); const to = setTimeout(() => { ww.terminate(); res({ timeout: true }); }, 6000); ww.on('message', (m) => { clearTimeout(to); ww.terminate(); res(m); }); });
  const fams = [
    ['Cox  (a?)^n a^n   on a^n        ', (n) => '^' + 'a?'.repeat(n) + 'a'.repeat(n) + '$', (n) => 'a'.repeat(n), (n) => 'a?'.repeat(n) + 'a'.repeat(n), (n) => 'a'.repeat(n)],
    ['(a*)*b            on a^n        ', () => '^(a*)*b$', (n) => 'a'.repeat(n), () => '(a*)*b', (n) => 'a'.repeat(n)],
    ['(a+)+             on a^n b      ', () => '^(a+)+$', (n) => 'a'.repeat(n) + 'b', () => '(a+)+', (n) => 'a'.repeat(n) + 'b'],
    ['(a|aa)+           on a^n b      ', () => '^(a|aa)+$', (n) => 'a'.repeat(n) + 'b', () => '(a|aa)+', (n) => 'a'.repeat(n) + 'b'],
  ];
  console.log(`\n(B) V8 ${process.versions.v8}: JS RegExp (worker, 6 s cap) vs Thompson NFA, same string`);
  for (const [name, mk, str, mkSim, strSim] of fams) {
    const rows = []; let prev = null, died = null;
    for (const n of [12, 16, 20, 22, 24, 26, 28, 30]) {
      const r = await runPat(mk(n), str(n));
      if (r.timeout) { rows.push(`n=${n}: >6000 ms`); died = n; break; }
      rows.push(`n=${n}: ${r.ms.toFixed(1)} ms`); prev = r.ms;
    }
    const c = compileNaive(mkSim(30)); const sim = makeSim(c.nfa); const t1 = performance.now(); const rr = sim.run(strSim(1000)); const nfaMs = performance.now() - t1;
    console.log(`  ${name} ${rows.join(', ')}   | NFA (${c.nfa.states.size} states) on length-1000 string: ${nfaMs.toFixed(1)} ms`);
  }
}
