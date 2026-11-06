const fs = require('fs');
const path = require('path');

const e2ePath = path.join(__dirname, '../../tests/e2e.cjs');
let content = fs.readFileSync(e2ePath, 'utf-8');

const ticket05Block = `
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
  await page.fill('#test-input', 'a\\n');
  await page.click('#run-button');
  await page.waitForFunction('window.__runDone === true', null, { timeout: 15000 });
  const verdictPlus = await page.textContent('#verdict');
  console.log('Verdict for a+ on "a" / "":', verdictPlus);
  assert(verdictPlus.includes('ACCEPT'), 'a+ must accept "a"');
  assert(verdictPlus.includes('REJECT'), 'a+ must reject ""');

`;

const target = `  assert.strictEqual(errors.length, 0, \`Page errors encountered: \${errors.join(', ')}\`);`;
if (!content.includes(target)) {
  console.error('Target string not found in e2e.cjs!');
  process.exit(1);
}

content = content.replace(target, ticket05Block + '  ' + target.trim());
fs.writeFileSync(e2ePath, content);
console.log('Patched e2e.cjs successfully');
