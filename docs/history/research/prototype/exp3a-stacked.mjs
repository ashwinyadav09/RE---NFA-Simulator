// Stacked postfix operators: what V8's RegExp does with them vs the M1 reading (each operator applies to the previous operand).
import { parseRD } from './engine.mjs';
import { lang, allStrings } from './oracles.mjs';
const STR = allStrings(['a'], 4);
console.log(`node ${process.version}, V8 ${process.versions.v8}`);
console.log('pair | JS RegExp (language over a^0..a^4)        | M1 reading (language over a^0..a^4)       | same language?');
for (const o1 of ['*', '+', '?']) for (const o2 of ['*', '+', '?']) {
  const src = 'a' + o1 + o2; const m1 = [...lang(parseRD(src), 4)].sort();
  let js; try { const re = new RegExp('^(?:' + src + ')$'); js = STR.filter((w) => re.test(w)).sort(); } catch (e) { js = 'SyntaxError (' + e.message.split(': ').pop() + ')'; }
  const f = (x) => (Array.isArray(x) ? '{' + x.map((s) => s || 'ε').join(',') + '}' : x);
  console.log(`${src.padEnd(4)} | ${f(js).padEnd(41)} | ${f(m1).padEnd(41)} | ${Array.isArray(js) ? JSON.stringify(js) === JSON.stringify(m1) : 'n/a'}`);
}
