// THROWAWAY: three independent oracles that never build an NFA.
// (1) bounded-language enumerator = the M1 Section 1.4 semantics, executed literally
export function lang(ast, k) {
  switch (ast.k) {
    case 'empty': return new Set();
    case 'eps': return new Set(['']);
    case 'sym': return k >= 1 ? new Set([ast.v]) : new Set();
    case 'union': return new Set([...lang(ast.l, k), ...lang(ast.r, k)]);
    case 'cat': { const A = lang(ast.l, k), B = lang(ast.r, k), R = new Set(); for (const x of A) for (const y of B) if (x.length + y.length <= k) R.add(x + y); return R; }
    case 'star': { const A = lang(ast.c, k); let S = new Set(['']); for (;;) { const N = new Set(S); for (const x of A) for (const y of S) if (x.length + y.length <= k) N.add(x + y); if (N.size === S.size) return S; S = N; } }
    case 'plus': { const A = lang(ast.c, k), St = lang({ k: 'star', c: ast.c }, k), R = new Set(); for (const x of A) for (const y of St) if (x.length + y.length <= k) R.add(x + y); return R; }
    case 'opt': { const S = new Set(lang(ast.c, k)); S.add(''); return S; }
  }
}
// (2) Brzozowski derivatives with smart constructors
const E0 = { k: 'empty' }, E1 = { k: 'eps' };
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
const U = (x, y) => (x.k === 'empty' ? y : y.k === 'empty' ? x : same(x, y) ? x : { k: 'union', l: x, r: y });
const C = (x, y) => (x.k === 'empty' || y.k === 'empty' ? E0 : x.k === 'eps' ? y : y.k === 'eps' ? x : { k: 'cat', l: x, r: y });
export function nullable(r) {
  switch (r.k) { case 'empty': case 'sym': return false; case 'eps': case 'star': case 'opt': return true;
    case 'union': return nullable(r.l) || nullable(r.r); case 'cat': return nullable(r.l) && nullable(r.r); case 'plus': return nullable(r.c); }
}
export function deriv(r, a) {
  switch (r.k) {
    case 'empty': case 'eps': return E0;
    case 'sym': return r.v === a ? E1 : E0;
    case 'union': return U(deriv(r.l, a), deriv(r.r, a));
    case 'cat': { const d = C(deriv(r.l, a), r.r); return nullable(r.l) ? U(d, deriv(r.r, a)) : d; }
    case 'star': return C(deriv(r.c, a), r);
    case 'plus': return C(deriv(r.c, a), { k: 'star', c: r.c });
    case 'opt': return deriv(r.c, a);
  }
}
export const derivMatch = (ast, w) => { let r = ast; for (const a of Array.from(w)) r = deriv(r, a); return nullable(r); };
// (3) JS RegExp via a translator that wraps EVERY operand in a non-capturing group and anchors the whole string
export function toJs(ast) {
  switch (ast.k) {
    case 'sym': return ast.v.replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&');
    case 'eps': return '(?:)';
    case 'empty': return '(?!)';
    case 'union': return `(?:${toJs(ast.l)}|${toJs(ast.r)})`;
    case 'cat': return `(?:${toJs(ast.l)}${toJs(ast.r)})`;
    case 'star': return `(?:${toJs(ast.c)})*`;
    case 'plus': return `(?:${toJs(ast.c)})+`;
    case 'opt': return `(?:${toJs(ast.c)})?`;
  }
}
export const jsRegExp = (ast) => new RegExp('^' + toJs(ast) + '$');
// printer used to generate SOURCE strings from ASTs (so both front-ends are exercised)
const prec = { union: 1, cat: 2, star: 3, plus: 3, opt: 3, sym: 4, eps: 4, empty: 4 };
export function print(ast, n = 'standard') {
  const wrap = (child, parent, side) => {
    const s = print(child, n); const pc = prec[child.k], pp = prec[parent.k];
    let paren = pc < pp;
    if (!paren && pc === pp && (parent.k === 'union' || parent.k === 'cat') && side === 'r') paren = true;
    return paren ? `(${s})` : s;
  };
  switch (ast.k) {
    case 'sym': return ast.v; case 'eps': return '@'; case 'empty': return '#';
    case 'union': return wrap(ast.l, ast, 'l') + (n === 'standard' ? '|' : '+') + wrap(ast.r, ast, 'r');
    case 'cat': return wrap(ast.l, ast, 'l') + wrap(ast.r, ast, 'r');
    case 'star': return wrap(ast.c, ast, 'c') + '*';
    case 'plus': return wrap(ast.c, ast, 'c') + '+';
    case 'opt': return wrap(ast.c, ast, 'c') + '?';
  }
}
export const desugar = (ast) => {
  switch (ast.k) {
    case 'plus': { const c = desugar(ast.c); return { k: 'cat', l: c, r: { k: 'star', c } }; }
    case 'union': case 'cat': return { k: ast.k, l: desugar(ast.l), r: desugar(ast.r) };
    case 'star': case 'opt': return { k: ast.k, c: desugar(ast.c) };
    default: return ast;
  }
};
export const allStrings = (alpha, maxLen) => { let out = ['']; let layer = ['']; for (let n = 1; n <= maxLen; n++) { layer = layer.flatMap(s => alpha.map(a => s + a)); out = out.concat(layer); } return out; };
