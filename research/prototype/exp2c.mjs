import fc from 'fast-check';
import { astArb, astArbLarge, size, detInv, detLang, detAst, check } from './lib-props.mjs';
import { print } from './oracles.mjs';
const sz = (arb) => { const x = fc.sample(arb, { numRuns: 1000, seed: 7 }).map(size).sort((a, b) => a - b); return `median ${x[500]}, p90 ${x[900]}, max ${x[999]}`; };
console.log(`generator depthSize 'small': nodes ${sz(astArb)}   |   'large': nodes ${sz(astArbLarge)}\n`);
const mutants = [
  ['star-no-back', 'builder'], ['star-no-skip', 'builder'], ['union-no-b-exit', 'builder'], ['plus-skip', 'builder'], ['opt-no-skip', 'builder'],
  ['eps-as-empty', 'builder'], ['empty-as-eps', 'builder'], ['merge-no-move', 'builder'],
  ['assoc-right', 'parser'], ['prec-swap', 'parser'],
  ['closure-one-step', 'simulator'], ['no-initial-closure', 'simulator'], ['no-closure-after-move', 'simulator'],
];
const cell = (r) => (r.failed ? `KILL@${r.numRuns}` : 'survive');
const t0 = Date.now();
console.log('mutant                  | layer     | invariants+size+replay | language vs enumerator | parse-tree check | language, SMALL generator | smallest counterexample (language check)');
for (const [m, layer] of mutants) {
  const rInv = check((a) => detInv(a, m), 1500, 1, astArbLarge);
  const rLang = check((a) => detLang(a, m), 800, 1, astArbLarge);
  const rAst = check((a) => detAst(a, m), 1500, 1, astArbLarge);
  const rLangS = check((a) => detLang(a, m), 800, 1, astArb);
  const ce = rLang.failed ? print(rLang.counterexample[0]) : (rAst.failed ? '(tree) ' + print(rAst.counterexample[0]) : '-');
  console.log(`${m.padEnd(23)} | ${layer.padEnd(9)} | ${cell(rInv).padEnd(22)} | ${cell(rLang).padEnd(22)} | ${cell(rAst).padEnd(16)} | ${cell(rLangS).padEnd(25)} | ${ce}`);
}
console.log(`(${((Date.now() - t0) / 1000).toFixed(1)}s)  baseline (no mutation) re-check on the large generator:`);
for (const [n, d] of [['invariants', detInv], ['language', detLang], ['parse tree', detAst]]) { const r = check((a) => d(a, undefined), n === 'language' ? 800 : 1500, 1, astArbLarge); console.log(`  ${n}: ${r.failed ? 'FAIL ' + print(r.counterexample[0]) : 'PASS'} (${r.numRuns} runs)`); }
