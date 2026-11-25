// THROWAWAY: generates the fixtures shipped in .agents/skills/thompson-rules/fixtures
// from the research prototype, which reproduced the M1 section 4.5 literals (35/35 checks, see exp1.mjs).
import { writeFileSync } from 'node:fs';
import { compileNaive, makeSim, checkInvariants, EPS } from './engine.mjs';

const OUT = process.argv[2];
const L = (l) => (l === EPS ? 'ε' : l);
const rule = { SYMBOL: 'symbol', EPSILON: 'epsilon', EMPTY: 'empty-set', CONCAT: 'concatenation', UNION: 'union', STAR: 'star', PLUS: 'plus', OPT: 'optional' };
const arr = (s) => [...s].sort((a, b) => a - b);

const dump = (src, opts) => {
  const c = compileNaive(src, opts);
  const sim = makeSim(c.nfa);
  const table = {};
  for (const q of arr(c.nfa.states)) table[q] = {};
  for (const t of c.nfa.transitions) (table[t.from][L(t.label)] ??= []).push(t.to);
  for (const q in table) for (const k in table[q]) table[q][k].sort((a, b) => a - b);
  return { c, sim, table };
};

// ---- worked example (M1 section 4.5) ----
const { c, sim, table } = dump('(a|b)*a', {});
const m = dump('(a|b)*a', { concat: 'merge' }).c;
const traces = {};
for (const w of ['ba', 'ab', 'a', '']) {
  const r = sim.run(w);
  traces[w] = { afterEachSymbol: r.sets.slice(1).map(arr), accepted: r.accepted };
}
writeFileSync(`${OUT}/worked-example.json`, JSON.stringify({
  _about: 'Hand-solved example from the M1 design document section 4.5, reproduced by the research prototype (35/35 literal checks). Epsilon-link concatenation, standard notation. State ids are creation order.',
  source: '(a|b)*a', notation: 'standard', concatenation: 'epsilon-link',
  postfix: c.postfix.map((t) => t.type),
  steps: c.steps.map((s) => ({
    index: s.index, token: s.token.type, rule: rule[s.token.type], newStates: s.newStates,
    newTransitions: s.newTransitions.map((t) => ({ from: t.from, to: t.to, label: L(t.label) })),
    result: { start: s.result.s, accept: s.result.f }, stackDepthAfter: s.stack.length,
  })),
  nfa: { states: arr(c.nfa.states), start: c.nfa.start, accept: c.nfa.accept, transitions: c.nfa.transitions.map((t) => ({ from: t.from, to: t.to, label: L(t.label) })) },
  transitionTable: table,
  initialClosure: arr(sim.closure(new Set([c.nfa.start]))),
  traces,
  invariants: checkInvariants(c.nfa),
  mergeMode: { states: m.nfa.states.size, transitions: m.nfa.transitions.length, mergedAtStep6: m.steps[5].merged },
}, null, 2));

// ---- classic (a|b)*abb ----
const a = dump('(a|b)*abb', {});
const b = dump('(a|b)*abb', { concat: 'merge' });
writeFileSync(`${OUT}/classic-abb.json`, JSON.stringify({
  _about: 'Classic textbook example. Merge mode gives the 11-state figure used in Dragon-book style lecture notes; epsilon-link gives 14.',
  source: '(a|b)*abb',
  epsilonLink: { states: a.c.nfa.states.size, transitions: a.c.nfa.transitions.length },
  merge: { states: b.c.nfa.states.size, transitions: b.c.nfa.transitions.length },
  accepts: ['abb', 'aabb', 'babb'], rejects: ['abab', 'ab', ''],
}, null, 2));

// ---- PROPOSED error taxonomy: golden cases (positions are code-point indices into the source) ----
const E = (source, code, pos, notation = 'standard') => ({ source, notation, code, pos });
writeFileSync(`${OUT}/error-cases.json`, JSON.stringify({
  _about: 'PROPOSED golden cases for the error taxonomy in docs/SPEC.md (needs approval). Rule: report the first violation scanning left to right, always pointing at the offending token. End-of-input checks run in this order: missing right operand, then unclosed parenthesis.',
  cases: [
    E('()', 'EMPTY_GROUP', 0), E('a|', 'MISSING_OPERAND', 1), E('|a', 'MISSING_OPERAND', 0), E('a||b', 'MISSING_OPERAND', 1),
    E('(a|)', 'MISSING_OPERAND', 2), E('(|a)', 'MISSING_OPERAND', 1),
    E('*a', 'NOTHING_TO_REPEAT', 0), E('a|*b', 'NOTHING_TO_REPEAT', 2), E('(*)', 'NOTHING_TO_REPEAT', 1), E('+a', 'NOTHING_TO_REPEAT', 0),
    E('+a', 'MISSING_OPERAND', 0, 'textbook'),
    E('a(', 'UNBALANCED_LPAREN', 1), E('(a', 'UNBALANCED_LPAREN', 0), E('((a)', 'UNBALANCED_LPAREN', 0), E('(a|', 'MISSING_OPERAND', 2),
    E('a)', 'UNBALANCED_RPAREN', 1), E(')a', 'UNBALANCED_RPAREN', 0), E('(a))', 'UNBALANCED_RPAREN', 3),
    E('(()a)', 'EMPTY_GROUP', 1), E('a|()', 'EMPTY_GROUP', 2), E('a(|b)c', 'MISSING_OPERAND', 2),
    E('a|b', 'NOT_AN_OPERATOR', 1, 'textbook'),
  ],
  valid: ['a**', 'a+?', 'a?*', '@*', '#', 'a#', '(a)(b)', 'a b', '((a|b)*)*'],
}, null, 2));

console.log('fixtures written', JSON.stringify({ abb: [a.c.nfa.states.size, a.c.nfa.transitions.length, b.c.nfa.states.size, b.c.nfa.transitions.length] }));
