import fc from 'fast-check';
import { compileNaive, makeSim, checkInvariants, expectedSize, replay, parseRD, astFromPostfix, EPS } from './engine.mjs';
import { lang, derivMatch, jsRegExp, print, desugar, allStrings } from './oracles.mjs';
export const letter = fc.constantFrom('a', 'b').map(v => ({ k: 'sym', v }));
export const makeAstArb = (depthSize) => fc.letrec(tie => ({
  expr: fc.oneof({ depthSize, withCrossShrink: true }, tie('leaf'), tie('unary'), tie('binary')),
  leaf: fc.oneof({ weight: 6, arbitrary: letter }, { weight: 1, arbitrary: fc.constant({ k: 'eps' }) }, { weight: 1, arbitrary: fc.constant({ k: 'empty' }) }),
  unary: fc.record({ k: fc.constantFrom('star', 'plus', 'opt'), c: tie('expr') }),
  binary: fc.record({ k: fc.constantFrom('union', 'cat'), l: tie('expr'), r: tie('expr') }),
})).expr;
export const astArb = makeAstArb('small');
export const astArbLarge = makeAstArb('large');
export const MAXLEN = 6;
export const STR = allStrings(['a', 'b'], MAXLEN);
export const size = (ast) => ast.k === 'union' || ast.k === 'cat' ? 1 + size(ast.l) + size(ast.r) : ast.c ? 1 + size(ast.c) : 1;
const safe = (f) => { try { return f(); } catch (e) { return { __crash: String(e.message || e) }; } };
// three detectors, each can fail for exactly one reason
export function detInv(ast, mut) {           // structural invariants + size formula + step-log replay (no strings simulated)
  for (const concat of ['epsilon-link', 'merge']) {
    const c = safe(() => compileNaive(print(ast), { concat, mutate: mut })); if (c.__crash) return false;
    const inv = checkInvariants(c.nfa);
    if (!(inv.I1 && inv.I2 && inv.I3 && inv.I4 && inv.noDanglingEdges)) return false;
    if (c.nfa.states.size !== expectedSize(c.postfix, concat)) return false;
    const rp = replay(c.steps); if (rp.states.size !== c.nfa.states.size || rp.trans.length !== c.nfa.transitions.length) return false;
  }
  return true;
}
export function detLang(ast, mut) {          // NFA language vs bounded-language enumerator over all strings <= MAXLEN
  const L = lang(ast, MAXLEN);
  for (const concat of ['epsilon-link', 'merge']) {
    const c = safe(() => compileNaive(print(ast), { concat, mutate: mut })); if (c.__crash) return false;
    const sim = safe(() => makeSim(c.nfa, mut)); if (sim.__crash) return false;
    for (const w of STR) { const r = safe(() => sim.run(w).accepted); if (r && r.__crash) return false; if (r !== L.has(w)) return false; }
  }
  return true;
}
export function detAst(ast, mut) {           // parse tree from shunting-yard postfix == the AST that was printed
  const c = safe(() => compileNaive(print(ast), { mutate: mut })); if (c.__crash) return false;
  return JSON.stringify(astFromPostfix(c.postfix)) === JSON.stringify(ast);
}
export function detOracles(ast) {            // the three oracles must agree with each other, else a mismatch can't be attributed
  const L = lang(ast, MAXLEN), re = jsRegExp(ast);
  for (const w of STR) { const a = L.has(w); if (a !== derivMatch(ast, w) || a !== re.test(w)) return false; }
  return true;
}
export const check = (det, runs, seed = 1, arb = astArb) => fc.check(fc.property(arb, (ast) => det(ast)), { numRuns: runs, seed, verbose: 0 });
