const { chromium } = require('playwright');
const path = require('node:path');
const assert = require('node:assert');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const logs = [];
  const errors = [];
  page.on('console', (msg) => logs.push(`${msg.type()}: ${msg.text()}`));
  page.on('pageerror', (err) => errors.push(err.message));

  const distHtmlPath = path.resolve(__dirname, '../dist/index.html');
  const fileUrl = 'file:///' + distHtmlPath.replace(/\\/g, '/');

  console.log(`Opening ${fileUrl}...`);
  await page.goto(fileUrl);

  // 1. Check page readiness
  await page.waitForFunction('window.__ready === true', null, { timeout: 15000 });

  // 2. Check inline worker round-trip over file://
  await page.waitForFunction('window.__workerResult !== undefined', null, { timeout: 15000 });
  const workerResult = await page.evaluate(() => window.__workerResult);
  console.log('Worker result:', workerResult);
  assert.strictEqual(workerResult.pong, 'hello', 'Inline worker must return pong');

  // 3. Type '(a|b)*a' into #regex-input
  await page.fill('#regex-input', '(a|b)*a');

  // 4. Click #build-button
  await page.click('#build-button');

  // 5. Wait for build to complete
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });

  // 6. Check #stats
  const statsText = await page.textContent('#stats');
  console.log('Stats text:', statsText);
  assert(statsText.includes('States: 10'), 'Stats must report 10 states');
  assert(statsText.includes('Transitions: 12'), 'Stats must report 12 transitions');

  // 7. Check #postfix-view
  const postfixText = await page.textContent('#postfix-view');
  console.log('Postfix text:', postfixText);
  assert(postfixText.includes('UNION'), 'Postfix must contain UNION');
  assert(postfixText.includes('STAR'), 'Postfix must contain STAR');
  assert(postfixText.includes('CONCAT'), 'Postfix must contain CONCAT');

  // 8. Check #transition-table
  const tableRows = await page.evaluate(() => document.querySelectorAll('#transition-table tbody tr').length);
  console.log('Transition table rows:', tableRows);
  assert(tableRows >= 10, 'Transition table must contain rows for all 10 states');

  // 9. Check #canvas contains rendered SVG with nodes and edges
  const hasSvg = await page.evaluate(() => !!document.querySelector('#canvas svg'));
  assert(hasSvg, 'Canvas must contain rendered SVG');

  const nodeCount = await page.evaluate(() => document.querySelectorAll('#canvas svg g.node').length);
  const edgeCount = await page.evaluate(() => document.querySelectorAll('#canvas svg g.edge').length);
  console.log(`Rendered SVG: ${nodeCount} nodes, ${edgeCount} edges`);
  // Graphviz renders 10 NFA state nodes + 1 start pseudo-node = 11 nodes
  assert(nodeCount >= 10, 'SVG must contain at least 10 state nodes');
  // 12 NFA transitions + 1 start arrow = 13 edges
  assert(edgeCount >= 12, 'SVG must contain at least 12 edges');

  assert.strictEqual(errors.length, 0, `Page errors encountered: ${errors.join(', ')}`);

  await browser.close();
  console.log('E2E test passed successfully!');
})().catch((err) => {
  console.error('E2E test failed:', err);
  process.exit(1);
});
