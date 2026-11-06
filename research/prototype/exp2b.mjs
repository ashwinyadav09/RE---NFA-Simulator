import fc from 'fast-check';
import { astArb, size, detInv, detLang, detAst, detOracles, check, STR, MAXLEN } from './lib-props.mjs';
import { print } from './oracles.mjs';
const t0 = Date.now();
// distribution of generated expressions
const samples = fc.sample(astArb, { numRuns: 2000, seed: 7 });
const sizes = samples.map(size).sort((a, b) => a - b);
const pct = (p) => sizes[Math.floor(p * (sizes.length - 1))];
console.log(`generator: nodes per expression min ${sizes[0]}, median ${pct(.5)}, p90 ${pct(.9)}, max ${sizes[sizes.length - 1]}; strings per expression: ${STR.length} (all strings over {a,b} up to length ${MAXLEN})`);
const kinds = {}; const walk = (a) => { kinds[a.k] = (kinds[a.k] || 0) + 1; ['l', 'r', 'c'].forEach(k => a[k] && walk(a[k])); }; samples.forEach(walk);
console.log('node kinds:', JSON.stringify(kinds));
const stacked = samples.filter(a => ['star', 'plus', 'opt'].includes(a.k) && a.c && ['star', 'plus', 'opt'].includes(a.c.k)).length;
console.log(`expressions whose root is a stacked unary operator (e.g. a**, a+?): ${stacked}/2000`);
for (const [name, det, runs] of [['oracles agree with each other (enumerator = derivatives = JS RegExp)', detOracles, 2500], ['structural invariants I1-I4 + size formula + step-log replay, both concat modes', detInv, 4000], ['parse tree from shunting-yard == printed AST', detAst, 4000], ['NFA language == enumerator over all strings, both concat modes', detLang, 2500]]) {
  const t = Date.now(); const r = check(det, runs);
  console.log(`${r.failed ? 'FAIL' : 'PASS'}  ${name}  (${r.numRuns} runs, ${((Date.now() - t) / 1000).toFixed(1)}s)${r.failed ? ' counterexample: ' + print(r.counterexample[0]) : ''}`);
}
console.log(`total ${((Date.now() - t0) / 1000).toFixed(1)}s; fast-check seed 1`);
