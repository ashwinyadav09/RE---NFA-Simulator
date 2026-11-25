import { compileNaive, makeSim, checkInvariants, expectedSize, replay, parseRD, astFromPostfix, EPS, tokenize, insertConcat, toPostfix } from './engine.mjs';
let pass = 0, fail = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; if (!ok) console.log(`FAIL ${name}\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`); };
const arr = (s) => [...s].sort((a, b) => a - b);

// ---------- 1. M1 section 4.5 hand-solved example (expected values are literals copied from the M1 doc) ----------
const r = compileNaive('(a|b)*a');
eq('postfix types', r.postfix.map(t => t.type), ['SYMBOL', 'SYMBOL', 'UNION', 'STAR', 'SYMBOL', 'CONCAT']);
eq('states', r.nfa.states.size, 10); eq('transitions', r.nfa.transitions.length, 12);
eq('start', r.nfa.start, 6); eq('accept', r.nfa.accept, 9);
const fmt = (t) => `${t.from}-${t.label === EPS ? 'e' : t.label}->${t.to}`;
eq('step1', r.steps[0].newTransitions.map(fmt), ['0-a->1']);
eq('step2', r.steps[1].newTransitions.map(fmt), ['2-b->3']);
eq('step3', r.steps[2].newTransitions.map(fmt), ['4-e->0', '4-e->2', '1-e->5', '3-e->5']);
eq('step4', r.steps[3].newTransitions.map(fmt), ['6-e->4', '5-e->7', '6-e->7', '5-e->4']);
eq('step5', r.steps[4].newTransitions.map(fmt), ['8-a->9']);
eq('step6', r.steps[5].newTransitions.map(fmt), ['7-e->8']);
eq('frag per step', r.steps.map(s => [s.result.s, s.result.f]), [[0, 1], [2, 3], [4, 5], [6, 7], [8, 9], [6, 9]]);
eq('stack depth per step', r.steps.map(s => s.stack.length), [1, 2, 1, 1, 2, 1]);
const table = {}; for (const q of [...r.nfa.states].sort((a, b) => a - b)) table[q] = { a: [], b: [], e: [] };
for (const t of r.nfa.transitions) table[t.from][t.label === EPS ? 'e' : t.label].push(t.to);
for (const q in table) for (const k in table[q]) table[q][k].sort((a, b) => a - b);
eq('transition table', table, { 0: { a: [1], b: [], e: [] }, 1: { a: [], b: [], e: [5] }, 2: { a: [], b: [3], e: [] }, 3: { a: [], b: [], e: [5] }, 4: { a: [], b: [], e: [0, 2] }, 5: { a: [], b: [], e: [4, 7] }, 6: { a: [], b: [], e: [4, 7] }, 7: { a: [], b: [], e: [8] }, 8: { a: [9], b: [], e: [] }, 9: { a: [], b: [], e: [] } });
const sim = makeSim(r.nfa);
eq('S0', arr(sim.closure(new Set([r.nfa.start]))), [0, 2, 4, 6, 7, 8]);
const tr = (w) => { const o = sim.run(w); return { sets: o.sets.slice(1).map(arr), acc: o.accepted }; };
eq('trace ba', tr('ba'), { sets: [[0, 2, 3, 4, 5, 7, 8], [0, 1, 2, 4, 5, 7, 8, 9]], acc: true });
eq('trace ab', tr('ab'), { sets: [[0, 1, 2, 4, 5, 7, 8, 9], [0, 2, 3, 4, 5, 7, 8]], acc: false });
eq('trace a', tr('a'), { sets: [[0, 1, 2, 4, 5, 7, 8, 9]], acc: true });
eq('trace eps', tr(''), { sets: [], acc: false });
eq('invariants', checkInvariants(r.nfa), { I1: true, I2: true, I3: true, I4: true, noDanglingEdges: true });
const m = compileNaive('(a|b)*a', { concat: 'merge' });
eq('merge sizes', [m.nfa.states.size, m.nfa.transitions.length], [9, 11]);
eq('merge: 7 and 8 coincide', m.steps[5].merged, { removed: 8, into: 7 });

// ---------- 2. size claims ----------
for (const [src, link, merge] of [['(a|b)*abb', 14, 11]]) {
  const L = compileNaive(src), M = compileNaive(src, { concat: 'merge' });
  eq(`${src} link states`, L.nfa.states.size, link); eq(`${src} merge states`, M.nfa.states.size, merge);
  eq(`${src} size formula link`, expectedSize(L.postfix, 'epsilon-link'), link); eq(`${src} size formula merge`, expectedSize(M.postfix, 'merge'), merge);
  const s = makeSim(L.nfa), s2 = makeSim(M.nfa);
  for (const w of ['abb', 'aabb', 'babb']) { eq(`${src} accepts ${w}`, [s.run(w).accepted, s2.run(w).accepted], [true, true]); }
  for (const w of ['abab', 'ab', '']) { eq(`${src} rejects '${w}'`, [s.run(w).accepted, s2.run(w).accepted], [false, false]); }
  eq('step log replay (link)', [replay(L.steps).states.size, replay(L.steps).trans.length], [L.nfa.states.size, L.nfa.transitions.length]);
  const rp = replay(M.steps); eq('step log replay (merge) states', rp.states.size, M.nfa.states.size);
  eq('step log replay (merge) transitions identical', JSON.stringify(rp.trans.map(fmt).sort()), JSON.stringify(M.nfa.transitions.map(fmt).sort()));
}
console.log(`\n[1+2] literal checks vs M1 doc: ${pass} passed, ${fail} failed\n`);

// ---------- 3. edge cases: M1 pipeline (A1-A3 literally) vs recursive-descent parser ----------
const cases = ['', '   ', '()', 'a|', '|a', '*a', 'a||b', '(a|)', '(|a)', 'a(', ')a', '(a', 'a)', 'a|*b', '+a', 'a**', 'a+?', 'a?*', '@*', '#', 'a#', '(a)(b)', 'a b', '((a)', '(a))', '(()a)', 'a|()', '(*)', 'a(|b)c'];
const res = (f) => { try { const x = f(); return { ok: true, x }; } catch (e) { return { ok: false, code: e.code ?? 'BUG:' + e.message, pos: e.pos, msg: e.message }; } };
console.log('source        | M1 pipeline (A1-A3)                          | recursive-descent parser            | validity agrees | same error code | same pos');
let validityDisagree = 0, codeDisagree = 0, posDisagree = 0;
for (const c of cases) {
  const a = res(() => compileNaive(c)), b = res(() => parseRD(c));
  const fa = a.ok ? 'OK' : `${a.code}@${a.pos}`, fb = b.ok ? 'OK' : `${b.code}@${b.pos}`;
  const va = a.ok === b.ok; if (!va) validityDisagree++;
  const sc = a.ok ? true : a.code === b.code; if (!sc && va) codeDisagree++;
  const sp = a.ok ? true : a.pos === b.pos; if (!sp && va) posDisagree++;
  console.log(`${JSON.stringify(c).padEnd(13)} | ${fa.padEnd(44)} | ${fb.padEnd(35)} | ${String(va).padEnd(15)} | ${String(a.ok ? '-' : sc).padEnd(15)} | ${a.ok ? '-' : sp}`);
}
console.log(`\nvalidity disagreements: ${validityDisagree}; among invalid inputs: error-code disagreements ${codeDisagree}, position disagreements ${posDisagree}`);
// parse structure agreement on valid inputs
for (const c of ['(a|b)*a', 'a**', 'a|b|c', 'abc', 'a(b|c)*d', '@*', '(a|#)*b?']) {
  const n = compileNaive(c); eq(`AST agreement ${c}`, astFromPostfix(n.postfix), parseRD(c));
}
console.log(`AST agreement checks included above: totals ${pass} passed, ${fail} failed`);
