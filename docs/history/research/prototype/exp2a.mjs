import { compileNaive, parseRD, astFromPostfix, RegexError } from './engine.mjs';
const run = (f) => { try { return { ok: true, x: f() }; } catch (e) { return e instanceof RegexError ? { ok: false, code: e.code, pos: e.pos } : { crash: String(e) }; } };
function sweep(label, alphabet, maxLenExhaustive, randomCount, randomMaxLen, notation) {
  let total = 0, validityDis = [], astDis = [], crashes = [], codeDis = 0, posDis = 0, invalid = 0, undefPos = 0;
  const test = (s) => {
    total++;
    const a = run(() => compileNaive(s, { notation })), b = run(() => parseRD(s, { notation }));
    if (a.crash || b.crash) { crashes.push([s, a.crash ?? b.crash]); return; }
    if (a.ok !== b.ok) { validityDis.length < 5 && validityDis.push(`${s} -> pipeline:${a.ok ? 'OK' : a.code} rd:${b.ok ? 'OK' : b.code}`); validityDis.n = (validityDis.n || 0) + 1; return; }
    if (a.ok) { if (JSON.stringify(astFromPostfix(a.x.postfix)) !== JSON.stringify(b.x)) { astDis.length < 5 && astDis.push(s); astDis.n = (astDis.n || 0) + 1; } }
    else { invalid++; if (a.code !== b.code) codeDis++; if (a.pos !== b.pos) posDis++; if (a.pos === undefined) undefPos++; }
  };
  const base = alphabet.length;
  for (let n = 1; n <= maxLenExhaustive; n++) { const tot = base ** n; for (let k = 0; k < tot; k++) { let s = '', x = k; for (let i = 0; i < n; i++) { s += alphabet[x % base]; x = Math.floor(x / base); } test(s); } }
  let seed = 123456789; const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  for (let i = 0; i < randomCount; i++) { const n = maxLenExhaustive + 1 + Math.floor(rnd() * (randomMaxLen - maxLenExhaustive)); let s = ''; for (let j = 0; j < n; j++) s += alphabet[Math.floor(rnd() * base)]; test(s); }
  console.log(`${label}: tested ${total}; validity disagreements ${validityDis.n || 0} ${JSON.stringify(validityDis)}; AST disagreements on valid inputs ${astDis.n || 0} ${JSON.stringify(astDis)}; crashes ${crashes.length} ${JSON.stringify(crashes.slice(0, 3))}`);
  console.log(`   among ${invalid} invalid inputs: error-code differs ${codeDis} (${(100 * codeDis / invalid).toFixed(1)}%), position differs ${posDis} (${(100 * posDis / invalid).toFixed(1)}%), pipeline gave NO position ${undefPos}`);
}
const t0 = Date.now();
sweep('standard notation', ['a', 'b', '|', '*', '+', '?', '(', ')', '@', '#'], 6, 300000, 10, 'standard');
sweep('textbook notation', ['a', 'b', '+', '*', '?', '(', ')', '@', '#'], 6, 150000, 10, 'textbook');
console.log(`(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
