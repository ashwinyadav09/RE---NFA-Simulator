import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
if (!isMainThread) {
  if (workerData.mode === 'stress') {
    const { n } = workerData; const re = new RegExp('^' + 'a?'.repeat(n) + 'a'.repeat(n) + '$'); const s = 'a'.repeat(n);
    const t = performance.now(); const ok = re.test(s); parentPort.postMessage({ ms: performance.now() - t, ok });
  } else {
    parentPort.on('message', (job) => {
      const t = performance.now(); const exp = new Set(job.expected); let wrappedBad = false, naive = 'ok';
      const re = new RegExp('^' + job.wrapped + '$'); for (const w of job.S) if (re.test(w) !== exp.has(w)) { wrappedBad = true; break; }
      try { const re2 = new RegExp('^(?:' + job.naive + ')$'); for (const w of job.S) if (re2.test(w) !== exp.has(w)) { naive = 'different-language'; break; } } catch { naive = 'syntax-error'; }
      parentPort.postMessage({ i: job.i, ms: performance.now() - t, wrappedBad, naive });
    });
  }
} else {
  const { compileNaive, makeSim } = await import('./engine.mjs');
  const { lang, toJs, print, allStrings } = await import('./oracles.mjs');
  const fc = (await import('fast-check')).default; const { astArbLarge, size } = await import('./lib-props.mjs');
  const url = new URL(import.meta.url);
  // (ii) random expressions through the JS engine, one expression at a time, 2 s cap each (a regex cannot be interrupted, so the worker is killed)
  const N = 1500, CAP = 2000; const asts = fc.sample(astArbLarge, { numRuns: N, seed: 99 }); const S6 = allStrings(['a', 'b'], 6);
  let w = new Worker(url, { workerData: { mode: 'jobs' } });
  const send = (job) => new Promise((res) => {
    const to = setTimeout(() => { w.terminate(); w = new Worker(url, { workerData: { mode: 'jobs' } }); res({ timeout: true }); }, CAP);
    w.once('message', (m) => { clearTimeout(to); res(m); }); w.postMessage(job);
  });
  const tally = { ok: 0, timeout: 0, naiveSyntax: 0, naiveDiff: 0, wrappedBad: 0 }; const slow = [], diff = []; let maxMs = 0; const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    const ast = asts[i]; const src = print(ast);
    const r = await send({ i, wrapped: toJs(ast), naive: src.replace(/@/g, '(?:)').replace(/#/g, '(?!)'), S: S6, expected: [...lang(ast, 6)] });
    if (r.timeout) { tally.timeout++; slow.length < 5 && slow.push(`${src} (${size(ast)} nodes)`); continue; }
    tally.ok++; maxMs = Math.max(maxMs, r.ms); if (r.wrappedBad) tally.wrappedBad++;
    if (r.naive === 'syntax-error') tally.naiveSyntax++; if (r.naive === 'different-language') { tally.naiveDiff++; diff.length < 4 && diff.push(src); }
  }
  w.terminate();
  console.log(`${N} random expressions (median 3 nodes, max ${Math.max(...asts.map(size))}), all strings over {a,b} up to length 6, ${((Date.now() - t0) / 1000).toFixed(1)}s:`);
  console.log(`  JS RegExp finished within ${CAP} ms: ${tally.ok}; TIMED OUT (>${CAP} ms, worker killed): ${tally.timeout}  e.g. ${JSON.stringify(slow)}; slowest finished ${maxMs.toFixed(0)} ms`);
  console.log(`  wrapped translator wrong on ${tally.wrappedBad}/${tally.ok}; naive paste: SyntaxError ${tally.naiveSyntax}/${tally.ok}, compiled but different language ${tally.naiveDiff}/${tally.ok} e.g. ${JSON.stringify(diff)}`);
  // (iii) escaping / non-BMP
  const dot = new RegExp('^' + toJs({ k: 'cat', l: { k: 'sym', v: '.' }, r: { k: 'sym', v: 'b' } }) + '$'); console.log(`translator escapes '.': ".b" -> ${dot.test('.b')}, "ab" -> ${dot.test('ab')}`);
  const e0 = new RegExp('^' + toJs({ k: 'star', c: { k: 'sym', v: '😀' } }) + '$'), e1 = new RegExp('^' + toJs({ k: 'star', c: { k: 'sym', v: '😀' } }) + '$', 'u');
  console.log(`non-BMP symbol 😀: "😀😀" matches without u flag ${e0.test('😀😀')}, with u flag ${e1.test('😀😀')}; "😀😀".length = ${'😀😀'.length} UTF-16 units but ${Array.from('😀😀').length} code points`);
  // (iv) stress
  console.log('\nstress  (a?)^n a^n  vs  a^n   JS RegExp (worker thread, 8 s cap)   |   Thompson NFA simulation (prototype)');
  const runStress = (n) => new Promise((res) => { const ww = new Worker(url, { workerData: { mode: 'stress', n } }); const to = setTimeout(() => { ww.terminate(); res({ timeout: true }); }, 8000); ww.on('message', (m) => { clearTimeout(to); ww.terminate(); res(m); }); });
  const nfaTime = (n) => { const src = 'a?'.repeat(n) + 'a'.repeat(n); const t0 = performance.now(); const c = compileNaive(src); const t1 = performance.now(); const sim = makeSim(c.nfa); const r = sim.run('a'.repeat(n)); const t2 = performance.now(); return { build: t1 - t0, run: t2 - t1, ok: r.accepted, states: c.nfa.states.size }; };
  nfaTime(30); let prev = null;
  for (const n of [10, 14, 18, 20, 22, 24, 26, 28, 30]) {
    const r = await runStress(n); const x = nfaTime(n);
    console.log(`n=${String(n).padEnd(3)} ${r.timeout ? '> 8000 ms (killed)'.padEnd(26) : (r.ms.toFixed(1) + ' ms (match=' + r.ok + ')' + (prev ? `  x${(r.ms / prev).toFixed(1)}` : '')).padEnd(26)} | NFA ${x.states} states, build ${x.build.toFixed(2)} ms, run ${x.run.toFixed(2)} ms, accepted=${x.ok}`);
    if (r.timeout) break; prev = r.ms;
  }
  console.log('NFA scaling:'); let p = null;
  for (const n of [25, 50, 100, 200, 400, 800]) { const x = nfaTime(n); console.log(`  n=${String(n).padEnd(4)} states ${String(x.states).padEnd(5)} run ${x.run.toFixed(2).padStart(8)} ms${p ? '  x' + (x.run / p).toFixed(1) + ' for 2x n' : ''}`); p = x.run; }
}
