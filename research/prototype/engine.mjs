// THROWAWAY RESEARCH PROTOTYPE - not production code. Mirrors the M1 doc's A1-A4 literally,
// so the experiments test the *design*, not a "better" implementation.
export const EPS = null; // dedicated constant, never a character
export class RegexError extends Error {
  constructor(code, message, pos) { super(message); this.code = code; this.pos = pos; }
}

// ---- tokenizer (code-point based; positions index the source string) ----
export function tokenize(src, { notation = 'standard' } = {}) {
  const toks = [];
  Array.from(src).forEach((ch, i) => {
    if (/\s/u.test(ch)) return;
    let type = 'SYMBOL';
    if (ch === '(') type = 'LPAREN';
    else if (ch === ')') type = 'RPAREN';
    else if (ch === '*') type = 'STAR';
    else if (ch === '?') type = 'OPT';
    else if (ch === '@' || ch === 'ε') type = 'EPSILON';
    else if (ch === '#' || ch === '∅') type = 'EMPTY';
    else if (ch === '|') {
      if (notation === 'standard') type = 'UNION';
      else throw new RegexError('NOT_AN_OPERATOR', "'|' is not an operator in textbook mode (use '+')", i);
    } else if (ch === '+') type = notation === 'standard' ? 'PLUS' : 'UNION';
    toks.push({ type, value: ch, pos: i });
  });
  return toks;
}

// ---- A1 INSERT_CONCAT ----
const ENDS = new Set(['SYMBOL', 'EPSILON', 'EMPTY', 'RPAREN', 'STAR', 'PLUS', 'OPT']);
const STARTS = new Set(['SYMBOL', 'EPSILON', 'EMPTY', 'LPAREN']);
export function insertConcat(toks) {
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    out.push(toks[i]);
    if (i + 1 < toks.length && ENDS.has(toks[i].type) && STARTS.has(toks[i + 1].type))
      out.push({ type: 'CONCAT', value: '·', pos: toks[i + 1].pos, synthetic: true });
  }
  return out;
}

// ---- A2 TO_POSTFIX (shunting-yard, exactly as in M1) ----
const PREC = { UNION: 1, CONCAT: 2 };
export function toPostfix(toks, mutate) {
  const P = mutate === 'prec-swap' ? { UNION: 2, CONCAT: 1 } : PREC;
  const out = [], ops = [];
  for (const t of toks) {
    switch (t.type) {
      case 'SYMBOL': case 'EPSILON': case 'EMPTY': out.push(t); break;
      case 'LPAREN': ops.push(t); break;
      case 'RPAREN':
        while (ops.length && ops[ops.length - 1].type !== 'LPAREN') out.push(ops.pop());
        if (!ops.length) throw new RegexError('UNBALANCED_RPAREN', "unmatched ')'", t.pos);
        ops.pop(); break;
      case 'STAR': case 'PLUS': case 'OPT': out.push(t); break;
      default:
        while (ops.length && ops[ops.length - 1].type !== 'LPAREN' && (mutate === 'assoc-right' ? P[ops[ops.length - 1].type] > P[t.type] : P[ops[ops.length - 1].type] >= P[t.type])) out.push(ops.pop());
        ops.push(t);
    }
  }
  while (ops.length) {
    const top = ops[ops.length - 1];
    if (top.type === 'LPAREN') throw new RegexError('UNBALANCED_LPAREN', "missing ')'", top.pos);
    out.push(ops.pop());
  }
  return out;
}

// ---- A3 BUILD (Thompson rules, one step per token). Step log stores COPIES (see report: aliasing hazard in merge mode) ----
export function build(postfix, { concat = 'epsilon-link', mutate } = {}) {
  let next = 0;
  const states = new Set();
  let trans = [];
  const S = [];
  const steps = [];
  postfix.forEach((t, idx) => {
    const step = { index: idx + 1, token: t, newStates: [], newTransitions: [], merged: null, stack: null, result: null };
    const mk = () => { const q = next++; states.add(q); step.newStates.push(q); return q; };
    const add = (from, to, label) => { trans.push({ from, to, label }); step.newTransitions.push({ from, to, label }); };
    const need = (n) => { if (S.length < n) throw new RegexError('MISSING_OPERAND', `'${t.value}' needs ${n} operand(s) but the stack holds ${S.length}`, t.pos); };
    switch (t.type) {
      case 'SYMBOL': { const s = mk(), f = mk(); add(s, f, t.value); S.push({ s, f }); break; }
      case 'EPSILON': { const s = mk(), f = mk(); if (mutate !== 'eps-as-empty') add(s, f, EPS); S.push({ s, f }); break; }
      case 'EMPTY': { const s = mk(), f = mk(); if (mutate === 'empty-as-eps') add(s, f, EPS); S.push({ s, f }); break; }
      case 'CONCAT': {
        need(2); const B = S.pop(), A = S.pop();
        if (concat === 'epsilon-link') add(A.f, B.s, EPS);
        else {
          if (trans.some(tr => tr.to === B.s)) throw new Error('I2 violated: transition enters B.start before merge');
          if (trans.some(tr => tr.from === A.f)) throw new Error('I3 violated: transition leaves A.accept before merge');
          if (mutate !== 'merge-no-move') trans = trans.map(tr => (tr.from === B.s ? { ...tr, from: A.f } : tr));
          states.delete(B.s);
          step.merged = { removed: B.s, into: A.f };
        }
        S.push({ s: A.s, f: B.f }); break;
      }
      case 'UNION': { need(2); const B = S.pop(), A = S.pop(); const s = mk(), f = mk(); add(s, A.s, EPS); add(s, B.s, EPS); add(A.f, f, EPS); if (mutate !== 'union-no-b-exit') add(B.f, f, EPS); S.push({ s, f }); break; }
      case 'STAR': { need(1); const A = S.pop(); const s = mk(), f = mk(); add(s, A.s, EPS); add(A.f, f, EPS); if (mutate !== 'star-no-skip') add(s, f, EPS); if (mutate !== 'star-no-back') add(A.f, A.s, EPS); S.push({ s, f }); break; }
      case 'PLUS': { need(1); const A = S.pop(); const s = mk(), f = mk(); add(s, A.s, EPS); add(A.f, f, EPS); add(A.f, A.s, EPS); if (mutate === 'plus-skip') add(s, f, EPS); S.push({ s, f }); break; }
      case 'OPT': { need(1); const A = S.pop(); const s = mk(), f = mk(); add(s, A.s, EPS); add(A.f, f, EPS); if (mutate !== 'opt-no-skip') add(s, f, EPS); S.push({ s, f }); break; }
      default: throw new RegexError('UNEXPECTED_TOKEN', `unexpected ${t.type} in postfix`, t.pos);
    }
    step.stack = S.map(x => ({ ...x }));
    step.result = { ...S[S.length - 1] };
    steps.push(step);
  });
  if (S.length !== 1) throw new RegexError('INVALID_EXPRESSION', S.length === 0 ? 'nothing to build (empty expression or empty group)' : `${S.length} fragments left on the stack`, undefined);
  return { nfa: { states, transitions: trans, start: S[0].s, accept: S[0].f }, steps };
}

export function compileNaive(src, opts = {}) {
  const tokens = tokenize(src, opts);
  const withConcat = insertConcat(tokens);
  const postfix = toPostfix(withConcat, opts.mutate);
  const { nfa, steps } = build(postfix, opts);
  return { tokens, withConcat, postfix, nfa, steps };
}

// ---- A4 simulator ----
export function makeSim(nfa, mutate) {
  const out = new Map(); for (const q of nfa.states) out.set(q, []);
  for (const t of nfa.transitions) out.get(t.from).push(t);
  const closure = (set) => {
    const C = new Set(set); const stack = [...set];
    while (stack.length) { const q = stack.pop(); for (const t of out.get(q)) if (t.label === EPS && !C.has(t.to)) { C.add(t.to); if (mutate !== 'closure-one-step') stack.push(t.to); } }
    return C;
  };
  const move = (set, a) => { const R = new Set(); for (const q of set) for (const t of out.get(q)) if (t.label === a) R.add(t.to); return R; };
  const run = (w) => {
    let S = mutate === 'no-initial-closure' ? new Set([nfa.start]) : closure(new Set([nfa.start])); const sets = [S];
    for (const a of Array.from(w)) { S = mutate === 'no-closure-after-move' ? move(closure(S), a) : closure(move(S, a)); sets.push(S); }
    return { accepted: S.has(nfa.accept), sets };
  };
  return { closure, move, run };
}

// ---- invariants I1-I4 + size formula ----
export function checkInvariants(nfa) {
  const I1 = nfa.states.has(nfa.start) && nfa.states.has(nfa.accept) && nfa.start !== nfa.accept;
  const I2 = !nfa.transitions.some(t => t.to === nfa.start);
  const I3 = !nfa.transitions.some(t => t.from === nfa.accept);
  let I4 = true;
  for (const q of nfa.states) {
    const o = nfa.transitions.filter(t => t.from === q);
    const sym = o.filter(t => t.label !== EPS).length, eps = o.length - sym;
    if (!((sym === 1 && eps === 0) || (sym === 0 && eps <= 2))) I4 = false;
  }
  const dangling = nfa.transitions.some(t => !nfa.states.has(t.from) || !nfa.states.has(t.to));
  return { I1, I2, I3, I4, noDanglingEdges: !dangling };
}
export function expectedSize(postfix, concat) {
  let atoms = 0, un = 0, unary = 0, cat = 0;
  for (const t of postfix) {
    if (['SYMBOL', 'EPSILON', 'EMPTY'].includes(t.type)) atoms++;
    else if (t.type === 'UNION') un++;
    else if (t.type === 'CONCAT') cat++;
    else unary++;
  }
  const base = 2 * (atoms + un + unary);
  return concat === 'merge' ? base - cat : base;
}

// ---- step-log replay: can the log alone reconstruct the final NFA? ----
export function replay(steps) {
  const states = new Set(); let trans = [];
  for (const s of steps) {
    for (const q of s.newStates) states.add(q);
    if (s.merged) { states.delete(s.merged.removed); trans = trans.map(t => (t.from === s.merged.removed ? { ...t, from: s.merged.into } : t)); }
    for (const t of s.newTransitions) trans.push({ ...t });
  }
  return { states, trans };
}

// ---- independent front-end: recursive descent -> AST (second implementation of the grammar) ----
export function parseRD(src, { notation = 'standard' } = {}) {
  const toks = tokenize(src, { notation });
  let i = 0;
  const peek = () => toks[i];
  const startsAtom = (t) => t && ['SYMBOL', 'EPSILON', 'EMPTY', 'LPAREN'].includes(t.type);
  const isPost = (t) => t && ['STAR', 'PLUS', 'OPT'].includes(t.type);
  const parseUnion = () => {
    let left = parseConcat();
    while (peek() && peek().type === 'UNION') { i++; const right = parseConcat(); left = { k: 'union', l: left, r: right }; }
    return left;
  };
  const parseConcat = () => {
    const t = peek();
    if (!startsAtom(t)) {
      if (!t) throw new RegexError('MISSING_OPERAND', 'expression ends where an operand is expected', Array.from(src).length);
      if (t.type === 'UNION') throw new RegexError('MISSING_OPERAND', `'${t.value}' has no operand before it`, t.pos);
      if (isPost(t)) throw new RegexError('NOTHING_TO_REPEAT', `'${t.value}' has nothing to repeat`, t.pos);
      if (t.type === 'RPAREN') { const prev = toks[i - 1]; if (prev && prev.type === 'LPAREN') throw new RegexError('EMPTY_GROUP', 'empty group ()', prev.pos); throw new RegexError('MISSING_OPERAND', "operand expected before ')'", t.pos); }
    }
    let left = parsePostfix();
    while (startsAtom(peek())) { const right = parsePostfix(); left = { k: 'cat', l: left, r: right }; }
    return left;
  };
  const parsePostfix = () => {
    let a = parseAtom();
    while (isPost(peek())) { const t = toks[i++]; a = { k: t.type.toLowerCase(), c: a }; }
    return a;
  };
  const parseAtom = () => {
    const t = toks[i++];
    switch (t.type) {
      case 'SYMBOL': return { k: 'sym', v: t.value };
      case 'EPSILON': return { k: 'eps' };
      case 'EMPTY': return { k: 'empty' };
      default: { // LPAREN (only other token that can start an atom)
        if (!peek()) throw new RegexError('UNBALANCED_LPAREN', "missing ')'", t.pos);
        const e = parseUnion();
        const close = toks[i++];
        if (!close || close.type !== 'RPAREN') throw new RegexError('UNBALANCED_LPAREN', "missing ')'", t.pos);
        return e;
      }
    }
  };
  if (toks.length === 0) throw new RegexError('MISSING_OPERAND', 'empty expression', 0);
  const ast = parseUnion();
  if (i < toks.length) throw new RegexError('UNBALANCED_RPAREN', "unmatched ')'", toks[i].pos);
  return ast;
}

export function astFromPostfix(postfix) {
  const S = [];
  for (const t of postfix) {
    switch (t.type) {
      case 'SYMBOL': S.push({ k: 'sym', v: t.value }); break;
      case 'EPSILON': S.push({ k: 'eps' }); break;
      case 'EMPTY': S.push({ k: 'empty' }); break;
      case 'STAR': case 'PLUS': case 'OPT': { const c = S.pop(); S.push({ k: t.type.toLowerCase(), c }); break; }
      default: { const r = S.pop(), l = S.pop(); S.push({ k: t.type === 'UNION' ? 'union' : 'cat', l, r }); }
    }
  }
  return S[0];
}
