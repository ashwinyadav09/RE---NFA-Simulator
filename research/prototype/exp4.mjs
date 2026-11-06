import * as Viz from '@viz-js/viz';
import { performance } from 'node:perf_hooks';
import { compileNaive, replay, EPS } from './engine.mjs';
const lbl = (t) => (t.label === EPS ? 'ε' : t.label);
function toDot(states, trans, { start, accept, hi = new Set(), pin = null, extra = '' } = {}) {
  const L = ['digraph NFA {', '  rankdir=LR;', '  node [shape=circle, fontname="Helvetica"];', '  edge [fontname="Helvetica"];', extra];
  L.push('  __start [shape=point, label="", width=0.1];');
  for (const q of [...states].sort((a, b) => a - b)) {
    const a = [`id="n${q}"`, `label="${q}"`]; if (q === accept) a.push('shape=doublecircle'); if (hi.has(q)) a.push('color="#d62728"', 'penwidth=2.5');
    if (pin && pin.has(q)) { const [x, y] = pin.get(q); a.push(`pos="${(x / 72).toFixed(4)},${(y / 72).toFixed(4)}!"`); }
    L.push(`  q${q} [${a.join(', ')}];`);
  }
  if (start !== undefined && states.has(start)) L.push(`  __start -> q${start};`);
  trans.forEach((t, i) => { const a = [`id="e${i}"`, `label="${lbl(t)}"`]; if (t.label === EPS) a.push('style=dashed'); L.push(`  q${t.from} -> q${t.to} [${a.join(', ')}];`); });
  L.push('}'); return L.join('\n');
}
let t = performance.now(); const viz = await Viz.instance(); console.log(`Viz.instance() init: ${(performance.now() - t).toFixed(0)} ms; Graphviz ${viz.graphvizVersion}; engines ${viz.engines}; formats(subset) ${viz.formats.filter(f => ['svg', 'json', 'dot', 'plain'].includes(f))}`);
const r = compileNaive('(a|b)*abb'); const { nfa, steps } = r;
const dot = toDot(nfa.states, nfa.transitions, { start: nfa.start, accept: nfa.accept, hi: new Set([nfa.start]) });
const svg = viz.renderString(dot, { format: 'svg' });
const nNodes = (svg.match(/class="node"/g) || []).length, nEdges = (svg.match(/class="edge"/g) || []).length;
console.log(`final NFA of (a|b)*abb: SVG ${svg.length} chars, ${nNodes} nodes (+1 start marker), ${nEdges} edges; ids honoured: node n0 ${/id="n0"/.test(svg)}, edge e0 ${/id="e0"/.test(svg)}; ε glyph ${svg.includes('ε')}; dashed edges ${(svg.match(/stroke-dasharray/g) || []).length}; accept node drawn as 2 ellipses ${/<g id="n13"[\s\S]*?<\/g>/.exec(svg)?.[0].match(/<ellipse/g)?.length}`);
const el = viz.renderSVGElement ? 'renderSVGElement exists (needs DOM; not run in Node)' : 'no renderSVGElement'; console.log(el);
// layout JSON
const json = viz.renderJSON(dot); const pos = new Map(); for (const o of json.objects) { const m = /^q(\d+)$/.exec(o.name); if (m) { const [x, y] = o.pos.split(',').map(Number); pos.set(+m[1], [x, y]); } }
console.log(`renderJSON: ${json.objects.length} objects, bb=${json.bb}, sample ${JSON.stringify(json.objects.find(o => o.name === 'q0').pos)}`);
// layout stability across construction steps: unpinned dot vs pinned neato
const dev = (a, b) => { const ks = [...a.keys()].filter(k => b.has(k)); if (ks.length < 2) return 0; const dx = a.get(ks[0])[0] - b.get(ks[0])[0], dy = a.get(ks[0])[1] - b.get(ks[0])[1]; return Math.max(...ks.map(k => Math.hypot(a.get(k)[0] - b.get(k)[0] - dx, a.get(k)[1] - b.get(k)[1] - dy))); };
const readPos = (j) => { const m = new Map(); for (const o of j.objects) { const mm = /^q(\d+)$/.exec(o.name); if (mm && o.pos) { const [x, y] = o.pos.split(',').map(Number); m.set(+mm[1], [x, y]); } } return m; };
console.log('\nstep | nodes | max drift vs final layout (points):  plain dot per step | neato with pinned positions');
const wide = (nfa.states.size);
for (let k = 1; k <= steps.length; k++) {
  const snap = replay(steps.slice(0, k)); const st = snap.states, tr = snap.trans;
  const startQ = steps[k - 1].result.s; const acc = steps[k - 1].result.f;
  const plain = readPos(viz.renderJSON(toDot(st, tr, { start: startQ, accept: acc })));
  let pinnedDrift = 'n/a'; let svgOk = '';
  try {
    const pj = viz.renderJSON(toDot(st, tr, { start: startQ, accept: acc, pin: new Map([...st].map(q => [q, pos.get(q)])), extra: '  splines=true;' }), { engine: 'neato' });
    pinnedDrift = dev(pos, readPos(pj)).toFixed(1);
    svgOk = viz.renderString(toDot(st, tr, { start: startQ, accept: acc, pin: new Map([...st].map(q => [q, pos.get(q)])), extra: '  splines=true;' }), { engine: 'neato', format: 'svg' }).includes('<svg') ? 'svg ok' : 'svg ?';
  } catch (e) { pinnedDrift = 'ERR ' + e.message.slice(0, 60); }
  console.log(`${String(k).padStart(4)} | ${String(st.size).padStart(5)} | ${dev(pos, plain).toFixed(1).padStart(8)}   | ${pinnedDrift} ${svgOk}`);
}
// collapsed-fragment (textbook box) rendering
const box = `digraph G { rankdir=LR; node [shape=circle]; __s [shape=point,label="",width=.1]; __s -> q6; q6 [label="6"]; q7 [label="7", shape=doublecircle];
  box [shape=record, label="{<in>|(a\\|b)|<out>}", id="frag1"]; q6 -> box:in [label="ε", style=dashed]; box:out -> q7 [label="ε", style=dashed]; box:out -> box:in [label="ε", style=dashed]; q6 -> q7 [label="ε", style=dashed]; }`;
try { const s = viz.renderString(box, { format: 'svg' }); console.log(`\ncollapsed-fragment record node with ports renders: ${s.includes('id="frag1"')} (${s.length} chars)`); } catch (e) { console.log('collapsed fragment ERR', e.message); }
// cluster per fragment
const cl = `digraph G { rankdir=LR; compound=true; subgraph cluster_f1 { label="a|b"; style=rounded; q4 -> q0 [label="ε"]; q4 -> q2 [label="ε"]; q0 -> q1 [label="a"]; q2 -> q3 [label="b"]; q1 -> q5 [label="ε"]; q3 -> q5 [label="ε"]; } q6 -> q4 [label="ε", lhead=cluster_f1]; q5 -> q7 [label="ε"]; }`;
try { const s = viz.renderString(cl, { format: 'svg' }); console.log(`cluster-per-fragment renders: ${s.includes('class="cluster"')}`); } catch (e) { console.log('cluster ERR', e.message); }
// error handling: invalid DOT
try { viz.renderString('digraph { a -> }', { format: 'svg' }); console.log('invalid DOT: no throw?!'); } catch (e) { console.log(`invalid DOT throws: ${String(e.message).slice(0, 70)}`); }
const r2 = viz.render('digraph { a -> }', { format: 'svg' }); console.log(`viz.render() on invalid DOT returns status=${r2.status}, errors[0]=${JSON.stringify(r2.errors?.[0])?.slice(0, 90)}`);
// scaling
console.log('\nrender time vs size (median of 5, dot, rankdir=LR):');
for (const k of [1, 5, 20, 50, 100]) {
  const src = Array(k).fill('(a|b)*abb').join(''); const c = compileNaive(src); const d = toDot(c.nfa.states, c.nfa.transitions, { start: c.nfa.start, accept: c.nfa.accept });
  const ts = []; let len = 0; for (let i = 0; i < 5; i++) { const t0 = performance.now(); len = viz.renderString(d, { format: 'svg' }).length; ts.push(performance.now() - t0); if (ts[0] > 20000) break; }
  ts.sort((a, b) => a - b); console.log(`  ${String(c.tokensLen ?? c.postfix.length).padStart(5)} postfix tokens, ${String(c.nfa.states.size).padStart(5)} states, ${String(c.nfa.transitions.length).padStart(5)} transitions: ${ts[Math.floor(ts.length / 2)].toFixed(0).padStart(6)} ms, SVG ${(len / 1024).toFixed(0)} KB`);
  if (ts[0] > 20000) break;
}
