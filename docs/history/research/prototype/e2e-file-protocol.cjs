const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage(); const logs = [];
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`)); page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
  const t0 = Date.now();
  await page.goto('file:///tmp/toolchain/app/dist/index.html');
  await page.waitForFunction('window.__ready === true', null, { timeout: 15000 });
  const loadMs = Date.now() - t0;
  await page.waitForFunction('window.__workerResult !== undefined', null, { timeout: 15000 });
  const r = await page.evaluate(() => ({ svgNodes: window.__svgNodes, svgInDom: !!document.querySelector('#out svg'), dashed: document.querySelectorAll('#out svg path[stroke-dasharray]').length, worker: window.__workerResult, wasm: typeof WebAssembly, origin: location.protocol }));
  console.log('single-file build via file://  =>', JSON.stringify(r), `ready in ${loadMs} ms`, 'console:', JSON.stringify(logs));
  const p2 = await browser.newPage(); const logs2 = []; p2.on('console', (m) => logs2.push(`${m.type()}: ${m.text().slice(0, 140)}`)); p2.on('pageerror', (e) => logs2.push('pageerror: ' + e.message.slice(0, 140)));
  await p2.goto('file:///tmp/toolchain/fileworker/index.html'); await p2.waitForTimeout(1800);
  console.log('plain external worker via file:// =>', await p2.evaluate(() => document.getElementById('r').textContent), JSON.stringify(logs2));
  await browser.close();
})().catch((e) => { console.error('E2E FAILED', e); process.exit(1); });
