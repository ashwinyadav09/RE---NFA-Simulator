/// <reference types="vite/client" />
import { instance } from '@viz-js/viz';
import StressWorker from './stress.worker.ts?worker&inline';
(async () => {
  const viz = await instance();
  const svg = viz.renderSVGElement('digraph { rankdir=LR; a -> b [label="ε", style=dashed]; }');
  document.getElementById('out')!.appendChild(svg);
  (window as any).__svgNodes = svg.querySelectorAll('g.node').length;
  const w = new StressWorker();
  w.onmessage = (e: MessageEvent) => { document.getElementById('w')!.textContent = JSON.stringify(e.data); (window as any).__workerResult = e.data; };
  w.postMessage({ n: 18 });
  (window as any).__ready = true;
})();
