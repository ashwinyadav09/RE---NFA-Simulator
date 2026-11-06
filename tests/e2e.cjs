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

  // 10. Simulation test: enter 'ba', click #run-button, verify ACCEPT and the two sets
  await page.fill('#test-input', 'ba');
  await page.click('#run-button');
  await page.waitForFunction('window.__runDone === true', null, { timeout: 15000 });

  const verdictText = await page.textContent('#verdict');
  console.log('Verdict text:', verdictText);
  assert(verdictText.includes('ACCEPT'), 'Verdict must report ACCEPT for "ba"');

  const traceText = await page.textContent('#trace');
  console.log('Trace text:', traceText);
  assert(traceText.includes('0, 2, 3, 4, 5, 7, 8'), 'Trace must show the active set after b: {0, 2, 3, 4, 5, 7, 8}');
  assert(traceText.includes('0, 1, 2, 4, 5, 7, 8, 9'), 'Trace must show the active set after a: {0, 1, 2, 4, 5, 7, 8, 9}');

  // 11. HTML escaping test: enter test string '<b>& ', click Run, verify #trace has no <b> element and textContent contains literal '<b>&'
  await page.evaluate(() => { window.__runDone = false; });
  await page.fill('#test-input', '<b>& ');
  await page.click('#run-button');
  await page.waitForFunction('window.__runDone === true', null, { timeout: 15000 });

  const hasBElement = await page.evaluate(() => document.querySelector('#trace b') !== null);
  assert.strictEqual(hasBElement, false, '#trace must have no <b> child element');

  const traceEscapedText = await page.textContent('#trace');
  console.log('Trace escaped text:', traceEscapedText);
  assert(traceEscapedText.includes('<b>&'), 'Trace textContent must contain the literal "<b>&"');

  // 12. Syntax error test: type '(a|)', see error at position 2, last good build stays
  await page.evaluate(() => { window.__buildDone = false; });
  await page.fill('#regex-input', '(a|)');
  await page.click('#build-button');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });

  const errorText = await page.textContent('#error-message');
  console.log('Error text for "(a|)":', errorText);
  assert(errorText.includes('position 2'), 'Error message must mention position 2');
  const errorCode = await page.getAttribute('#error-message', 'data-error-code');
  assert.strictEqual(errorCode, 'MISSING_OPERAND', 'Error code must be MISSING_OPERAND');

  const errorPosAttr = await page.getAttribute('#regex-input', 'data-error-position');
  assert.strictEqual(errorPosAttr, '2', 'regex-input must mark data-error-position="2"');

  // Verify last good build stays on screen
  const statsAfterError = await page.textContent('#stats');
  assert(statsAfterError.includes('States: 10'), 'Previous stats must stay on screen after error');
  const hasSvgAfterError = await page.evaluate(() => !!document.querySelector('#canvas svg'));
  assert(hasSvgAfterError, 'Previous canvas SVG must stay on screen after error');

  // 13. Empty input hint test directly after error: build '(a|)' -> attribute is '2'. Clear the input and build -> attribute is absent, hint is shown, last good build is still on screen.
  await page.evaluate(() => { window.__buildDone = false; });
  await page.fill('#regex-input', '');
  await page.click('#build-button');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });

  const hintText = await page.textContent('#error-message');
  console.log('Hint text for empty input:', hintText);
  assert(hintText.length > 0, 'Empty input must show a hint');
  const errorClass = await page.getAttribute('#error-message', 'class');
  assert(errorClass.includes('hint') && !errorClass.includes('error'), 'Empty input hint must not be styled as an error');

  const emptyPosAttr = await page.getAttribute('#regex-input', 'data-error-position');
  assert.strictEqual(emptyPosAttr, null, 'regex-input data-error-position must be absent on empty input');

  const statsAfterEmpty = await page.textContent('#stats');
  assert(statsAfterEmpty.includes('States: 10'), 'Previous build stats must stay on screen on empty input');

  // Fix the error by building (a|b)*a
  await page.evaluate(() => { window.__buildDone = false; });
  await page.fill('#regex-input', '(a|b)*a');
  await page.click('#build-button');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });

  const errorTextFixed = await page.textContent('#error-message');
  assert.strictEqual(errorTextFixed, '', 'Error message must be cleared after fixing syntax error');
  const fixedPosAttr = await page.getAttribute('#regex-input', 'data-error-position');
  assert.strictEqual(fixedPosAttr, null, 'regex-input data-error-position must be removed after successful build');

  // 14. Non-BMP UTF-16 selection range test: '🚀 |' error at code point 2 has UTF-16 selection [3, 4]
  await page.evaluate(() => { window.__buildDone = false; });
  await page.fill('#regex-input', '🚀 |');
  await page.click('#build-button');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });

  const selection = await page.evaluate(() => {
    const el = document.getElementById('regex-input');
    return { start: el.selectionStart, end: el.selectionEnd };
  });
  console.log('Selection for "🚀 |":', selection);
  assert.strictEqual(selection.start, 3, 'selectionStart must be UTF-16 offset 3');
  assert.strictEqual(selection.end, 4, 'selectionEnd must be UTF-16 offset 4');


  // ---- Ticket 05: token-list, tree-view, plus and optional ----

  // 15. Build (a|b)*a again and verify token-list and tree-view are populated
  await page.evaluate(() => { window.__buildDone = false; });
  await page.fill('#regex-input', '(a|b)*a');
  await page.click('#build-button');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });

  const tokenListText = await page.textContent('#token-list');
  console.log('Token list text:', tokenListText);
  assert(tokenListText.includes('SYMBOL(a)'), 'token-list must include SYMBOL(a)');
  assert(tokenListText.includes('UNION'), 'token-list must include UNION');
  assert(tokenListText.includes('STAR'), 'token-list must include STAR');

  const treeViewText = await page.textContent('#tree-view');
  console.log('Tree view text for (a|b)*a:', treeViewText);
  assert(treeViewText.includes('cat'), 'tree-view must include cat node');
  assert(treeViewText.includes('star'), 'tree-view must include star node');
  assert(treeViewText.includes('union'), 'tree-view must include union node');
  assert(treeViewText.includes('sym(a)'), 'tree-view must include sym(a)');
  assert(treeViewText.includes('sym(b)'), 'tree-view must include sym(b)');

  // 16. Build 'a+?' and verify 6 states / 7 transitions, tree-view shows opt(plus(a))
  await page.evaluate(() => { window.__buildDone = false; });
  await page.fill('#regex-input', 'a+?');
  await page.click('#build-button');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });

  const statsPlusOpt = await page.textContent('#stats');
  console.log('Stats for a+?:', statsPlusOpt);
  assert(statsPlusOpt.includes('States: 6'), 'a+? must have 6 states');
  assert(statsPlusOpt.includes('Transitions: 7'), 'a+? must have 7 transitions');

  const treePlusOpt = await page.textContent('#tree-view');
  console.log('Tree view for a+?:', treePlusOpt);
  assert(treePlusOpt.includes('opt'), 'tree-view for a+? must show opt');
  assert(treePlusOpt.includes('plus'), 'tree-view for a+? must show plus');
  assert(treePlusOpt.includes('sym(a)'), 'tree-view for a+? must show sym(a)');
  assert(treePlusOpt.indexOf('opt') < treePlusOpt.indexOf('plus'), 'opt must be parent of plus in a+?');

  // 17. Build 'a**' and verify 6 states / 9 transitions, tree-view shows star(star(a))
  await page.evaluate(() => { window.__buildDone = false; });
  await page.fill('#regex-input', 'a**');
  await page.click('#build-button');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });

  const statsStarStar = await page.textContent('#stats');
  console.log('Stats for a**:', statsStarStar);
  assert(statsStarStar.includes('States: 6'), 'a** must have 6 states');
  assert(statsStarStar.includes('Transitions: 9'), 'a** must have 9 transitions');

  const treeStarStar = await page.textContent('#tree-view');
  console.log('Tree view for a**:', treeStarStar);
  assert((treeStarStar.match(/star/g) || []).length >= 2, 'tree-view for a** must show two star nodes');
  assert(treeStarStar.includes('sym(a)'), 'tree-view for a** must show sym(a)');

  // 18. Build 'a+', simulate, verify: 'a' -> ACCEPT, '' -> REJECT
  await page.evaluate(() => { window.__buildDone = false; });
  await page.fill('#regex-input', 'a+');
  await page.click('#build-button');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });

  await page.evaluate(() => { window.__runDone = false; });
  await page.fill('#test-input', 'a\n');
  await page.click('#run-button');
  await page.waitForFunction('window.__runDone === true', null, { timeout: 15000 });
  const verdictPlus = await page.textContent('#verdict');
  console.log('Verdict for a+ on "a" / "":', verdictPlus);
  assert(verdictPlus.includes('ACCEPT'), 'a+ must accept "a"');
  assert(verdictPlus.includes('REJECT'), 'a+ must reject ""');

  assert.strictEqual(errors.length, 0, `Page errors encountered: ${errors.join(', ')}`);


  await browser.close();
  console.log('E2E test passed successfully!');
})().catch((err) => {
  console.error('E2E test failed:', err);
  process.exit(1);
});
