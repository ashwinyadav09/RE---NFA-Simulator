const { chromium } = require('playwright');
const path = require('node:path');
const assert = require('node:assert');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

  const logs = [];
  const consoleErrors = [];
  const consoleWarnings = [];
  const errors = [];
  page.on('console', (msg) => {
    const text = msg.text();
    const type = msg.type();
    logs.push(`${type}: ${text}`);
    if (type === 'error') {
      consoleErrors.push(text);
    } else if (type === 'warning') {
      consoleWarnings.push(text);
    }
  });
  page.on('pageerror', (err) => errors.push(err.message));

  const distHtmlPath = path.resolve(__dirname, '../dist/index.html');
  const fs = require('node:fs');
  const distHtml = fs.readFileSync(distHtmlPath, 'utf-8');
  // Pattern check for assignments to window, globalThis, or self in dist
  const assignRegex = /\b(window|globalThis|self)(?:\.([a-zA-Z_$][a-zA-Z0-9_$]*)|\[\s*['"]([^'"]+)['"]\s*\])\s*=(?!=)/g;
  let m;
  const assignments = [];
  while ((m = assignRegex.exec(distHtml)) !== null) {
    const target = m[1];
    const prop = m[2] || m[3];
    assignments.push({ full: m[0], target, prop });
  }
  const ALLOWLIST = new Set([
    'window.VizRenderer',
    'self.onmessage'
  ]);
  for (const a of assignments) {
    const key = `${a.target}.${a.prop}`;
    assert(
      ALLOWLIST.has(key),
      `dist/index.html contains forbidden global assignment "${a.full}" (${key})`
    );
  }

  // Second belt-and-braces check: legacy hook names, __force, __e2e, and __liveMutations
  assert(!distHtml.includes('__force'), 'dist/index.html must not contain __force test hooks');
  const FORBIDDEN_HOOKS = [
    '__ready',
    '__workerResult',
    '__workerError',
    '__masterPositions',
    '__testRenderDelay',
    '__testForcePinnedRenderFailure',
    '__buildDone',
    '__testForceLayoutFailure',
    '__runDone',
    '__suiteDone',
    '__suiteResults',
    '__diffDone',
    '__diffResult',
    '__stressDone',
    '__stressRowAdded',
    '__stressPoints',
    '__e2e',
    '__liveMutations'
  ];
  for (const hook of FORBIDDEN_HOOKS) {
    assert(!distHtml.includes(hook), `dist/index.html must not contain test hook "${hook}"`);
  }

  const harnessInitScript = () => {
    // 1. Worker instrumentation for ping/pong test and fault injection
    const origWorker = window.Worker;
    window.Worker = function(...args) {
      const w = new origWorker(...args);
      w.addEventListener('message', (e) => {
        if (e.data && 'pong' in e.data) {
          window.__workerResult = e.data;
        }
      });
      return w;
    };
    window.Worker.prototype = origWorker.prototype;

    window.__heldWorkerMessages = [];
    window.__releaseHeldWorkerMessages = function() {
      const list = window.__heldWorkerMessages || [];
      window.__heldWorkerMessages = [];
      for (const item of list) {
        origPostMessage.call(item.worker, item.msg);
      }
    };

    const origPostMessage = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(msg) {
      if (msg && msg.type === 'test-regexp') {
        if (window.__e2eWorkerMode === 'hold') {
          window.__heldWorkerMessages.push({
            worker: this,
            msg: msg
          });
          return;
        }
        if (window.__e2eWorkerMode === 'timeout') {
          // Drop message to trigger 2s timeout
          return;
        }
        if (window.__e2eWorkerMode === 'error') {
          setTimeout(() => {
            this.dispatchEvent(new MessageEvent('message', {
              data: { type: 'regexp-result', id: msg.id, error: 'Simulated worker crash error' }
            }));
          }, 10);
          return;
        }
        if (window.__e2eWorkerDelay) {
          setTimeout(() => {
            origPostMessage.call(this, msg);
          }, window.__e2eWorkerDelay);
          return;
        }
      }
      return origPostMessage.call(this, msg);
    };

    // 2. Set __ready when DOM scripts are done
    window.__ready = false;
    window.__harnessRenderCalls = [];
    window.__lastRenderedDot = null;
    window.__testForceLayoutFailure = false;
    window.__testForcePinnedRenderFailure = false;
    window.__testRenderDelay = null;
    const checkReady = () => {
      const presetSelect = document.getElementById('preset-select');
      if (presetSelect && presetSelect.options.length > 0) {
        window.__ready = true;
      } else {
        setTimeout(checkReady, 5);
      }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', checkReady);
    } else {
      checkReady();
    }

    // 3. VizRenderer overrides (layout failure, pinned failure, render delay)
    let _vizRenderer = undefined;
    Object.defineProperty(window, 'VizRenderer', {
      get() {
        return _vizRenderer;
      },
      set(val) {
        _vizRenderer = val;
        if (val && val.prototype && !val.prototype.__patched) {
          val.prototype.__patched = true;
          const origRender = val.prototype.render;
          val.prototype.render = async function(dot, options) {
            window.__harnessRenderCalls.push({
              format: options && options.format,
              engine: options && options.engine
            });
            if (!options || options.format !== 'json') {
              window.__lastRenderedDot = dot;
            }
            if (window.__testForceLayoutFailure && options && options.format === 'json') {
              return { ok: false, error: 'Forced test failure' };
            }
            if (window.__testForcePinnedRenderFailure && options && options.engine === 'neato') {
              return { ok: false, error: 'Forced pinned failure' };
            }
            if (window.__testRenderDelay && window.__testRenderDelay[2] && dot.includes('box_0_1')) {
              await new Promise((r) => setTimeout(r, window.__testRenderDelay[2] || 250));
            } else if (typeof window.__testRenderDelay === 'number') {
              await new Promise((r) => setTimeout(r, window.__testRenderDelay));
            } else if (window.__testRenderDelay && !dot.includes('n0 -> n1') && !dot.includes('box_0_1')) {
              await new Promise((r) => setTimeout(r, 250));
            }
            return origRender.call(this, dot, options);
          };
        }
      },
      configurable: true
    });

    // 4. Wrap action listeners for state hooks
    let inFlightBuilds = 0;
    const origAEL = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function(type, listener, options) {
      const target = this;
      const id = target && target.id;
      if (
        (id === 'build-button' && type === 'click') ||
        (id === 'notation-select' && type === 'change') ||
        (id === 'concat-select' && type === 'change')
      ) {
        const wrapped = async function(...args) {
          inFlightBuilds++;
          window.__buildDone = false;
          try {
            return await listener.apply(this, args);
          } finally {
            inFlightBuilds--;
            if (inFlightBuilds <= 0) {
              inFlightBuilds = 0;
              window.__buildDone = true;
            }
          }
        };
        return origAEL.call(this, type, wrapped, options);
      }
      if (id === 'preset-select' && type === 'change') {
        const wrapped = async function(...args) {
          inFlightBuilds++;
          window.__buildDone = false;
          try {
            await listener.apply(this, args);
            await new Promise((resolve) => {
              const checkDone = () => {
                const counter = document.getElementById('step-counter')?.textContent || '';
                const err = document.getElementById('error-message')?.textContent || '';
                const canvasText = document.getElementById('canvas')?.textContent || '';
                if (counter.includes('step 1 /') || counter.includes('Final NFA') || (err.length > 0 && !err.includes('Enter a regular expression')) || canvasText.includes('Diagram is disabled')) {
                  resolve();
                } else {
                  setTimeout(checkDone, 20);
                }
              };
              setTimeout(checkDone, 50);
            });
          } finally {
            inFlightBuilds--;
            if (inFlightBuilds <= 0) {
              inFlightBuilds = 0;
              window.__buildDone = true;
            }
          }
        };
        return origAEL.call(this, type, wrapped, options);
      }
      if (id === 'regex-input' && type === 'keydown') {
        const wrapped = async function(e) {
          if (e && e.key === 'Enter') {
            window.__buildDone = false;
          }
          try {
            return await listener.apply(this, [e]);
          } finally {
            if (e && e.key === 'Enter') {
              window.__buildDone = true;
            }
          }
        };
        return origAEL.call(this, type, wrapped, options);
      }
      if (id === 'run-button' && type === 'click') {
        const wrapped = async function(...args) {
          window.__runDone = false;
          try {
            return await listener.apply(this, args);
          } finally {
            window.__runDone = true;
          }
        };
        return origAEL.call(this, type, wrapped, options);
      }
      if (id === 'run-suite' && type === 'click') {
        const wrapped = async function(...args) {
          window.__suiteDone = false;
          try {
            const res = await listener.apply(this, args);
            const rows = document.querySelectorAll('#suite-table tbody tr');
            window.__suiteResults = Array.from(rows).map((r) => {
              const verdictCell = r.querySelector('td:last-child');
              return {
                passed: verdictCell ? verdictCell.textContent.trim() === 'PASS' : false
              };
            });
            return res;
          } finally {
            window.__suiteDone = true;
          }
        };
        return origAEL.call(this, type, wrapped, options);
      }
      if (id === 'diff-run' && type === 'click') {
        const wrapped = async function(...args) {
          window.__diffDone = false;
          try {
            return await listener.apply(this, args);
          } finally {
            const statusText = document.getElementById('diff-status')?.textContent || '';
            const allPassed = statusText.includes('ALL PASSED') && !statusText.includes('ORACLE ERROR') && !statusText.includes('MISMATCH');

            const enumBadge = document.querySelector('.diff-oracle-row[data-oracle="enumerator"] .badge');
            const enumStatus = enumBadge ? enumBadge.textContent.trim().toLowerCase() : (allPassed ? 'pass' : 'fail');

            const derivBadge = document.querySelector('.diff-oracle-row[data-oracle="derivatives"] .badge');
            const derivStatus = derivBadge ? derivBadge.textContent.trim().toLowerCase() : (allPassed ? 'pass' : 'fail');

            const regExpBadge = document.querySelector('.diff-oracle-row[data-oracle="regExp"] .badge');
            let regExpStatus = regExpBadge ? regExpBadge.textContent.trim().toLowerCase() : 'pass';
            if (statusText.includes('ORACLE ERROR')) {
              regExpStatus = 'error';
            } else if (statusText.includes('skipped: timeout') || regExpStatus.includes('timeout')) {
              regExpStatus = 'skipped (timeout)';
            }

            const mismatchesEl = document.querySelector('.diff-mismatches-summary code');
            const mismatches = mismatchesEl ? (mismatchesEl.textContent || '').split(',').map((s) => s.trim()).filter(Boolean) : [];

            window.__diffResult = {
              allPassed,
              mismatches,
              oracles: {
                enumerator: { status: enumStatus },
                derivatives: { status: derivStatus },
                regExp: { status: regExpStatus }
              }
            };
            window.__diffDone = true;
          }
        };
        return origAEL.call(this, type, wrapped, options);
      }
      if (id === 'stress-run' && type === 'click') {
        const wrapped = async function(...args) {
          window.__stressDone = false;
          window.__stressRowAdded = false;
          try {
            return await listener.apply(this, args);
          } finally {
            window.__stressDone = true;
          }
        };
        return origAEL.call(this, type, wrapped, options);
      }
      if (id === 'stress-cancel' && type === 'click') {
        const wrapped = async function(...args) {
          try {
            return await listener.apply(this, args);
          } finally {
            window.__stressDone = true;
          }
        };
        return origAEL.call(this, type, wrapped, options);
      }
      return origAEL.call(this, type, listener, options);
    };

    // 5. Stress table row observer for __stressRowAdded
    window.__stressRowAdded = false;
    const setupStressObserver = () => {
      const target = document.body || document.documentElement || document;
      const obs = new MutationObserver(() => {
        const rows = document.querySelectorAll('#stress-table tbody tr');
        if (rows.length > 0) {
          window.__stressRowAdded = true;
        }
      });
      obs.observe(target, { childList: true, subtree: true });
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', setupStressObserver);
    } else {
      setupStressObserver();
    }
  };

  await page.addInitScript(harnessInitScript);

  async function createHarnessPage(targetBrowser) {
    const freshPage = await targetBrowser.newPage();
    await freshPage.addInitScript(harnessInitScript);
    return freshPage;
  }

  const fileUrl = 'file:///' + distHtmlPath.replace(/\\/g, '/');

  console.log(`Opening ${fileUrl}...`);
  await page.goto(fileUrl);

  // 1. Check page readiness
  await page.waitForFunction('window.__ready === true', null, { timeout: 15000 });
  assert.strictEqual(await page.$eval('#export-dot-btn', (el) => el.disabled), true, '#export-dot-btn must initially be disabled');
  assert.strictEqual(await page.$eval('#export-svg-btn', (el) => el.disabled), true, '#export-svg-btn must initially be disabled');

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

  // 9. Check stepper controls and initial step 1 state
  const stepCounterText = await page.textContent('#step-counter');
  console.log('Initial step counter:', stepCounterText);
  assert(stepCounterText.includes('step 1 / 6'), 'Stepper must start at step 1 / 6');

  // Check step log
  const stepLogItems = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#step-log .step-log-item')).map((el) => el.textContent)
  );
  console.log('Step log item count:', stepLogItems.length);
  assert.strictEqual(stepLogItems.length, 6, 'Step log must list all 6 steps');
  assert(
    stepLogItems[2].includes('union of fragments 0→1 and 2→3'),
    'Step 3 in step log must describe union of fragments 0→1 and 2→3'
  );

  // Initial step 1 canvas has fragment 0->1
  const initialNodes = await page.evaluate(() => document.querySelectorAll('#canvas svg g.node').length);
  console.log('Step 1 canvas nodes:', initialNodes);
  assert(initialNodes >= 2, 'Step 1 must have at least 2 state nodes');

  // Step through (a|b)*a to step 6 / 6
  for (let s = 2; s <= 6; s++) {
    await page.click('#step-next');
    await page.waitForFunction(
      (expected) => document.querySelector('#step-counter')?.textContent.includes(`step ${expected} / 6`),
      s,
      { timeout: 5000 }
    );
  }

  const finalStepCounter = await page.textContent('#step-counter');
  console.log('Final step counter:', finalStepCounter);
  assert(finalStepCounter.includes('step 6 / 6'), 'Stepper must reach step 6 / 6');

  // 10. Check #canvas contains rendered SVG with nodes and edges at step 6 / 6
  const hasSvg = await page.evaluate(() => !!document.querySelector('#canvas svg'));
  assert(hasSvg, 'Canvas must contain rendered SVG');

  const nodeCount = await page.evaluate(() => document.querySelectorAll('#canvas svg g.node').length);
  const edgeCount = await page.evaluate(() => document.querySelectorAll('#canvas svg g.edge').length);
  console.log(`Rendered SVG at step 6 / 6: ${nodeCount} nodes, ${edgeCount} edges`);
  // Graphviz renders 10 NFA state nodes + 1 start pseudo-node = 11 nodes
  assert(nodeCount >= 10, 'SVG must contain at least 10 state nodes at step 6');
  // 12 NFA transitions + 1 start arrow = 13 edges
  assert(edgeCount >= 12, 'SVG must contain at least 12 edges at step 6');

  // 11. Test stepper navigation controls (Prev, First, Last, Arrow keys)
  await page.click('#step-prev');
  await page.waitForFunction(() => document.querySelector('#step-counter')?.textContent.includes('step 5 / 6'));

  await page.click('#step-first');
  await page.waitForFunction(() => document.querySelector('#step-counter')?.textContent.includes('step 1 / 6'));

  await page.click('#step-last');
  await page.waitForFunction(() => document.querySelector('#step-counter')?.textContent.includes('step 6 / 6'));

  // Arrow keys
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => document.querySelector('#step-counter')?.textContent.includes('step 5 / 6'));

  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('#step-counter')?.textContent.includes('step 6 / 6'));

  // Play / Pause with speed
  await page.selectOption('#step-speed', '300');
  await page.click('#step-first');
  await page.waitForFunction(() => document.querySelector('#step-counter')?.textContent.includes('step 1 / 6'));
  await page.click('#step-play');
  const playText = await page.textContent('#step-play');
  assert.strictEqual(playText, 'Pause', 'Play button text must become Pause while playing');
  await new Promise((r) => setTimeout(r, 700));
  await page.click('#step-play');
  const pauseText = await page.textContent('#step-play');
  assert.strictEqual(pauseText, 'Play', 'Play button text must become Play after pause');

  // FIX 1 TEST: Stop playback on new build or settings change
  // Case 1: Build (a|b)*a, click #step-play, assert Pause.
  await page.fill('#regex-input', '(a|b)*a');
  await page.click('#build-button');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });
  await page.selectOption('#step-speed', '300');
  await page.click('#step-play');
  const playButtonTextWhilePlaying = await page.textContent('#step-play');
  assert.strictEqual(playButtonTextWhilePlaying, 'Pause', 'Play button must read Pause while running');

  // While playing, build 'a'
  await page.evaluate(() => { window.__buildDone = false; });
  await page.fill('#regex-input', 'a');
  await page.click('#build-button');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });

  // Wait longer than one playback interval (e.g. 500ms > 300ms)
  await new Promise((resolve) => setTimeout(resolve, 500));

  const playButtonTextAfterNewBuild = await page.textContent('#step-play');
  assert.strictEqual(playButtonTextAfterNewBuild, 'Play', '#step-play must read Play after new build stops playback');
  const counterAfterNewBuild = await page.textContent('#step-counter');
  assert.strictEqual(counterAfterNewBuild, 'step 1 / 1', '#step-counter must read "step 1 / 1" and not advance');

  // Case 2: Start playback, switch concatenation to merge, assert playback stopped
  await page.fill('#regex-input', '(a|b)*a');
  await page.click('#build-button');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });
  await page.click('#step-play');
  const playButtonTextWhilePlaying2 = await page.textContent('#step-play');
  assert.strictEqual(playButtonTextWhilePlaying2, 'Pause', 'Play button must read Pause while running before concat switch');

  // Switch concatenation to merge (which triggers change -> handleBuild)
  await page.evaluate(() => { window.__buildDone = false; });
  await page.selectOption('#concat-select', 'merge');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });

  await new Promise((resolve) => setTimeout(resolve, 500));

  const playButtonTextAfterConcatSwitch = await page.textContent('#step-play');
  assert.strictEqual(playButtonTextAfterConcatSwitch, 'Play', '#step-play must read Play after concatenation switch stops playback');

  // Restore concat to epsilon-link and rebuild (a|b)*a for subsequent tests
  await page.selectOption('#concat-select', 'epsilon-link');
  await page.evaluate(() => { window.__buildDone = false; });
  await page.fill('#regex-input', '(a|b)*a');
  await page.click('#build-button');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });


  // Clicking postfix token jumps to step
  await page.click('#postfix-view .postfix-token[data-step-index="3"]');
  await page.waitForFunction(() => document.querySelector('#step-counter')?.textContent.includes('step 3 / 6'));
  const activeTokenText = await page.textContent('#postfix-view .postfix-token.active');
  assert.strictEqual(activeTokenText, 'UNION', 'Active postfix token must be UNION');

  // Hovering a state shows creator step
  const state4Title = await page.evaluate(() => {
    const node = document.querySelector('#canvas svg g[id="n4"]');
    return node ? (node.getAttribute('title') || node.querySelector('title')?.textContent || '') : '';
  });
  console.log('State 4 hover title:', state4Title);
  assert.strictEqual(
    state4Title,
    'Created by step 3: union',
    'State 4 hover text must equal "Created by step 3: union"'
  );

  // Jump to step 6 / 6 for simulation
  await page.click('#step-last');
  await page.waitForFunction(() => document.querySelector('#step-counter')?.textContent.includes('step 6 / 6'));

  // 12. Simulation test: enter 'ba', click #run-button, verify ACCEPT and the two sets
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

  // Verify diagram and stats are cleared after error
  const statsAfterError = await page.textContent('#stats');
  assert.strictEqual(statsAfterError, '', 'Stats must be cleared after error');
  const hasSvgAfterError = await page.evaluate(() => !!document.querySelector('#canvas svg'));
  assert.strictEqual(hasSvgAfterError, false, 'Canvas SVG must be cleared after error');

  // 13. Empty input hint test directly after error: build '(a|)' -> attribute is '2'. Clear the input and build -> attribute is absent, hint is shown, diagram/stats are cleared.
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
  assert.strictEqual(statsAfterEmpty, '', 'Stats must be cleared on empty input');

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

  // 19. Ticket 06: Concat-select merge mode rebuilds automatically
  await page.evaluate(() => { window.__buildDone = false; });
  await page.fill('#regex-input', '(a|b)*a');
  await page.selectOption('#notation-select', 'standard');
  await page.selectOption('#concat-select', 'merge');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });

  const statsMerge = await page.textContent('#stats');
  console.log('Stats for (a|b)*a in merge mode:', statsMerge);
  assert(statsMerge.includes('States: 9'), 'Merge mode (a|b)*a must have 9 states');
  assert(statsMerge.includes('Transitions: 11'), 'Merge mode (a|b)*a must have 11 transitions');

  // Build (a|b)*abb in merge mode
  await page.evaluate(() => { window.__buildDone = false; });
  await page.fill('#regex-input', '(a|b)*abb');
  await page.click('#build-button');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });

  const statsAbbMerge = await page.textContent('#stats');
  console.log('Stats for (a|b)*abb in merge mode:', statsAbbMerge);
  assert(statsAbbMerge.includes('States: 11'), 'Merge mode (a|b)*abb must have 11 states');
  assert(statsAbbMerge.includes('Transitions: 13'), 'Merge mode (a|b)*abb must have 13 transitions');

  // 20. Ticket 06: Textbook notation
  // Switch notation-select to textbook, concat-select to epsilon-link
  await page.evaluate(() => { window.__buildDone = false; });
  await page.selectOption('#concat-select', 'epsilon-link');
  await page.selectOption('#notation-select', 'textbook');
  await page.fill('#regex-input', '(a+b)*a');
  await page.click('#build-button');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });

  const statsTextbook = await page.textContent('#stats');
  console.log('Stats for (a+b)*a in textbook mode:', statsTextbook);
  assert(statsTextbook.includes('States: 10'), 'Textbook (a+b)*a must have 10 states');
  assert(statsTextbook.includes('Transitions: 12'), 'Textbook (a+b)*a must have 12 transitions');

  // Type 'a|b' in textbook mode -> NOT_AN_OPERATOR
  await page.evaluate(() => { window.__buildDone = false; });
  await page.fill('#regex-input', 'a|b');
  await page.click('#build-button');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });

  const errorTextbook = await page.textContent('#error-message');
  console.log('Error message for a|b in textbook mode:', errorTextbook);
  assert(errorTextbook.includes('not an operator') || errorTextbook.includes('NOT_AN_OPERATOR'), 'Must report not an operator');
  const textbookErrorCode = await page.getAttribute('#error-message', 'data-error-code');
  assert.strictEqual(textbookErrorCode, 'NOT_AN_OPERATOR', 'data-error-code must be NOT_AN_OPERATOR');

  // 21. Ticket 06: Buttons insert ε and ∅ at cursor
  await page.fill('#regex-input', '');
  await page.click('#insert-eps');
  let inputVal = await page.inputValue('#regex-input');
  assert.strictEqual(inputVal, 'ε', 'Insert ε button must insert ε');

  await page.click('#insert-empty');
  inputVal = await page.inputValue('#regex-input');
  assert.strictEqual(inputVal, 'ε∅', 'Insert ∅ button must insert ∅');

  // 22. Ticket 06: Alphabet editing and symbol removal protection
  await page.selectOption('#notation-select', 'standard');
  await page.evaluate(() => { window.__buildDone = false; });
  await page.fill('#regex-input', '(a|b)*a');
  await page.click('#build-button');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });

  const inferredAlpha = await page.inputValue('#alphabet-input');
  console.log('Inferred alphabet value:', inferredAlpha);
  assert(inferredAlpha.includes('a') && inferredAlpha.includes('b'), 'Alphabet must contain a and b');

  // Add symbol 'c' to alphabet: 'a, b, c'
  await page.fill('#alphabet-input', 'a, b, c');
  await page.dispatchEvent('#alphabet-input', 'change');

  // Run 'c', verify dead run (not out of alphabet)
  await page.evaluate(() => { window.__runDone = false; });
  await page.fill('#test-input', 'c');
  await page.click('#run-button');
  await page.waitForFunction('window.__runDone === true', null, { timeout: 15000 });

  const traceWithC = await page.textContent('#trace');
  console.log('Trace for added symbol c:', traceWithC);
  assert(traceWithC.includes('Dead at position 0'), 'Unused alphabet symbol c must cause dead run');
  assert(!traceWithC.includes('outside alphabet'), 'Symbol c is in alphabet so must not report outside alphabet');

  // Attempt to remove symbol 'a' by setting alphabet to 'b, c'
  await page.fill('#alphabet-input', 'b, c');
  await page.dispatchEvent('#alphabet-input', 'change');

  const alphaMsg = await page.textContent('#alphabet-message');
  console.log('Alphabet removal message:', alphaMsg);
  assert(alphaMsg.includes("Cannot remove symbol 'a'"), 'Must refuse removal of used symbol a');

  const restoredAlpha = await page.inputValue('#alphabet-input');
  assert(restoredAlpha.includes('a'), 'Alphabet input must retain used symbol a');

  // 21. Verify clearing on build failure:
  // (a) build "a", then "(a|" -> Run "a" must not show ACCEPT
  await page.selectOption('#notation-select', 'standard');
  await page.evaluate(() => { window.__buildDone = false; });
  await page.fill('#regex-input', 'a');
  await page.click('#build-button');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });

  await page.evaluate(() => { window.__buildDone = false; });
  await page.fill('#regex-input', '(a|');
  await page.click('#build-button');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });

  await page.evaluate(() => { window.__runDone = false; });
  await page.fill('#test-input', 'a');
  await page.click('#run-button');
  await page.waitForFunction('window.__runDone === true', null, { timeout: 15000 });
  const verdictAfterSyntaxError = await page.textContent('#verdict');
  assert(!verdictAfterSyntaxError.includes('ACCEPT'), 'Run "a" must not show ACCEPT after syntax error');
  assert.strictEqual(verdictAfterSyntaxError, '', 'Verdict must be empty when no NFA exists');

  // (b) build "(a|b)*a", switch to textbook -> Run "ba" must not show ACCEPT
  await page.selectOption('#notation-select', 'standard');
  await page.evaluate(() => { window.__buildDone = false; });
  await page.fill('#regex-input', '(a|b)*a');
  await page.click('#build-button');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });

  await page.evaluate(() => { window.__buildDone = false; });
  await page.selectOption('#notation-select', 'textbook');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });

  await page.evaluate(() => { window.__runDone = false; });
  await page.fill('#test-input', 'ba');
  await page.click('#run-button');
  await page.waitForFunction('window.__runDone === true', null, { timeout: 15000 });
  const verdictAfterTextbookSwitch = await page.textContent('#verdict');
  assert(!verdictAfterTextbookSwitch.includes('ACCEPT'), 'Run "ba" must not show ACCEPT after switching to textbook with "|"');
  assert.strictEqual(verdictAfterTextbookSwitch, '', 'Verdict must be empty when no NFA exists');

  // 22. Stale-render guard race test:
  // Inside ONE page.evaluate (same task), set #regex-input to "a" and click #build-button,
  // then set it to "(a|" and click #build-button. Wait for in-flight render to settle (~500 ms),
  // then assert #canvas contains no svg and #verdict is empty.
  await page.selectOption('#notation-select', 'standard');
  await page.evaluate(() => {
    const input = document.getElementById('regex-input');
    const btn = document.getElementById('build-button');
    input.value = 'a';
    btn.click();
    input.value = '(a|';
    btn.click();
  });

  // Wait for the in-flight render to settle
  await new Promise((resolve) => setTimeout(resolve, 500));

  const hasSvgAfterRace = await page.evaluate(() => document.querySelector('#canvas svg') !== null);
  assert.strictEqual(hasSvgAfterRace, false, '#canvas must contain no svg after failed build preempts in-flight render');

  const verdictAfterRace = await page.textContent('#verdict');
  assert.strictEqual(verdictAfterRace, '', '#verdict must be empty');

  // 23. Merge mode stepper test:
  // Build "(a|b)*a" in merge mode, jump to step 6, assert step log shows both states and what they became,
  // and state 8 is absent from canvas while state 7 is present.
  await page.selectOption('#concat-select', 'merge');
  await page.evaluate(() => { window.__buildDone = false; });
  await page.fill('#regex-input', '(a|b)*a');
  await page.click('#build-button');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });

  await page.click('#step-last');
  await page.waitForFunction(() => document.querySelector('#step-counter')?.textContent.includes('step 6 / 6'));

  const mergeStep6Text = await page.evaluate(() => {
    const item = document.querySelector('#step-log .step-log-item[data-step-index="6"]');
    return item ? item.textContent : '';
  });
  console.log('Merge step 6 text:', mergeStep6Text);
  assert(
    mergeStep6Text.includes('merged states 7 and 8 into 7'),
    'Merge step 6 must state "merged states 7 and 8 into 7"'
  );

  const hasNode8 = await page.evaluate(() => document.querySelector('#canvas svg g[id="n8"]') !== null);
  assert.strictEqual(hasNode8, false, 'State 8 must be removed in merge mode step 6');
  const hasNode7 = await page.evaluate(() => document.querySelector('#canvas svg g[id="n7"]') !== null);
  assert.strictEqual(hasNode7, true, 'State 7 must be present in merge mode step 6');

  // 24. clearResults() test: failed build must reset stepper controls, step log, and canvas
  await page.evaluate(() => { window.__buildDone = false; });
  await page.fill('#regex-input', '(a|');
  await page.click('#build-button');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });

  const counterAfterFail = await page.textContent('#step-counter');
  assert.strictEqual(counterAfterFail, 'step 0 / 0', 'Step counter must be "step 0 / 0" after failed build');

  const stepLogAfterFail = await page.evaluate(() => document.getElementById('step-log')?.children.length || 0);
  assert.strictEqual(stepLogAfterFail, 0, 'Step log must be empty after failed build');

  const canvasSvgAfterFail = await page.evaluate(() => document.querySelector('#canvas svg') !== null);
  assert.strictEqual(canvasSvgAfterFail, false, 'Canvas SVG must be cleared after failed build');

  const areButtonsDisabled = await page.evaluate(() => {
    const prev = document.getElementById('step-prev');
    const next = document.getElementById('step-next');
    const play = document.getElementById('step-play');
    return prev.disabled && next.disabled && play.disabled;
  });
  assert.strictEqual(areButtonsDisabled, true, 'Stepper buttons must be disabled after failed build');

  // 25. Deterministic stepGeneration race test:
  // Rebuild "(a|b)*a". Set render delay for step 1 to 200ms.
  // Navigate to step 1 then immediately step 2 in single task.
  // Step 2 renders immediately, step 1 finishes later.
  // The guard must prevent step 1 from overwriting step 2 in #canvas.
  await page.selectOption('#concat-select', 'epsilon-link');
  await page.evaluate(() => { window.__buildDone = false; });
  await page.fill('#regex-input', '(a|b)*a');
  await page.click('#build-button');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });

  // Ensure on step 3 first so both step 1 and step 2 navigation are active
  await page.click('#step-next');
  await page.click('#step-next');
  await page.waitForFunction(() => document.querySelector('#step-counter')?.textContent.includes('step 3 / 6'));

  await page.evaluate(() => {
    window.__testRenderDelay = { 1: 200, 2: 0 };
  });

  // Navigate to step 1 (delayed) then immediately step 2 (immediate) in the same tick
  await page.evaluate(() => {
    const tok1 = document.querySelector('#postfix-view .postfix-token[data-step-index="1"]');
    const tok2 = document.querySelector('#postfix-view .postfix-token[data-step-index="2"]');
    tok1.click(); // step 1 (in-flight with 200ms delay)
    tok2.click(); // step 2 (immediate)
  });

  // Wait 400ms for both renders to settle
  await new Promise((resolve) => setTimeout(resolve, 400));

  const currentStepAttr = await page.evaluate(() => document.getElementById('canvas')?.getAttribute('data-current-step'));
  console.log('Current step on canvas after race:', currentStepAttr);
  assert.strictEqual(currentStepAttr, '2', 'Canvas must remain on step 2 after out-of-order step 1 completes');

  const hasNode2AfterRace = await page.evaluate(() => document.querySelector('#canvas svg g[id="n2"]') !== null);
  assert.strictEqual(hasNode2AfterRace, true, 'Canvas must contain state 2 from step 2 after out-of-order step 1 completes');

  // Clear test delay hook
  await page.evaluate(() => { window.__testRenderDelay = null; });

  // 26. Stable layout across steps: existing states stay where they are
  console.log('Testing stable layout across steps...');
  await page.selectOption('#concat-select', 'epsilon-link');
  // 26. Absolute on-screen position stability of #n0 across steps 1-6 in epsilon-link mode
  console.log('Testing absolute position stability of n0 across steps in epsilon-link mode...');
  await page.selectOption('#concat-select', 'epsilon-link');
  await page.evaluate(() => { window.__buildDone = false; });
  await page.fill('#regex-input', '(a|b)*a');
  await page.click('#build-button');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });

  const getNodeCenter = async (selector) => {
    const box = await page.locator(selector).boundingBox();
    assert(box !== null, `${selector} must have a boundingBox`);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };

  const center0_step1 = await getNodeCenter('g#n0');
  console.log('Step 1 g#n0 center:', center0_step1);

  // Step through steps 2 to 6, verifying absolute center position of #n0 is within 0.5px
  for (let s = 2; s <= 6; s++) {
    await page.click('#step-next');
    await page.waitForFunction(
      (expected) => document.querySelector('#step-counter')?.textContent.includes(`step ${expected} / 6`),
      s,
      { timeout: 5000 }
    );
    const center0_stepS = await getNodeCenter('g#n0');
    const dx = Math.abs(center0_stepS.x - center0_step1.x);
    const dy = Math.abs(center0_stepS.y - center0_step1.y);
    console.log(`Step ${s} g#n0 center drift: dx=${dx.toFixed(3)}, dy=${dy.toFixed(3)}`);
    assert(dx <= 0.5, `g#n0 center x-position drift at step ${s} must be <= 0.5px (was ${dx})`);
    assert(dy <= 0.5, `g#n0 center y-position drift at step ${s} must be <= 0.5px (was ${dy})`);
  }

  // 27. Test merge mode: absolute position stability of #n0 and surviving merged state #n7
  console.log('Testing merge mode absolute stability of n0 and surviving state n7...');
  await page.selectOption('#concat-select', 'merge');
  await page.evaluate(() => { window.__buildDone = false; });
  await page.click('#build-button');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });

  const center0_merge1 = await getNodeCenter('g#n0');

  let center7_merge4 = null;
  for (let s = 2; s <= 6; s++) {
    await page.click('#step-next');
    await page.waitForFunction(
      (expected) => document.querySelector('#step-counter')?.textContent.includes(`step ${expected} / 6`),
      s,
      { timeout: 5000 }
    );
    const center0_mergeS = await getNodeCenter('g#n0');
    const dx = Math.abs(center0_mergeS.x - center0_merge1.x);
    const dy = Math.abs(center0_mergeS.y - center0_merge1.y);
    assert(dx <= 0.5, `g#n0 center x-drift at step ${s} in merge mode must be <= 0.5px (was ${dx})`);
    assert(dy <= 0.5, `g#n0 center y-drift at step ${s} in merge mode must be <= 0.5px (was ${dy})`);

    if (s === 4) {
      center7_merge4 = await getNodeCenter('g#n7');
    } else if (s > 4) {
      const center7_mergeS = await getNodeCenter('g#n7');
      const d7x = Math.abs(center7_mergeS.x - center7_merge4.x);
      const d7y = Math.abs(center7_mergeS.y - center7_merge4.y);
      console.log(`Step ${s} g#n7 center drift from step 4: dx=${d7x.toFixed(3)}, dy=${d7y.toFixed(3)}`);
      assert(d7x <= 0.5, `Surviving state n7 center x-drift at step ${s} must be <= 0.5px (was ${d7x})`);
      assert(d7y <= 0.5, `Surviving state n7 center y-drift at step ${s} must be <= 0.5px (was ${d7y})`);
    }
  }

  // Verify removed state 8 is absent
  const hasNode8InMergeStep = await page.evaluate(() => document.querySelector('g#n8, g[id="n8"]') !== null);
  assert.strictEqual(hasNode8InMergeStep, false, 'Removed state 8 must not exist at step 6 in merge mode');

  // 28. Test layout fallback when layout fails
  console.log('Testing layout fallback note on failure...');
  await page.evaluate(() => {
    window.__testForceLayoutFailure = true;
    window.__buildDone = false;
  });
  await page.click('#build-button');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });

  const layoutNoteText = await page.textContent('#layout-note');
  console.log('Layout note text on failure:', layoutNoteText);
  assert(layoutNoteText && layoutNoteText.includes('falling back to unpinned layout'), 'Layout note must display fallback warning');

  const fallbackCanvasHasSvg = await page.evaluate(() => !!document.querySelector('#canvas svg'));
  assert.strictEqual(fallbackCanvasHasSvg, true, 'Canvas must render unpinned SVG rather than being blank');

  // Reset force failure hook
  await page.evaluate(() => {
    window.__testForceLayoutFailure = false;
  });

  // 29. navigateToStep cache invalidation test:
  // Step 1 is already in cache. Delay step 2 render.
  // Click next (step 2 delayed) then immediately prev (step 1 cache hit).
  // Wait past delay; canvas must still show step 1, not get overwritten by step 2.
  console.log('Testing cache invalidation race (step 1 cached, step 2 delayed)...');
  await page.evaluate(() => { window.__buildDone = false; });
  await page.fill('#regex-input', '(a|b)*a');
  await page.click('#build-button');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });

  // On build, step 1 is loaded and cached.
  await page.evaluate(() => {
    window.__testRenderDelay = { 2: 250 };
  });

  // Click next then immediately prev
  await page.click('#step-next');
  await page.click('#step-prev');

  // Wait 350ms for step 2's delayed render to settle
  await new Promise((resolve) => setTimeout(resolve, 350));

  const stepAfterCacheRace = await page.evaluate(() => document.getElementById('canvas')?.getAttribute('data-current-step'));
  console.log('Canvas step after cache hit race:', stepAfterCacheRace);
  assert.strictEqual(stepAfterCacheRace, '1', 'Canvas must remain on step 1 after in-flight step 2 finishes');

  await page.evaluate(() => { window.__testRenderDelay = null; });

  // 30. handleBuild race guard test:
  // Build (a|b)*abb, then immediately change input to "a" and build again in the same task.
  // The canvas must show only the nodes for "a" (start-node, n0, n1; no nodes from (a|b)*abb).
  console.log('Testing handleBuild race guard ((a|b)*abb then a)...');
  await page.evaluate(() => {
    window.__buildDone = false;
    const input = document.getElementById('regex-input');
    const btn = document.getElementById('build-button');
    input.value = '(a|b)*abb';
    btn.click();
    input.value = 'a';
    btn.click();
  });
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });
  await new Promise((resolve) => setTimeout(resolve, 300));

  const nodesAfterRace = await page.evaluate(() => {
    const nodeEls = Array.from(document.querySelectorAll('#canvas svg g.node'));
    return nodeEls.map((el) => el.id);
  });
  console.log('Canvas nodes after handleBuild race:', nodesAfterRace);
  assert(nodesAfterRace.includes('n0'), 'Canvas must contain n0 for "a"');
  assert(nodesAfterRace.includes('n1'), 'Canvas must contain n1 for "a"');
  assert.strictEqual(nodesAfterRace.length, 3, 'Canvas must contain only start-node, n0, and n1 for "a"');
  for (let i = 2; i <= 13; i++) {
    assert(!nodesAfterRace.includes(`n${i}`), `Canvas must not contain n${i} from (a|b)*abb`);
  }

  // 31. Per-step pinned render fallback & cache invalidation test:
  // Step 1 renders and caches pinned. Force pinned render failure on step 2.
  // Click next (step 2 fails pinned, falls back to unpinned, sets layoutFailed=true, clears stepSvgCache).
  // Click prev (returns to step 1). Assert step 1 now displays unpinned render (observable via viewBox).
  console.log('Testing per-step pinned fallback & cache invalidation...');
  await page.selectOption('#concat-select', 'epsilon-link');
  await page.evaluate(() => { window.__buildDone = false; });
  await page.fill('#regex-input', '(a|b)*a');
  await page.click('#build-button');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });

  // Record step 1's pinned SVG viewBox
  const pinnedStep1ViewBox = await page.evaluate(() => {
    return document.querySelector('#canvas svg')?.getAttribute('viewBox');
  });
  console.log('Pinned step 1 viewBox:', pinnedStep1ViewBox);
  assert(pinnedStep1ViewBox !== null, 'Step 1 must have a viewBox');

  // Arm forced pinned render failure for next navigation
  await page.evaluate(() => {
    window.__testForcePinnedRenderFailure = true;
  });

  // Navigate to step 2 (triggers fallback to unpinned)
  await page.click('#step-next');
  await page.waitForFunction(() => document.querySelector('#step-counter')?.textContent.includes('step 2 / 6'));

  const perStepNote = await page.textContent('#layout-note');
  console.log('Per-step layout note on failure:', perStepNote);
  assert(perStepNote && perStepNote.includes('Pinned layout render failed'), 'Layout note must display pinned render failure warning');

  // Turn off the forced failure hook
  await page.evaluate(() => {
    window.__testForcePinnedRenderFailure = false;
  });

  // Navigate back to step 1
  await page.click('#step-prev');
  await page.waitForFunction(() => document.querySelector('#step-counter')?.textContent.includes('step 1 / 6'));

  // Assert step 1 now shows unpinned render (its viewBox must differ from the pinned viewBox)
  const unpinnedStep1ViewBox = await page.evaluate(() => {
    return document.querySelector('#canvas svg')?.getAttribute('viewBox');
  });
  console.log('Step 1 viewBox after fallback:', unpinnedStep1ViewBox);
  assert(unpinnedStep1ViewBox !== null, 'Step 1 must have a viewBox after fallback');
  assert.notStrictEqual(
    unpinnedStep1ViewBox,
    pinnedStep1ViewBox,
    'Step 1 must now display unpinned render after cache invalidation'
  );

  // ---- Ticket 09: Textbook view and size caps ----
  console.log('Testing Ticket 09: View toggle, textbook view, and size caps...');

  // Reset to (a|b)*a
  await page.fill('#regex-input', '(a|b)*a');
  await page.click('#build-button');
  await page.waitForFunction(() => document.querySelector('#step-counter')?.textContent.includes('step 1 / 6'));

  // 1. view-toggle switches between flat and textbook
  await page.selectOption('#view-toggle', 'textbook');
  // Jump to step 4 (star step)
  await page.click('#step-next'); // step 2
  await page.click('#step-next'); // step 3
  await page.click('#step-next'); // step 4
  await page.waitForFunction(() => document.querySelector('#step-counter')?.textContent.includes('step 4 / 6'));

  // In textbook view, canvas SVG must have record box for (a|b)
  const hasTextbookBox = await page.evaluate(() => {
    const svgText = document.querySelector('#canvas svg')?.innerHTML || '';
    return svgText.includes('frag&#45;4&#45;5') || svgText.includes('frag-4-5') || svgText.includes('(a|b)');
  });
  assert(hasTextbookBox, 'Textbook view on step 4 must render collapsed fragment box for (a|b)');

  // Assert at least one frag-* box in the browser has a non-empty label
  const boxLabels = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('#canvas svg g.node'));
    const fragNodes = nodes.filter(n => (n.id && n.id.startsWith('frag')));
    return fragNodes.map(n => Array.from(n.querySelectorAll('text')).map(t => t.textContent.trim()).filter(Boolean).join(' ')).filter(Boolean);
  });
  console.log('Textbook box labels in step 4:', boxLabels);
  assert(boxLabels.length > 0 && boxLabels.some(l => l.length > 0), 'At least one frag-* box must have a non-empty label');

  // Switch back to flat view
  await page.selectOption('#view-toggle', 'flat');
  const hasFlatStateNodes = await page.evaluate(() => {
    return document.querySelectorAll('#canvas svg g.node').length >= 6;
  });
  assert(hasFlatStateNodes, 'Flat view must render individual state circle nodes');

  // Verify a <=150-token build made at least one master layout format==='json' call
  const jsonCallsPre = await page.evaluate(() => window.__harnessRenderCalls.filter(c => c.format === 'json').length);
  assert(jsonCallsPre > 0, `A <=150-token build must make at least one format===json call, got ${jsonCallsPre}`);
  await page.evaluate(() => { window.__harnessRenderCalls = []; });

  // 2. Build a 160-token expression:
  // '(a|b)' repeated 40 times followed by 'a' gives 161 postfix tokens
  const expr160 = '(a|b)'.repeat(40) + 'a';
  await page.fill('#regex-input', expr160);
  await page.click('#build-button');

  // Wait for build to complete
  await page.waitForFunction(() => {
    const counter = document.querySelector('#step-counter')?.textContent || '';
    return counter.includes('step 1 / 161');
  });

  // Verify textbook view offered, flat stepping disabled with message
  const viewToggleVal = await page.evaluate(() => document.querySelector('#view-toggle')?.value);
  assert.strictEqual(viewToggleVal, 'textbook', 'Textbook view must be active for 160+ tokens');

  const flatOptionDisabled = await page.evaluate(() => {
    const opt = document.querySelector('#view-toggle option[value="flat"]');
    return opt ? opt.disabled : false;
  });
  assert.strictEqual(flatOptionDisabled, true, 'Flat view option must be disabled for 160+ tokens');

  const capNote = await page.textContent('#layout-note');
  console.log('Cap note for 160+ tokens:', capNote);
  assert(capNote && capNote.includes('150'), 'Note must state flat stepping limit of 150');

  // Check SVG is rendered
  const has160Svg = await page.evaluate(() => !!document.querySelector('#canvas svg'));
  assert(has160Svg, 'Canvas must render textbook SVG for 160+ tokens');

  // Confirm master layout stays skipped above 150
  const jsonCalls160 = await page.evaluate(() => window.__harnessRenderCalls.filter(c => c.format === 'json').length);
  assert.strictEqual(jsonCalls160, 0, `A 160-token build must make zero format===json calls, got ${jsonCalls160}`);

  // Transition table works
  const tableRows160 = await page.evaluate(() => document.querySelectorAll('#transition-table tbody tr').length);
  assert(tableRows160 > 0, 'Transition table must be populated for 160+ tokens');

  // Simulation still works
  await page.evaluate(() => { window.__runDone = false; });
  await page.fill('#test-input', 'a'.repeat(41));
  await page.click('#run-button');
  await page.waitForFunction('window.__runDone === true', null, { timeout: 15000 });
  const verdict160 = await page.textContent('#verdict');
  assert(verdict160 && (verdict160.includes('ACCEPT') || verdict160.includes('REJECT')), 'Simulation must return verdict');

  // Cap note in #layout-note survives the Run
  const capNoteAfterRun160 = await page.textContent('#layout-note');
  assert(capNoteAfterRun160 && capNoteAfterRun160.includes('150'), '150 cap note in #layout-note must survive Run');

  // 2b. Round-trip: build 161 tokens, then build (b|a)*b
  await page.fill('#regex-input', '(b|a)*b');
  await page.click('#build-button');
  await page.waitForFunction(() => document.querySelector('#step-counter')?.textContent.includes('step 1 / 6'));

  // Assert flat option is enabled again
  const flatOptionReEnabled = await page.evaluate(() => {
    const opt = document.querySelector('#view-toggle option[value="flat"]');
    return opt ? !opt.disabled : false;
  });
  assert.strictEqual(flatOptionReEnabled, true, 'Flat view option must be enabled again after building (b|a)*b');

  // Assert stepper is enabled again
  const stepNextReEnabled = await page.evaluate(() => {
    const btn = document.querySelector('#step-next');
    return btn ? !btn.disabled : false;
  });
  assert.strictEqual(stepNextReEnabled, true, 'Stepper buttons must be enabled again after building (b|a)*b');

  // Assert canvas shows the small NFA, not a cached SVG from previous build
  const smallNodeCount = await page.evaluate(() => document.querySelectorAll('#canvas svg g.node').length);
  assert(smallNodeCount <= 4, `Canvas must show small NFA for step 1 of (b|a)*b, got ${smallNodeCount} nodes`);

  // Assert step 1 on canvas has an edge labelled "b" and none labelled "a"
  const edgeLabels = await page.evaluate(() => {
    const texts = Array.from(document.querySelectorAll('#canvas svg g.edge text'));
    return texts.map((t) => t.textContent.trim()).filter(Boolean);
  });
  console.log('Step 1 edge labels for (b|a)*b:', edgeLabels);
  assert(edgeLabels.some((l) => l.includes('b')), `Step 1 on canvas must have an edge labelled "b", got: ${JSON.stringify(edgeLabels)}`);
  assert(!edgeLabels.some((l) => l.includes('a')), `Step 1 on canvas must have no edge labelled "a", got: ${JSON.stringify(edgeLabels)}`);

  // 3. Beyond 400 postfix tokens: diagram is disabled, table/simulation still work
  // 'a'.repeat(210) gives 210 symbols + 209 concats = 419 postfix tokens
  const expr400 = 'a'.repeat(210);
  await page.fill('#regex-input', expr400);
  await page.click('#build-button');
  await page.waitForFunction(() => {
    const note = document.querySelector('#layout-note')?.textContent || '';
    return note.includes('400');
  });

  const canvasMsg = await page.textContent('#canvas');
  console.log('Canvas message for 400+ tokens:', canvasMsg);
  assert(canvasMsg && canvasMsg.includes('400'), 'Canvas must state limit 400 when diagram is disabled');

  const stepNextDisabled = await page.evaluate(() => document.querySelector('#step-next')?.disabled);
  assert.strictEqual(stepNextDisabled, true, 'Stepper buttons must be disabled when diagram is off');

  // Collect page errors, then click a postfix token, click a step-log row if one exists, and press ArrowRight
  const errorsBeforeClicks = errors.length;

  const firstPostfixTok = await page.$('#postfix-view .postfix-token');
  if (firstPostfixTok) {
    await firstPostfixTok.click();
  }

  const firstStepLogRow = await page.$('#step-log .step-log-item');
  if (firstStepLogRow) {
    await firstStepLogRow.click();
  }

  await page.keyboard.press('ArrowRight');

  // Assert zero page errors, #step-next still disabled, and cap message still shown
  assert.strictEqual(
    errors.length,
    errorsBeforeClicks,
    `No page errors should occur during cap disabled interactions: ${errors.slice(errorsBeforeClicks).join(', ')}`
  );

  const stepNextStillDisabled = await page.evaluate(() => document.querySelector('#step-next')?.disabled);
  assert.strictEqual(stepNextStillDisabled, true, '#step-next must still be disabled after interactions');

  const canvasMsgAfterClicks = await page.textContent('#canvas');
  assert(canvasMsgAfterClicks && canvasMsgAfterClicks.includes('400'), 'Canvas must still show cap message after interactions');

  // Cap for final view: when expression is above 400 postfix tokens, Run and selecting Final NFA must not invoke Graphviz
  await page.evaluate(() => { window.__runDone = false; });
  await page.fill('#test-input', 'a');
  await page.click('#run-button');
  await page.waitForFunction('window.__runDone === true', null, { timeout: 15000 });

  await page.selectOption('#view-toggle', 'final');

  const hasSvgAfterRun400 = await page.evaluate(() => !!document.querySelector('#canvas svg'));
  assert.strictEqual(hasSvgAfterRun400, false, 'Canvas must have no <svg> above cap after Run');
  const canvasMsgAfterRun400 = await page.textContent('#canvas');
  assert(canvasMsgAfterRun400 && canvasMsgAfterRun400.includes('400'), 'Canvas must still show 400 cap message after Run');

  // Cap note in #layout-note survives the Run
  const capNoteAfterRun400 = await page.textContent('#layout-note');
  assert(capNoteAfterRun400 && capNoteAfterRun400.includes('400'), '400 cap note in #layout-note must survive Run');

  const tableRows400 = await page.evaluate(() => document.querySelectorAll('#transition-table tbody tr').length);
  assert(tableRows400 > 0, 'Transition table must still work beyond 400 tokens');

  // 4. Beyond 2,000 tokens: build refused
  const expr2000 = 'a'.repeat(2001);
  await page.fill('#regex-input', expr2000);
  await page.click('#build-button');
  await page.waitForFunction(() => {
    const err = document.querySelector('#error-message')?.textContent || '';
    return err.includes('2,000');
  });
  const error2000 = await page.textContent('#error-message');
  console.log('Error for 2000+ tokens:', error2000);
  assert(error2000 && error2000.includes('2,000'), 'Error message must state limit of 2,000 tokens');

  // ----------------------------------------------------
  // Ticket 10: Final NFA View, Compact Labels, and Trace Stepping
  // ----------------------------------------------------
  console.log('Testing Ticket 10: Final NFA view, active-state highlighting, and compact labels...');

  // Reset inputs and build (a|b)*a in epsilon-link mode
  await page.evaluate(() => { window.__buildDone = false; });
  await page.fill('#regex-input', '(a|b)*a');
  await page.selectOption('#concat-select', 'epsilon-link');
  await page.selectOption('#notation-select', 'standard');
  await page.click('#build-button');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });

  // 1. Final view shows diagram, transition-table and stats
  await page.selectOption('#view-toggle', 'final');
  await page.waitForFunction(() => document.querySelector('#canvas')?.getAttribute('data-view') === 'final');

  const finalStatsText = await page.textContent('#stats');
  assert(finalStatsText.includes('States: 10'), 'Final view must show 10 states in stats');
  assert(finalStatsText.includes('Transitions: 12'), 'Final view must show 12 transitions in stats');

  const finalTableRows = await page.evaluate(() => document.querySelectorAll('#transition-table tbody tr').length);
  assert(finalTableRows >= 10, 'Final view must show transition table with >= 10 rows');

  const finalSvgNodeCount = await page.evaluate(() => document.querySelectorAll('#canvas svg g.node').length);
  assert(finalSvgNodeCount >= 10, 'Final view canvas must render NFA diagram with >= 10 nodes');

  // 2. Active state highlighting while stepping through trace for 'ba'
  await page.evaluate(() => { window.__runDone = false; });
  await page.fill('#test-input', 'ba');
  await page.click('#run-button');
  await page.waitForFunction('window.__runDone === true', null, { timeout: 15000 });

  // On run, initial closure is highlighted: {0, 2, 4, 6, 7, 8}
  await page.waitForFunction(() => document.querySelectorAll('#canvas svg g.node.active').length === 6);
  const initialActiveNodes = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#canvas svg g.node.active')).map((el) => el.id).sort()
  );
  console.log('Initial active nodes:', initialActiveNodes);
  assert.deepStrictEqual(
    initialActiveNodes,
    ['n0', 'n2', 'n4', 'n6', 'n7', 'n8'],
    'Initial closure must highlight states 0, 2, 4, 6, 7, 8'
  );

  // Step through trace: click After 'b' (step 1)
  await page.click('#trace .trace-step[data-step="1"]');
  await page.waitForFunction(() => document.querySelectorAll('#canvas svg g.node.active').length === 7);
  const afterBActiveNodes = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#canvas svg g.node.active')).map((el) => el.id).sort()
  );
  console.log('After b active nodes:', afterBActiveNodes);
  assert.deepStrictEqual(
    afterBActiveNodes,
    ['n0', 'n2', 'n3', 'n4', 'n5', 'n7', 'n8'],
    'After "b" must highlight states 0, 2, 3, 4, 5, 7, 8'
  );

  // Step through trace: click After 'a' (step 2)
  await page.click('#trace .trace-step[data-step="2"]');
  await page.waitForFunction(() => document.querySelectorAll('#canvas svg g.node.active').length === 8);
  const afterAActiveNodes = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#canvas svg g.node.active')).map((el) => el.id).sort()
  );
  console.log('After a active nodes:', afterAActiveNodes);
  assert.deepStrictEqual(
    afterAActiveNodes,
    ['n0', 'n1', 'n2', 'n4', 'n5', 'n7', 'n8', 'n9'],
    'After "a" must highlight states 0, 1, 2, 4, 5, 7, 8, 9'
  );

  // 3. Dead run: run 'c' (added symbol in alphabet), active set becomes empty and is reported dead
  await page.evaluate(() => { window.__runDone = false; });
  await page.fill('#test-input', 'c');
  await page.click('#run-button');
  await page.waitForFunction('window.__runDone === true', null, { timeout: 15000 });

  // Click After 'c' / Dead step in trace
  await page.click('#trace .trace-step[data-step="1"]');
  await page.waitForFunction(() => document.querySelectorAll('#canvas svg g.node.active').length === 0);
  const deadActiveCount = await page.evaluate(() => document.querySelectorAll('#canvas svg g.node.active').length);
  assert.strictEqual(deadActiveCount, 0, 'Dead run step must highlight 0 active states');

  const deadRunStatus = await page.evaluate(() => document.querySelector('#canvas')?.getAttribute('data-run-status'));
  assert.strictEqual(deadRunStatus, 'dead', 'Canvas must have data-run-status="dead" on dead step');

  const runStatusText = await page.textContent('#run-status');
  console.log('Run status text for dead step:', runStatusText);
  assert(runStatusText.includes('dead') && runStatusText.includes('empty'), '#run-status must report dead run');

  // 4. Compact labels toggle in merge mode
  await page.evaluate(() => { window.__buildDone = false; });
  await page.selectOption('#concat-select', 'merge');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });
  await page.fill('#regex-input', '(a|b)*a');
  await page.evaluate(() => { window.__buildDone = false; });
  await page.click('#build-button');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });

  await page.selectOption('#view-toggle', 'final');
  await page.waitForFunction(() => document.querySelector('#canvas')?.getAttribute('data-view') === 'final');

  // Check state 9 in merge mode before compact labels toggle
  const rowState9Before = await page.evaluate(() => {
    const row = document.querySelector('#transition-table tbody tr[data-state="9"] td:first-child');
    return row?.textContent || '';
  });
  console.log('State 9 row label before compact:', rowState9Before);
  assert(rowState9Before.startsWith('q9'), 'Before compact toggle, state 9 row must start with q9');

  const node9TextBefore = await page.evaluate(() => {
    const txt = document.querySelector('#canvas svg g[id="n9"] text');
    return txt?.textContent || '';
  });
  console.log('Node n9 label before compact:', node9TextBefore);
  assert.strictEqual(node9TextBefore, '9', 'Before compact toggle, node n9 text must be 9');

  // Enable compact labels
  await page.check('#compact-labels');
  await page.waitForFunction(() => {
    const txt = document.querySelector('#canvas svg g[id="n9"] text')?.textContent;
    return txt === '8';
  });

  // Table must now display q8 for row with data-state="9"
  const rowState9After = await page.evaluate(() => {
    const row = document.querySelector('#transition-table tbody tr[data-state="9"] td:first-child');
    return row?.textContent || '';
  });
  console.log('State 9 row label after compact:', rowState9After);
  assert(rowState9After.startsWith('q8'), 'After compact toggle, state 9 row must start with q8 (0..n-1)');

  // Rebuild while #compact-labels is checked: assert no desync occurs on rebuild
  await page.evaluate(() => { window.__buildDone = false; });
  await page.click('#build-button');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });
  const rowState9Rebuild = await page.evaluate(() => {
    const row = document.querySelector('#transition-table tbody tr[data-state="9"] td:first-child');
    return row?.textContent || '';
  });
  console.log('State 9 row label on rebuild with compact checked:', rowState9Rebuild);
  assert(rowState9Rebuild.startsWith('q8'), `On rebuild with compact checked, state 9 row must read q8, got ${rowState9Rebuild}`);

  // Switch to final view to verify diagram node n9 after rebuild
  await page.selectOption('#view-toggle', 'final');
  await page.waitForFunction(() => document.querySelector('#canvas')?.getAttribute('data-view') === 'final');

  // Engine id in table attribute did NOT change
  const dataStateAttr = await page.evaluate(() =>
    document.querySelector('#transition-table tbody tr[data-display-state="8"]')?.getAttribute('data-state')
  );
  assert.strictEqual(dataStateAttr, '9', 'Row data-state attribute must still be engine id "9"');

  // Diagram SVG id did NOT change, but text became 8
  const node9TextAfter = await page.evaluate(() =>
    document.querySelector('#canvas svg g[id="n9"] text')?.textContent
  );
  assert.strictEqual(node9TextAfter, '8', 'After compact toggle, node n9 text must be mapped label 8');

  // Run 'ba' in merge mode with compact labels on
  await page.evaluate(() => { window.__runDone = false; });
  await page.fill('#test-input', 'ba');
  await page.click('#run-button');
  await page.waitForFunction('window.__runDone === true', null, { timeout: 15000 });

  // Trace text must use compact labels (state 9 mapped to 8)
  const compactTraceText = await page.textContent('#trace');
  console.log('Compact trace text:', compactTraceText);
  // In merge mode, after 'a': original states are {0, 1, 2, 4, 5, 7, 9} -> mapped to {0, 1, 2, 4, 5, 6, 8}
  assert(compactTraceText.includes('8'), 'Trace text must contain compact label 8');
  assert(!compactTraceText.includes('9'), 'Trace text with compact labels must not contain unmapped label 9');

  // Click After 'a' in compact trace
  await page.click('#trace .trace-step[data-step="2"]');
  await page.waitForFunction(() => document.querySelectorAll('#canvas svg g.node.active').length > 0);
  const compactActiveNodeIds = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#canvas svg g.node.active')).map((el) => el.id)
  );
  assert(compactActiveNodeIds.includes('n9'), 'Node n9 must still be identified by engine ID in SVG');

  // Uncheck compact labels: all revert back to unmapped
  await page.uncheck('#compact-labels');
  await page.waitForFunction(() => {
    const txt = document.querySelector('#canvas svg g[id="n9"] text')?.textContent;
    return txt === '9';
  });

  const rowState9Reverted = await page.evaluate(() => {
    const row = document.querySelector('#transition-table tbody tr[data-state="9"] td:first-child');
    return row?.textContent || '';
  });
  assert(rowState9Reverted.startsWith('q9'), 'Unchecking compact labels must revert table state label to q9');

  // ==========================================
  // Ticket 13: Validation panel, Built-in suite, Differential testing
  // ==========================================
  console.log('Testing Ticket 13: Validation panel...');

  // 1. Build (a|b)*a and check all 6 invariants and structural checks
  await page.evaluate(() => { window.__buildDone = false; });
  await page.fill('#alphabet-input', 'a, b');
  await page.dispatchEvent('#alphabet-input', 'change');
  await page.fill('#regex-input', '(a|b)*a');
  await page.selectOption('#notation-select', 'standard');
  await page.selectOption('#concat-select', 'epsilon-link');
  await page.click('#build-button');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });

  for (const checkId of ['#inv-I1', '#inv-I2', '#inv-I3', '#inv-I4', '#inv-size', '#inv-replay']) {
    const text = await page.textContent(checkId);
    const passAttr = await page.getAttribute(checkId, 'data-pass');
    console.log(`${checkId}: ${text}`);
    assert.strictEqual(passAttr, 'true', `${checkId} must pass`);
    assert(text.includes('PASS'), `${checkId} must display PASS`);
  }

  // 2. Run built-in suite and verify suite table
  await page.evaluate(() => { window.__suiteDone = false; });
  await page.click('#run-suite');
  await page.waitForFunction('window.__suiteDone === true', null, { timeout: 15000 });

  const suiteRows = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#suite-table tbody tr')).map((tr) => ({
      id: tr.getAttribute('data-id'),
      source: tr.querySelector('td:nth-child(2)')?.textContent || '',
      expected: tr.querySelector('td:nth-child(4)')?.textContent || '',
      generated: tr.querySelector('td:nth-child(5)')?.textContent || '',
      verdict: tr.getAttribute('data-verdict') || '',
      cellText: tr.querySelector('td:last-child')?.textContent || ''
    }))
  );
  console.log(`Built-in suite executed: ${suiteRows.length} cases`);
  assert(suiteRows.length >= 20, 'Built-in suite must have at least 20 test cases');
  assert(suiteRows.every((r) => r.verdict === 'PASS' && r.cellText === 'PASS'), 'All built-in suite cases must pass');

  // Verify (a|b)*abb golden case
  const abbRow = suiteRows.find((r) => r.source === '(a|b)*abb');
  assert(abbRow, 'Suite must contain (a|b)*abb');
  assert(abbRow.expected.includes('abb'), 'Expected must contain abb');
  assert(abbRow.expected.includes('aabb'), 'Expected must contain aabb');
  assert(abbRow.expected.includes('babb'), 'Expected must contain babb');
  assert(abbRow.expected.includes('abab'), 'Expected must contain abab');
  assert(abbRow.expected.includes('""'), 'Expected must contain empty string');
  assert.strictEqual(abbRow.verdict, 'PASS', '(a|b)*abb must pass');

  // 3. Differential run on (a|b)*a
  await page.evaluate(() => { window.__diffDone = false; });
  await page.click('#diff-run');
  await page.waitForFunction('window.__diffDone === true', null, { timeout: 30000 });

  const diffStatus = await page.textContent('#diff-status');
  console.log('Differential status:', diffStatus);
  assert(diffStatus.includes('k = 8'), 'Differential test must use k = 8 for alphabet of size 2');
  assert(diffStatus.includes('511 strings'), 'Differential test must report 511 strings for alphabet of size 2');

  const diffResult = await page.evaluate(() => window.__diffResult);
  assert.strictEqual(diffResult.allPassed, true, 'All oracles must pass on (a|b)*a');
  assert.strictEqual(diffResult.mismatches.length, 0, 'No mismatches on (a|b)*a');
  assert.strictEqual(diffResult.oracles.enumerator.status, 'pass');
  assert.strictEqual(diffResult.oracles.derivatives.status, 'pass');
  assert.strictEqual(diffResult.oracles.regExp.status, 'pass');

  // 4. Test capped RegExp worker timeout handling (shows 'skipped (timeout)')
  await page.evaluate(() => {
    window.__diffDone = false;
    window.__e2eWorkerMode = 'timeout';
  });
  await page.click('#diff-run');
  await page.waitForFunction('window.__diffDone === true', null, { timeout: 15000 });

  const timeoutStatus = await page.textContent('#diff-status');
  console.log('Timeout status text:', timeoutStatus);
  assert(
    timeoutStatus.includes('ALL PASSED (RegExp oracle skipped: timeout)'),
    'Status must read ALL PASSED (RegExp oracle skipped: timeout)'
  );

  const diffResultTimedOut = await page.evaluate(() => window.__diffResult);
  console.log('RegExp oracle status on timeout:', diffResultTimedOut.oracles.regExp.status);
  assert.strictEqual(diffResultTimedOut.oracles.regExp.status, 'skipped (timeout)', 'RegExp oracle must show skipped (timeout)');
  assert.strictEqual(diffResultTimedOut.allPassed, true, 'Overall differential run must remain passed when RegExp is skipped (timeout)');
  await page.evaluate(() => { window.__e2eWorkerMode = null; });

  // 5. Test worker error -> oracle status 'error', allPassed false, status line "ORACLE ERROR"
  await page.evaluate(() => {
    window.__diffDone = false;
    window.__e2eWorkerMode = 'error';
  });
  await page.click('#diff-run');
  await page.waitForFunction('window.__diffDone === true', null, { timeout: 15000 });

  const errorStatus = await page.textContent('#diff-status');
  console.log('Worker error status text:', errorStatus);
  assert(errorStatus.includes('ORACLE ERROR'), 'Status line must read ORACLE ERROR on worker error');
  assert(!errorStatus.includes('MISMATCH DETECTED'), 'Status line must NOT say MISMATCH DETECTED on worker error');

  const diffResultError = await page.evaluate(() => window.__diffResult);
  assert.strictEqual(diffResultError.oracles.regExp.status, 'error', 'RegExp oracle status must be error');
  assert.strictEqual(diffResultError.allPassed, false, 'allPassed must be false on worker error');
  await page.evaluate(() => { window.__e2eWorkerMode = null; });

  // 6. Deterministic race test: rebuild mid-run, old results must never appear
  await page.evaluate(() => {
    window.__diffDone = false;
    window.__e2eWorkerDelay = 800; // 800ms delay in worker
  });
  // Trigger differential run
  await page.click('#diff-run');
  // Immediately rebuild mid-run with new expression 'b'
  await page.fill('#regex-input', 'b');
  await page.click('#build-button');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });

  // On rebuild, #diff-status and #diff-results must be cleared immediately
  const statusOnRebuild = await page.textContent('#diff-status');
  const resultsOnRebuild = await page.textContent('#diff-results');
  assert.strictEqual(statusOnRebuild, '', '#diff-status must be cleared on build');
  assert.strictEqual(resultsOnRebuild, '', '#diff-results must be cleared on build');

  // Wait 1200ms to let the delayed worker for old differential run finish
  await page.waitForTimeout(1200);

  // Stale results must never appear in DOM (discarded by diffGeneration)
  const statusAfterDelay = await page.textContent('#diff-status');
  const resultsAfterDelay = await page.textContent('#diff-results');
  assert.strictEqual(statusAfterDelay, '', 'Stale differential status must not appear after delayed worker finishes');
  assert.strictEqual(resultsAfterDelay, '', 'Stale differential results must not appear after delayed worker finishes');

  const diffRunDisabled = await page.$eval('#diff-run', (el) => el.disabled);
  assert.strictEqual(diffRunDisabled, false, '#diff-run button must be re-enabled after mid-run abort or completion');

  await page.evaluate(() => {
    window.__e2eWorkerDelay = 0;
  });

  // -------------------------------------------------------------
  // Ticket 14: Stress panel
  // -------------------------------------------------------------
  console.log('Testing Ticket 14: Stress panel...');

  // Fix 2: Mutual exclusion check - start #diff-run, confirm #stress-run is disabled, let it finish with no "ORACLE ERROR"
  await page.evaluate(() => { window.__buildDone = false; });
  await page.fill('#regex-input', '(a|b)*a');
  await page.click('#build-button');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });

  await page.evaluate(() => {
    window.__diffDone = false;
    window.__e2eWorkerMode = 'hold';
  });
  await page.click('#diff-run');
  await page.waitForFunction(() => window.__heldWorkerMessages && window.__heldWorkerMessages.length > 0);
  const stressDisabledDuringDiff = await page.$eval('#stress-run', (el) => el.disabled);
  assert.strictEqual(stressDisabledDuringDiff, true, '#stress-run must be disabled while differential run is active');

  await page.evaluate(() => {
    window.__e2eWorkerMode = 'normal';
    window.__releaseHeldWorkerMessages();
  });
  await page.waitForFunction('window.__diffDone === true', null, { timeout: 15000 });
  const stressReEnabledAfterDiff = await page.$eval('#stress-run', (el) => el.disabled);
  assert.strictEqual(stressReEnabledAfterDiff, false, '#stress-run must be re-enabled after differential run finishes');

  const diffStatusTextAfter = await page.textContent('#diff-status');
  console.log('Differential status after mutual exclusion check:', diffStatusTextAfter);
  assert(!diffStatusTextAfter.includes('ORACLE ERROR'), 'Differential run must finish with no ORACLE ERROR');

  // 1. Check browser engine info in panel
  const browserInfoText = await page.textContent('#stress-browser-info');
  console.log('Stress browser info:', browserInfoText);
  assert(
    browserInfoText.includes('V8') || browserInfoText.includes('Chromium') || browserInfoText.includes('Chrome'),
    'Browser info must identify V8 / Chromium / Chrome'
  );

  // 2. Initial inline-SVG chart exists and action buttons are disabled
  const initialChartExists = await page.evaluate(() => !!document.querySelector('#stress-chart-container svg'));
  assert(initialChartExists, 'Initial inline-SVG chart must be rendered in #stress-chart-container');
  assert.strictEqual(await page.$eval('#stress-copy-csv', (el) => el.disabled), true, '#stress-copy-csv must initially be disabled');
  assert.strictEqual(await page.$eval('#stress-export-svg', (el) => el.disabled), true, '#stress-export-svg must initially be disabled');

  // 3. Start run for default family ((a*)*b on a^n)
  await page.click('#stress-run');

  // Confirm #diff-run and #stress-family are disabled while stress run is active
  const diffDisabledDuringStress = await page.$eval('#diff-run', (el) => el.disabled);
  assert.strictEqual(diffDisabledDuringStress, true, '#diff-run must be disabled while stress run is active');
  const familyDisabledDuringStress = await page.$eval('#stress-family', (el) => el.disabled);
  assert.strictEqual(familyDisabledDuringStress, true, '#stress-family must be disabled while stress run is active');

  // 4. Verify a row appears in #stress-table
  await page.waitForFunction('window.__stressRowAdded === true', null, { timeout: 15000 });
  const rowCount = await page.evaluate(() => document.querySelectorAll('#stress-table tbody tr').length);
  console.log('Stress table row count during run:', rowCount);
  assert(rowCount >= 1, 'Stress table must have at least 1 row after run starts');

  const firstRowText = await page.$eval('#stress-table tbody tr:first-child', (el) => el.textContent);
  console.log('First stress row text:', firstRowText);
  assert(firstRowText.includes('12'), 'First row must test n=12');
  assert(firstRowText.includes('REJECT'), 'First row must report verdict REJECT');

  // 5. Verify page controls remain responsive during run
  await page.fill('#regex-input', 'abc');
  const stressInputVal = await page.$eval('#regex-input', (el) => el.value);
  assert.strictEqual(stressInputVal, 'abc', 'Page input control must remain responsive during stress run');

  // 6. Verify inline-SVG chart updated with data points
  const circleCount = await page.evaluate(() => document.querySelectorAll('#stress-chart-container svg circle').length);
  console.log('Stress chart rendered circles:', circleCount);
  assert(circleCount >= 2, 'Stress chart must contain data circles');

  // 7. Fix 1: Cancel run, wait for __stressDone, assert no row contains TIMEOUT or "8,000"
  await page.click('#stress-cancel');
  await page.waitForFunction('window.__stressDone === true', null, { timeout: 15000 });

  const diffReEnabledAfterStress = await page.$eval('#diff-run', (el) => el.disabled);
  assert.strictEqual(diffReEnabledAfterStress, false, '#diff-run must be re-enabled after stress run finishes or cancels');
  const familyReEnabledAfterStress = await page.$eval('#stress-family', (el) => el.disabled);
  assert.strictEqual(familyReEnabledAfterStress, false, '#stress-family must be re-enabled after stress run finishes or cancels');

  const rowTextsAfterCancel = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#stress-table tbody tr')).map((r) => r.textContent)
  );
  console.log('Row texts after cancel count:', rowTextsAfterCancel.length);
  for (const text of rowTextsAfterCancel) {
    assert(!text.includes('TIMEOUT'), 'No row must contain TIMEOUT on cancel');
    assert(!text.includes('8,000'), 'No row must contain 8,000 on cancel');
  }

  // Ticket 18 AC3 & AC4: Log scale toggle and point retention
  console.log('Testing Ticket 18 AC3 & AC4: Log scale toggle and point retention...');
  const initialScale = await page.$eval('#stress-chart-container', (el) => el.getAttribute('data-scale'));
  assert.strictEqual(initialScale, 'linear', 'Initial chart scale must be linear');
  const toggleBtnText = await page.textContent('#stress-scale-toggle');
  assert.strictEqual(toggleBtnText.trim(), 'Log scale', 'Toggle button text must be "Log scale"');
  const ariaPressedInitial = await page.$eval('#stress-scale-toggle', (el) => el.getAttribute('aria-pressed'));
  assert.strictEqual(ariaPressedInitial, 'false', 'aria-pressed must initially be false');

  const circlesBeforeToggle = await page.evaluate(() => document.querySelectorAll('#stress-chart-container svg circle').length);
  assert(circlesBeforeToggle >= 2, 'Chart must have circles before toggle');

  // Toggle to log
  await page.click('#stress-scale-toggle');
  const scaleAfterToggle = await page.$eval('#stress-chart-container', (el) => el.getAttribute('data-scale'));
  assert.strictEqual(scaleAfterToggle, 'log', 'Chart scale must switch to log');
  const ariaPressedLog = await page.$eval('#stress-scale-toggle', (el) => el.getAttribute('aria-pressed'));
  assert.strictEqual(ariaPressedLog, 'true', 'aria-pressed must be true after toggling log scale');
  const toggleBtnTextAfter = await page.textContent('#stress-scale-toggle');
  assert.strictEqual(toggleBtnTextAfter.trim(), 'Log scale', 'Toggle button label must remain stable as "Log scale"');

  const circlesAfterToggle = await page.evaluate(() => document.querySelectorAll('#stress-chart-container svg circle').length);
  assert.strictEqual(circlesAfterToggle, circlesBeforeToggle, 'Stress chart must retain points across scale toggle');

  const chartSvgText = await page.textContent('#stress-chart-container svg');
  assert(chartSvgText.includes('(log scale)'), 'Panel A title must include "(log scale)" in log mode');
  assert(chartSvgText.includes('≤0.01 ms'), 'Panel A Y-axis must include "≤0.01 ms" tick in log mode');

  // Toggle back to linear
  await page.click('#stress-scale-toggle');
  const scaleAfterToggleBack = await page.$eval('#stress-chart-container', (el) => el.getAttribute('data-scale'));
  assert.strictEqual(scaleAfterToggleBack, 'linear', 'Chart scale must switch back to linear');
  const ariaPressedLinear = await page.$eval('#stress-scale-toggle', (el) => el.getAttribute('aria-pressed'));
  assert.strictEqual(ariaPressedLinear, 'false', 'aria-pressed must be false after toggling back to linear');

  // Ticket 18 AC6 & AC7: Copy CSV and feedback UX
  console.log('Testing Ticket 18 AC6 & AC7: Copy CSV and feedback UX...');
  assert.strictEqual(await page.$eval('#stress-copy-csv', (el) => el.disabled), false, '#stress-copy-csv must be enabled after rows exist');

  const liveRegionBeforeCopy = await page.textContent('#live-region');
  await page.click('#stress-copy-csv');
  await page.waitForFunction(() => document.getElementById('stress-copy-status')?.textContent === 'Copied!');
  const copyStatusText = await page.textContent('#stress-copy-status');
  assert.strictEqual(copyStatusText, 'Copied!', '#stress-copy-status must show "Copied!"');
  assert.strictEqual(await page.$eval('#stress-copy-status', (el) => el.getAttribute('data-copied')), 'true', 'data-copied must be set to true on successful copy');

  // Verify live region is NOT touched (D5)
  const liveRegionAfterCopy = await page.textContent('#live-region');
  assert.strictEqual(liveRegionAfterCopy, liveRegionBeforeCopy, 'Copy action must not write to #live-region');

  // Verify copied CSV text
  const copiedCsv = await page.evaluate(() => navigator.clipboard.readText());
  assert(copiedCsv.startsWith('family,n,string_length,regexp_time_ms,nfa_time_ms,regexp_verdict,nfa_verdict\r\n'), 'CSV must start with correct header and CRLF');
  assert(copiedCsv.includes('star-star-b,12,12,'), 'CSV must contain first row data');
  assert(copiedCsv.includes('REJECT'), 'CSV must contain verdict');

  // Ticket 18b: Full row-for-row equality check between table and CSV
  const stressTableRows = await page.$$eval('#stress-table tbody tr', (trs) =>
    trs.map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => td.textContent.trim()))
  );
  assert(stressTableRows.length >= 3, 'Stress table must contain at least 3 rows after cancel');

  const selectedFamily = await page.$eval('#stress-family', (el) => el.value);
  const csvLines = copiedCsv.split('\r\n');
  assert.strictEqual(csvLines[0], 'family,n,string_length,regexp_time_ms,nfa_time_ms,regexp_verdict,nfa_verdict', 'CSV header must match exactly');
  assert.strictEqual(csvLines[csvLines.length - 1], '', 'CSV must end with trailing CRLF');
  const csvDataLines = csvLines.slice(1, -1);

  assert.strictEqual(csvDataLines.length, stressTableRows.length, 'CSV data row count must equal table row count');

  for (let i = 0; i < stressTableRows.length; i++) {
    const csvCols = csvDataLines[i].split(',');
    assert.strictEqual(csvCols.length, 7, `CSV row ${i} must have 7 columns`);
    const [cFamily, cN, cLen, cRegExpTime, cNfaTime, cRegExpVerdict, cNfaVerdict] = csvCols;
    const [tN, tLen, tRegExpTimeRaw, tNfaTimeRaw, tRegExpVerdict, tNfaVerdict] = stressTableRows[i];

    assert.strictEqual(cFamily, selectedFamily, `Row ${i} family must match selected family`);
    assert.strictEqual(cN, tN, `Row ${i} n must match table`);
    assert.strictEqual(cLen, tLen, `Row ${i} string length must match table`);

    let expectedRegExpTime = '';
    if (tRegExpVerdict !== 'TIMEOUT' && tRegExpVerdict !== 'SKIPPED' && tRegExpVerdict !== '—' && tRegExpVerdict !== 'ERROR') {
      expectedRegExpTime = tRegExpTimeRaw.endsWith(' ms') ? tRegExpTimeRaw.slice(0, -3).trim() : tRegExpTimeRaw;
    }
    assert.strictEqual(cRegExpTime, expectedRegExpTime, 'CSV RegExp time must match table RegExp time');

    const expectedNfaTime = tNfaTimeRaw.endsWith(' ms') ? tNfaTimeRaw.slice(0, -3).trim() : tNfaTimeRaw;
    assert.strictEqual(cNfaTime, expectedNfaTime, 'CSV NFA time must match table NFA time');

    const expectedRegExpVerdict = tRegExpVerdict === '—' ? 'SKIPPED' : tRegExpVerdict;
    assert.strictEqual(cRegExpVerdict, expectedRegExpVerdict, 'CSV RegExp verdict must match table');
    assert.strictEqual(cNfaVerdict, tNfaVerdict, 'CSV NFA verdict must match table');
  }

  // Verify 2 s clear timer with waitForFunction (no fixed sleep)
  await page.waitForFunction(() => !document.getElementById('stress-copy-status')?.hasAttribute('data-copied'), null, { timeout: 5000 });
  assert.strictEqual(await page.textContent('#stress-copy-status'), '', 'Copy status text must be cleared after 2 s');

  // Test fallback to execCommand when writeText rejects
  await page.evaluate(() => {
    window.__origWriteText = navigator.clipboard.writeText;
    navigator.clipboard.writeText = () => Promise.reject(new Error('Permission denied'));
  });
  await page.click('#stress-copy-csv');
  assert.strictEqual(await page.textContent('#stress-copy-status'), 'Copied!', 'Copy fallback must succeed via execCommand when writeText rejects');
  assert.strictEqual(await page.$eval('#stress-copy-status', (el) => el.getAttribute('data-copied')), 'true', 'data-copied must be true on fallback copy');

  // Test "Copy failed" when both writeText and execCommand fail
  await page.evaluate(() => {
    window.__origExecCommand = document.execCommand;
    document.execCommand = () => false;
  });
  await page.click('#stress-copy-csv');
  assert.strictEqual(await page.textContent('#stress-copy-status'), 'Copy failed', 'Status must show Copy failed when both writeText and execCommand fail');
  assert.strictEqual(await page.$eval('#stress-copy-status', (el) => el.getAttribute('data-copied')), 'false', 'data-copied must be false when copy fails');

  // Restore clipboard functions
  await page.evaluate(() => {
    navigator.clipboard.writeText = window.__origWriteText;
    document.execCommand = window.__origExecCommand;
    delete window.__origWriteText;
    delete window.__origExecCommand;
  });
  await page.waitForFunction(() => !document.getElementById('stress-copy-status')?.hasAttribute('data-copied'), null, { timeout: 5000 });

  // Ticket 18 AC8: SVG export
  console.log('Testing Ticket 18 AC8: SVG export...');
  assert.strictEqual(await page.$eval('#stress-export-svg', (el) => el.disabled), false, '#stress-export-svg must be enabled when rows exist');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#stress-export-svg')
  ]);

  const filename = download.suggestedFilename();
  assert.strictEqual(filename, 'stress-chart-star-star-b-linear.svg', 'Exported SVG filename must match stress-chart-<family>-<scale>.svg');

  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  const downloadedSvg = Buffer.concat(chunks).toString('utf-8');

  // Verify XML validity in the page using DOMParser
  const xmlParseResult = await page.evaluate((svgText) => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');
    const errors = doc.querySelectorAll('parsererror');
    return {
      errorCount: errors.length,
      hasTitle: !!doc.querySelector('title'),
      hasDesc: !!doc.querySelector('desc'),
      rootTag: doc.documentElement.tagName,
      width: doc.documentElement.getAttribute('width'),
      height: doc.documentElement.getAttribute('height'),
      viewBox: doc.documentElement.getAttribute('viewBox')
    };
  }, downloadedSvg);

  assert.strictEqual(xmlParseResult.errorCount, 0, 'Exported SVG must parse as valid XML without parsererror');
  assert.strictEqual(xmlParseResult.rootTag, 'svg', 'Root element must be svg');
  assert.strictEqual(xmlParseResult.width, '760', 'Width must be explicit 760');
  assert.strictEqual(xmlParseResult.height, '320', 'Height must be explicit 320');
  assert.strictEqual(xmlParseResult.viewBox, '0 0 760 320', 'viewBox must be "0 0 760 320"');
  assert.strictEqual(xmlParseResult.hasTitle, true, 'Exported SVG must contain <title>');
  assert.strictEqual(xmlParseResult.hasDesc, true, 'Exported SVG must contain <desc>');
  assert(downloadedSvg.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), 'Exported SVG must start with XML declaration');

  // Also test export filename in log mode
  await page.click('#stress-scale-toggle');
  const [downloadLog] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#stress-export-svg')
  ]);
  assert.strictEqual(downloadLog.suggestedFilename(), 'stress-chart-star-star-b-log.svg', 'Exported SVG filename in log mode must be stress-chart-<family>-log.svg');
  const streamLog = await downloadLog.createReadStream();
  const chunksLog = [];
  for await (const chunk of streamLog) {
    chunksLog.push(chunk);
  }
  const downloadedLogSvg = Buffer.concat(chunksLog).toString('utf-8');
  assert(downloadedLogSvg.includes('(log scale)'), 'Exported log SVG must include (log scale)');
  assert(downloadedLogSvg.includes('≤0.01 ms'), 'Exported log SVG must include ≤0.01 ms tick');

  // Leave in log mode to verify scale persists across family change and new run (D2)
  assert.strictEqual(await page.$eval('#stress-chart-container', (el) => el.getAttribute('data-scale')), 'log');

  // 8. Test second family ((a+)+ on a^n b)
  await page.selectOption('#stress-family', 'plus-plus');
  assert.strictEqual(await page.$eval('#stress-chart-container', (el) => el.getAttribute('data-scale')), 'log', 'Chart scale must stay log after family change');

  await page.evaluate(() => { window.__stressRowAdded = false; window.__stressDone = false; });
  const disabledOnRun = await page.evaluate(() => {
    document.getElementById('stress-run').click();
    return {
      copyCsv: document.getElementById('stress-copy-csv')?.disabled,
      exportSvg: document.getElementById('stress-export-svg')?.disabled
    };
  });
  assert.strictEqual(disabledOnRun.copyCsv, true, '#stress-copy-csv must be disabled when run starts with 0 rows');
  assert.strictEqual(disabledOnRun.exportSvg, true, '#stress-export-svg must be disabled when run starts with 0 rows');
  assert.strictEqual(await page.$eval('#stress-chart-container', (el) => el.getAttribute('data-scale')), 'log', 'Chart scale must stay log on new run');

  await page.waitForFunction('window.__stressRowAdded === true', null, { timeout: 15000 });
  assert.strictEqual(await page.$eval('#stress-copy-csv', (el) => el.disabled), false, '#stress-copy-csv must be re-enabled once rows are added mid-run');
  assert.strictEqual(await page.$eval('#stress-export-svg', (el) => el.disabled), false, '#stress-export-svg must be re-enabled once rows are added mid-run');

  // Mid-run copy contains rows so far (D4)
  await page.click('#stress-copy-csv');
  const midRunCsv = await page.evaluate(() => navigator.clipboard.readText());
  assert(midRunCsv.includes('plus-plus,12,13,'), 'Mid-run copy must contain rows so far');

  const plusRowText = await page.$eval('#stress-table tbody tr:first-child', (el) => el.textContent);
  console.log('Second family first row text:', plusRowText);
  assert(plusRowText.includes('12'), 'Second family row must test n=12');
  assert(plusRowText.includes('13'), 'Second family string length must be 13');
  assert(plusRowText.includes('REJECT'), 'Second family verdict must be REJECT');

  await page.click('#stress-cancel');
  await page.waitForFunction('window.__stressDone === true', null, { timeout: 15000 });

  // Buttons and rows still enabled/retained after cancel (D4)
  assert.strictEqual(await page.$eval('#stress-copy-csv', (el) => el.disabled), false, '#stress-copy-csv must remain enabled after cancel');
  assert.strictEqual(await page.$eval('#stress-export-svg', (el) => el.disabled), false, '#stress-export-svg must remain enabled after cancel');
  await page.click('#stress-copy-csv');
  const cancelCsv = await page.evaluate(() => navigator.clipboard.readText());
  assert(cancelCsv.includes('plus-plus,12,13,'), 'CSV copied after cancel must contain rows so far');

  // Restore linear mode for following tests
  await page.click('#stress-scale-toggle');

  // 9. Item 1: Cancel while pending worker call with window.__e2eWorkerMode = 'timeout'
  console.log('Testing cancel during pending worker call with __e2eWorkerMode = timeout...');
  await page.evaluate(() => {
    window.__e2eWorkerMode = 'timeout';
    window.__stressDone = false;
  });
  await page.click('#stress-run');
  await page.waitForFunction(() => {
    const status = document.querySelector('#stress-status')?.textContent;
    return status && status.includes('Testing n = 12...');
  }, null, { timeout: 15000 });
  await page.click('#stress-cancel');
  await page.waitForFunction('window.__stressDone === true', null, { timeout: 15000 });
  await page.evaluate(() => { window.__e2eWorkerMode = null; });

  const cancelPendingRows = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#stress-table tbody tr')).map((r) => r.textContent)
  );
  console.log('Pending cancel row count:', cancelPendingRows.length);
  for (const text of cancelPendingRows) {
    assert(!text.includes('TIMEOUT'), 'No row must contain TIMEOUT when cancelled during pending worker call');
    assert(!text.includes('8,000'), 'No row must contain 8,000 when cancelled during pending worker call');
  }
  const timeoutMarkerExists = await page.evaluate(() => !!document.querySelector('#stress-chart-container #panelA-timeout'));
  assert.strictEqual(timeoutMarkerExists, false, 'Chart must not contain a timeout marker when cancelled');

  // Ticket 15: Packaging and Polish
  console.log('Testing Ticket 15: Presets...');
  const presetOptions = await page.$$eval('#preset-select option', (opts) =>
    opts.map((o) => ({ value: o.value, text: o.text })).filter((o) => o.value !== '')
  );
  console.log(`Found ${presetOptions.length} presets in #preset-select`);
  assert(presetOptions.length >= 8, `Must have at least 8 presets, found ${presetOptions.length}`);

  for (const preset of presetOptions) {
    await page.evaluate(() => { window.__buildDone = false; });
    await page.selectOption('#preset-select', preset.value);
    await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });
    const errText = await page.textContent('#error-message');
    assert.strictEqual(errText.trim(), '', `Preset ${preset.value} produced error: ${errText}`);

    const stats = await page.textContent('#stats');
    if (preset.value === 'worked-example') {
      // (a|b)*a: 10 states and 12 transitions
      assert(stats.includes('States: 10') && stats.includes('Transitions: 12'), `worked-example stats: ${stats}`);
    } else if (preset.value === 'classic-abb') {
      // (a|b)*abb in ε-link mode: 14 states and 16 transitions
      assert(stats.includes('States: 14') && stats.includes('Transitions: 16'), `classic-abb stats: ${stats}`);

      // Now switch to merge mode: 11 states and 13 transitions
      await page.selectOption('#concat-select', 'merge');
      await page.evaluate(() => { window.__buildDone = false; });
      await page.click('#build-button');
      await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });
      const mergeStats = await page.textContent('#stats');
      assert(mergeStats.includes('States: 11') && mergeStats.includes('Transitions: 13'), `classic-abb merge stats: ${mergeStats}`);
    } else if (preset.value === 'star-b') {
      // a*b in ε-link mode: 6 states and 7 transitions
      assert(stats.includes('States: 6') && stats.includes('Transitions: 7'), `star-b stats: ${stats}`);
    }
  }

  console.log('Testing Ticket 15: Keyboard and Live Region...');
  // 1. Enter key in #regex-input builds
  await page.selectOption('#notation-select', 'standard');
  await page.selectOption('#concat-select', 'epsilon-link');
  await page.fill('#regex-input', '(a|b)*a');
  await page.evaluate(() => { window.__buildDone = false; });
  await page.focus('#regex-input');
  await page.keyboard.press('Enter');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });
  const enterStats = await page.textContent('#stats');
  assert(enterStats.includes('States: 10'), 'Enter key in #regex-input must build expression');

  // 2. Tab order follows visual order
  const focusableIds = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button, input, select, textarea'))
      .filter((el) => {
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && !el.disabled;
      })
      .map((el) => el.id || el.getAttribute('data-testid') || el.tagName.toLowerCase());
  });
  console.log('Focusable controls initial order:', focusableIds.slice(0, 8));
  assert.strictEqual(focusableIds[0], 'preset-select', 'First focusable should be preset-select');
  assert.strictEqual(focusableIds[1], 'regex-input', 'Second focusable should be regex-input');
  assert.strictEqual(focusableIds[2], 'insert-eps', 'Third focusable should be insert-eps');
  assert.strictEqual(focusableIds[3], 'insert-empty', 'Fourth focusable should be insert-empty');
  assert.strictEqual(focusableIds[4], 'notation-select', 'Fifth focusable should be notation-select');
  assert.strictEqual(focusableIds[5], 'concat-select', 'Sixth focusable should be concat-select');
  assert.strictEqual(focusableIds[6], 'build-button', 'Seventh focusable should be build-button');

  // 3. Live region announces verdict after Run, step and rule after Next
  const liveRegionBeforeRun = await page.textContent('#live-region');
  await page.fill('#test-input', 'ba');
  await page.click('#run-button');
  await page.waitForFunction(() => document.getElementById('live-region')?.textContent?.includes('ACCEPT'), null, { timeout: 5000 });
  const liveRegionAfterRun = await page.textContent('#live-region');
  console.log('Live region after Run:', liveRegionAfterRun);
  assert.notStrictEqual(liveRegionAfterRun, liveRegionBeforeRun, 'Live region text must change after Run');
  assert(liveRegionAfterRun.includes('ACCEPT'), 'Live region after Run must announce verdict');

  await page.click('#step-first');
  await page.waitForFunction(() => document.getElementById('live-region')?.textContent?.includes('Step 1 of 6'), null, { timeout: 5000 });
  const liveRegionAtStep1 = await page.textContent('#live-region');
  console.log('Live region at step 1:', liveRegionAtStep1);
  assert(liveRegionAtStep1.includes('Step 1 of 6') && liveRegionAtStep1.includes('symbol'), 'Live region must announce step 1 and rule');

  await page.click('#step-next');
  await page.waitForFunction(() => document.getElementById('live-region')?.textContent?.includes('Step 2 of 6'), null, { timeout: 5000 });
  const liveRegionAfterNext = await page.textContent('#live-region');
  console.log('Live region after Next:', liveRegionAfterNext);
  assert.notStrictEqual(liveRegionAfterNext, liveRegionAtStep1, 'Live region text must change after Next');
  assert(liveRegionAfterNext.includes('Step 2 of 6') && liveRegionAfterNext.includes('symbol'), 'Live region after Next must announce step 2 and rule');

  // 4. Arrow keys still step
  await page.evaluate(() => document.body.focus());
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.getElementById('live-region')?.textContent?.includes('Step 3 of 6'), null, { timeout: 5000 });
  const liveRegionAfterArrow = await page.textContent('#live-region');
  console.log('Live region after ArrowRight:', liveRegionAfterArrow);
  assert(liveRegionAfterArrow.includes('Step 3 of 6') && liveRegionAfterArrow.includes('union'), 'ArrowRight must step and announce step 3 union');

  // Scope B: Live region re-announces identical text
  console.log('Testing Scope B: Live region re-announces identical text...');
  await page.selectOption('#notation-select', 'standard');
  await page.selectOption('#concat-select', 'epsilon-link');
  await page.fill('#regex-input', '(a|b)*a');
  await page.evaluate(() => { window.__buildDone = false; });
  await page.click('#build-button');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });

  await page.evaluate(() => {
    window.__liveMutations = [];
    const target = document.getElementById('live-region');
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        window.__liveMutations.push({
          type: m.type,
          targetText: target ? target.textContent : ''
        });
      }
    });
    observer.observe(target, { childList: true, characterData: true, subtree: true });
  });

  // First run: "ba" (ACCEPT)
  await page.fill('#test-input', 'ba');
  await page.click('#run-button');
  await page.waitForFunction(() => document.getElementById('live-region')?.textContent?.includes('Verdict: ACCEPT'), null, { timeout: 5000 });
  const mutationsAfterFirstRun = await page.evaluate(() => window.__liveMutations.length);
  assert(mutationsAfterFirstRun >= 1, 'First run must produce at least one mutation in #live-region');

  // Second run: "a" (also ACCEPT)
  await page.fill('#test-input', 'a');
  await page.click('#run-button');
  await page.waitForTimeout(100);
  await page.waitForFunction(() => document.getElementById('live-region')?.textContent?.includes('Verdict: ACCEPT'), null, { timeout: 5000 });
  const mutationsAfterSecondRun = await page.evaluate(() => window.__liveMutations.length);
  const liveTextAfterSecondRun = await page.textContent('#live-region');

  console.log(`Live region mutations: first run=${mutationsAfterFirstRun}, second run=${mutationsAfterSecondRun}`);
  assert(mutationsAfterSecondRun > mutationsAfterFirstRun, 'Second identical verdict must produce at least one new mutation in #live-region');
  assert.strictEqual(liveTextAfterSecondRun.trim(), 'Verdict: ACCEPT', 'Final text after second run must be "Verdict: ACCEPT"');

  // 5. Check no result is colour-only
  console.log('Testing Ticket 15: Color-only audit (verdicts, invariants, suite rows, timeout marker)...');
  const auditVerdictText = await page.textContent('#verdict');
  assert(auditVerdictText.includes('ACCEPT') || auditVerdictText.includes('REJECT'), 'Verdict must carry text');

  const invI1Text = await page.textContent('#inv-I1');
  assert(invI1Text.startsWith('PASS') || invI1Text.startsWith('FAIL'), 'Invariant marks must carry PASS/FAIL text');

  await page.click('#run-suite');
  const suiteVerdictTexts = await page.$$eval('#suite-table tbody tr td:last-child', (tds) =>
    tds.map((td) => td.textContent.trim())
  );
  assert(suiteVerdictTexts.length >= 20, 'Suite must have at least 20 rows');
  for (const txt of suiteVerdictTexts) {
    assert(txt === 'PASS' || txt === 'FAIL', `Suite row must have PASS or FAIL text, got "${txt}"`);
  }

  // Trigger timeout marker to assert it has text
  await page.evaluate(() => {
    window.__e2eWorkerMode = 'timeout';
    window.__stressDone = false;
  });
  await page.click('#stress-run');
  await page.waitForFunction('window.__stressDone === true', null, { timeout: 25000 });
  await page.evaluate(() => { window.__e2eWorkerMode = null; });

  const timeoutSvgText = await page.$eval('#stress-chart-container #panelA-timeout text', (el) => el.textContent);
  console.log('Timeout SVG text:', timeoutSvgText);
  assert.strictEqual(timeoutSvgText, 'timeout', 'SVG timeout marker must contain text "timeout"');

  const timeoutTableText = await page.$$eval('#stress-table tbody tr', (rows) =>
    rows.map((r) => r.textContent).join(' ')
  );
  assert(timeoutTableText.includes('TIMEOUT'), 'Stress table row must carry text TIMEOUT');

  // Ticket 18 AC5: Timeout marker stays at ceiling in log mode
  await page.click('#stress-scale-toggle');
  assert.strictEqual(await page.$eval('#stress-chart-container', (el) => el.getAttribute('data-scale')), 'log');
  const timeoutMarkerInLog = await page.evaluate(() => document.querySelector('#stress-chart-container #panelA-timeout text')?.textContent || null);
  assert.strictEqual(timeoutMarkerInLog, 'timeout', 'SVG timeout marker must remain present and visible in log mode');
  await page.click('#stress-scale-toggle');
  assert.strictEqual(await page.$eval('#stress-chart-container', (el) => el.getAttribute('data-scale')), 'linear');

  // Scope A: Clear stale results on every successful build
  console.log('Testing Scope A: Clear stale results on rebuild...');
  // 1. Build (a|b)*a, run "ba" (ACCEPT)
  await page.selectOption('#notation-select', 'standard');
  await page.selectOption('#concat-select', 'epsilon-link');
  await page.fill('#regex-input', '(a|b)*a');
  await page.evaluate(() => { window.__buildDone = false; });
  await page.click('#build-button');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });
  await page.fill('#test-input', 'ba');
  await page.evaluate(() => { window.__runDone = false; });
  await page.click('#run-button');
  await page.waitForFunction('window.__runDone === true', null, { timeout: 15000 });
  const verdictBeforeRebuild = await page.textContent('#verdict');
  assert.strictEqual(verdictBeforeRebuild.trim(), 'ACCEPT');
  const traceBeforeRebuild = await page.textContent('#trace');
  assert(traceBeforeRebuild.length > 0);

  // (1) Change regex to a*b and Build
  await page.fill('#regex-input', 'a*b');
  await page.evaluate(() => { window.__buildDone = false; });
  await page.click('#build-button');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });

  const v1 = await page.textContent('#verdict');
  const t1 = await page.textContent('#trace');
  const s1 = await page.textContent('#run-status');
  const activeNodes1 = await page.$$eval('.node.active', (nodes) => nodes.length);
  const testInput1 = await page.$eval('#test-input', (el) => el.value);

  assert.strictEqual(v1.trim(), '', 'Action 1: #verdict must be empty after rebuilding with a*b');
  assert.strictEqual(t1.trim(), '', 'Action 1: #trace must be empty after rebuilding with a*b');
  assert.strictEqual(s1.trim(), '', 'Action 1: #run-status must be empty after rebuilding with a*b');
  assert.strictEqual(activeNodes1, 0, 'Action 1: zero .node.active elements must remain in canvas after rebuilding');
  assert.strictEqual(testInput1, 'ba', 'Action 1: #test-input must keep the user text');

  // (2) Run "b" on a*b, then pick binary-pattern preset
  await page.fill('#test-input', 'b');
  await page.evaluate(() => { window.__runDone = false; });
  await page.click('#run-button');
  await page.waitForFunction('window.__runDone === true', null, { timeout: 15000 });
  assert.strictEqual((await page.textContent('#verdict')).trim(), 'ACCEPT');

  await page.evaluate(() => { window.__buildDone = false; });
  await page.selectOption('#preset-select', 'binary-pattern');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });

  const v2 = await page.textContent('#verdict');
  const t2 = await page.textContent('#trace');
  const s2 = await page.textContent('#run-status');
  const activeNodes2 = await page.$$eval('.node.active', (nodes) => nodes.length);
  assert.strictEqual(v2.trim(), '', 'Action 2: #verdict must be empty after picking binary-pattern preset');
  assert.strictEqual(t2.trim(), '', 'Action 2: #trace must be empty after picking binary-pattern preset');
  assert.strictEqual(s2.trim(), '', 'Action 2: #run-status must be empty after picking binary-pattern preset');
  assert.strictEqual(activeNodes2, 0, 'Action 2: zero .node.active elements must remain in canvas after preset');

  // (3) Switch to merge on (a|b)*a and Build
  await page.selectOption('#notation-select', 'standard');
  await page.selectOption('#concat-select', 'epsilon-link');
  await page.fill('#regex-input', '(a|b)*a');
  await page.fill('#test-input', 'ba');
  await page.evaluate(() => { window.__buildDone = false; });
  await page.click('#build-button');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });
  await page.evaluate(() => { window.__runDone = false; });
  await page.click('#run-button');
  await page.waitForFunction('window.__runDone === true', null, { timeout: 15000 });
  assert.strictEqual((await page.textContent('#verdict')).trim(), 'ACCEPT');

  await page.selectOption('#concat-select', 'merge');
  await page.evaluate(() => { window.__buildDone = false; });
  await page.click('#build-button');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });

  const v3 = await page.textContent('#verdict');
  const t3 = await page.textContent('#trace');
  const s3 = await page.textContent('#run-status');
  const activeNodes3 = await page.$$eval('.node.active', (nodes) => nodes.length);
  const testInput3 = await page.$eval('#test-input', (el) => el.value);

  assert.strictEqual(v3.trim(), '', 'Action 3: #verdict must be empty after switching to merge and Build');
  assert.strictEqual(t3.trim(), '', 'Action 3: #trace must be empty after switching to merge and Build');
  assert.strictEqual(s3.trim(), '', 'Action 3: #run-status must be empty after switching to merge and Build');
  assert.strictEqual(activeNodes3, 0, 'Action 3: zero .node.active elements must remain in canvas after switching to merge');
  assert.strictEqual(testInput3, 'ba', 'Action 3: #test-input must keep the user text');

  // Scope C: Clear stale results and status on capped and early-return builds
  console.log('Testing Scope C: Clear stale results and status on early-return and capped builds...');

  async function setupScopeCPriorState() {
    await page.selectOption('#notation-select', 'standard');
    await page.selectOption('#concat-select', 'epsilon-link');
    await page.fill('#regex-input', 'ab');
    await page.evaluate(() => { window.__buildDone = false; });
    await page.click('#build-button');
    await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });

    // Stepped trace
    await page.click('#step-next');

    // Dead run
    await page.fill('#test-input', 'b');
    await page.click('#run-button');
    await page.waitForFunction('window.__runDone === true', null, { timeout: 15000 });
    // Click the dead trace step to activate the dead state on canvas
    await page.click('#trace .trace-step[data-step="1"]');
    await page.waitForFunction(() => document.querySelector('#canvas')?.getAttribute('data-run-status') === 'dead');

    // Final-view toggle
    await page.selectOption('#view-toggle', 'final');
    await page.waitForFunction(() => document.querySelector('#canvas')?.getAttribute('data-view') === 'final');

    // Ensure all attributes (data-current-step, data-view, data-run-status, viewport attrs) are present
    await page.evaluate(() => {
      const c = document.querySelector('#canvas');
      c?.setAttribute('data-current-step', '2');
      c?.setAttribute('data-zoom', '1.5000');
      c?.setAttribute('data-pan-x', '100.00');
      c?.setAttribute('data-pan-y', '50.00');
      c?.setAttribute('data-viewport-mode', 'manual');
    });

    const priorStep = await page.$eval('#canvas', (el) => el.getAttribute('data-current-step'));
    const priorView = await page.$eval('#canvas', (el) => el.getAttribute('data-view'));
    const priorRunStatus = await page.$eval('#canvas', (el) => el.getAttribute('data-run-status'));
    const priorZoom = await page.$eval('#canvas', (el) => el.getAttribute('data-zoom'));
    const priorPanX = await page.$eval('#canvas', (el) => el.getAttribute('data-pan-x'));
    const priorPanY = await page.$eval('#canvas', (el) => el.getAttribute('data-pan-y'));
    const priorMode = await page.$eval('#canvas', (el) => el.getAttribute('data-viewport-mode'));
    assert.strictEqual(priorStep, '2', 'Prior state must have data-current-step="2"');
    assert.strictEqual(priorView, 'final', 'Prior state must have data-view="final"');
    assert.strictEqual(priorRunStatus, 'dead', 'Prior state must have data-run-status="dead"');
    assert.strictEqual(priorZoom, '1.5000', 'Prior state must have data-zoom="1.5000"');
    assert.strictEqual(priorPanX, '100.00', 'Prior state must have data-pan-x="100.00"');
    assert.strictEqual(priorPanY, '50.00', 'Prior state must have data-pan-y="50.00"');
    assert.strictEqual(priorMode, 'manual', 'Prior state must have data-viewport-mode="manual"');
  }

  // 1. Capped build (>400 postfix tokens)
  await setupScopeCPriorState();
  await page.fill('#regex-input', 'a'.repeat(210));
  await page.evaluate(() => { window.__buildDone = false; });
  await page.click('#build-button');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });

  assert.strictEqual((await page.textContent('#verdict')).trim(), '', 'Capped build: #verdict must be empty');
  assert.strictEqual((await page.textContent('#trace')).trim(), '', 'Capped build: #trace must be empty');
  assert.strictEqual((await page.textContent('#run-status')).trim(), '', 'Capped build: #run-status must be empty');
  assert.strictEqual((await page.textContent('#step-counter')).trim(), 'step 0 / 0', 'Capped build: #step-counter must be reset to step 0 / 0');
  assert.strictEqual(await page.$eval('#canvas', (el) => el.getAttribute('data-current-step')), null, 'Capped build: canvas must not have data-current-step');
  assert.strictEqual(await page.$eval('#canvas', (el) => el.getAttribute('data-view')), null, 'Capped build: canvas must not have data-view');
  assert.strictEqual(await page.$eval('#canvas', (el) => el.getAttribute('data-run-status')), null, 'Capped build: canvas must not have data-run-status');
  assert.strictEqual(await page.$eval('#canvas', (el) => el.getAttribute('data-zoom')), null, 'Capped build: canvas must not have data-zoom');
  assert.strictEqual(await page.$eval('#canvas', (el) => el.getAttribute('data-pan-x')), null, 'Capped build: canvas must not have data-pan-x');
  assert.strictEqual(await page.$eval('#canvas', (el) => el.getAttribute('data-pan-y')), null, 'Capped build: canvas must not have data-pan-y');
  assert.strictEqual(await page.$eval('#canvas', (el) => el.getAttribute('data-viewport-mode')), null, 'Capped build: canvas must not have data-viewport-mode');
  assert.strictEqual(await page.$eval('#zoom-in-btn', (el) => el.disabled), true, 'Capped build: zoom-in button must be disabled');
  assert.strictEqual(await page.$eval('#zoom-out-btn', (el) => el.disabled), true, 'Capped build: zoom-out button must be disabled');
  assert.strictEqual(await page.$eval('#zoom-fit-btn', (el) => el.disabled), true, 'Capped build: zoom-fit button must be disabled');
  assert.strictEqual(await page.$eval('#zoom-reset-btn', (el) => el.disabled), true, 'Capped build: zoom-reset button must be disabled');

  // 2. Refused build: Engine token limit (>2,000 tokens)
  await setupScopeCPriorState();
  await page.fill('#regex-input', 'a'.repeat(2001));
  await page.evaluate(() => { window.__buildDone = false; });
  await page.click('#build-button');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });

  assert.strictEqual((await page.textContent('#verdict')).trim(), '', 'Refused 2000+ build: #verdict must be empty');
  assert.strictEqual((await page.textContent('#trace')).trim(), '', 'Refused 2000+ build: #trace must be empty');
  assert.strictEqual((await page.textContent('#run-status')).trim(), '', 'Refused 2000+ build: #run-status must be empty');
  assert.strictEqual((await page.textContent('#step-counter')).trim(), 'step 0 / 0', 'Refused 2000+ build: #step-counter must be reset to step 0 / 0');
  assert.strictEqual(await page.$eval('#canvas', (el) => el.getAttribute('data-current-step')), null, 'Refused 2000+ build: canvas must not have data-current-step');
  assert.strictEqual(await page.$eval('#canvas', (el) => el.getAttribute('data-view')), null, 'Refused 2000+ build: canvas must not have data-view');
  assert.strictEqual(await page.$eval('#canvas', (el) => el.getAttribute('data-run-status')), null, 'Refused 2000+ build: canvas must not have data-run-status');
  assert.strictEqual(await page.$eval('#canvas', (el) => el.getAttribute('data-zoom')), null, 'Refused 2000+ build: canvas must not have data-zoom');
  assert.strictEqual(await page.$eval('#canvas', (el) => el.getAttribute('data-pan-x')), null, 'Refused 2000+ build: canvas must not have data-pan-x');
  assert.strictEqual(await page.$eval('#canvas', (el) => el.getAttribute('data-pan-y')), null, 'Refused 2000+ build: canvas must not have data-pan-y');
  assert.strictEqual(await page.$eval('#canvas', (el) => el.getAttribute('data-viewport-mode')), null, 'Refused 2000+ build: canvas must not have data-viewport-mode');
  assert.strictEqual(await page.$eval('#zoom-in-btn', (el) => el.disabled), true, 'Refused 2000+ build: zoom-in button must be disabled');
  assert.strictEqual(await page.$eval('#zoom-out-btn', (el) => el.disabled), true, 'Refused 2000+ build: zoom-out button must be disabled');
  assert.strictEqual(await page.$eval('#zoom-fit-btn', (el) => el.disabled), true, 'Refused 2000+ build: zoom-fit button must be disabled');
  assert.strictEqual(await page.$eval('#zoom-reset-btn', (el) => el.disabled), true, 'Refused 2000+ build: zoom-reset button must be disabled');

  // 3. Refused build: Syntax error
  await setupScopeCPriorState();
  await page.fill('#regex-input', '(a|');
  await page.evaluate(() => { window.__buildDone = false; });
  await page.click('#build-button');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });

  assert.strictEqual((await page.textContent('#verdict')).trim(), '', 'Syntax error build: #verdict must be empty');
  assert.strictEqual((await page.textContent('#trace')).trim(), '', 'Syntax error build: #trace must be empty');
  assert.strictEqual((await page.textContent('#run-status')).trim(), '', 'Syntax error build: #run-status must be empty');
  assert.strictEqual((await page.textContent('#step-counter')).trim(), 'step 0 / 0', 'Syntax error build: #step-counter must be reset to step 0 / 0');
  assert.strictEqual(await page.$eval('#canvas', (el) => el.getAttribute('data-current-step')), null, 'Syntax error build: canvas must not have data-current-step');
  assert.strictEqual(await page.$eval('#canvas', (el) => el.getAttribute('data-view')), null, 'Syntax error build: canvas must not have data-view');
  assert.strictEqual(await page.$eval('#canvas', (el) => el.getAttribute('data-run-status')), null, 'Syntax error build: canvas must not have data-run-status');
  assert.strictEqual(await page.$eval('#canvas', (el) => el.getAttribute('data-zoom')), null, 'Syntax error build: canvas must not have data-zoom');
  assert.strictEqual(await page.$eval('#canvas', (el) => el.getAttribute('data-pan-x')), null, 'Syntax error build: canvas must not have data-pan-x');
  assert.strictEqual(await page.$eval('#canvas', (el) => el.getAttribute('data-pan-y')), null, 'Syntax error build: canvas must not have data-pan-y');
  assert.strictEqual(await page.$eval('#canvas', (el) => el.getAttribute('data-viewport-mode')), null, 'Syntax error build: canvas must not have data-viewport-mode');
  assert.strictEqual(await page.$eval('#zoom-in-btn', (el) => el.disabled), true, 'Syntax error build: zoom-in button must be disabled');
  assert.strictEqual(await page.$eval('#zoom-out-btn', (el) => el.disabled), true, 'Syntax error build: zoom-out button must be disabled');
  assert.strictEqual(await page.$eval('#zoom-fit-btn', (el) => el.disabled), true, 'Syntax error build: zoom-fit button must be disabled');
  assert.strictEqual(await page.$eval('#zoom-reset-btn', (el) => el.disabled), true, 'Syntax error build: zoom-reset button must be disabled');

  // ==========================================
  // Ticket 17: Zoom and Pan for diagram canvases
  // ==========================================
  console.log('Testing Ticket 17: Zoom and Pan for diagram canvases...');

  // Reset viewport size to default 1280x800
  await page.setViewportSize({ width: 1280, height: 800 });

  // AC2: No page overflow: documentElement.scrollWidth <= clientWidth at 1280x800 and 1920x1080
  console.log('Testing AC2: No page overflow...');
  // 1. 161-token final view
  const expr161 = '(a|b)'.repeat(40) + 'a';
  await page.fill('#regex-input', expr161);
  await page.click('#build-button');
  await page.waitForFunction(() => document.querySelector('#step-counter')?.textContent.includes('step 1 / 161'));
  await page.selectOption('#view-toggle', 'final');
  await page.waitForFunction(() => document.querySelector('#canvas')?.getAttribute('data-view') === 'final');

  for (const vp of [{ width: 1280, height: 800 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(vp);
    const hasHOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    assert.strictEqual(hasHOverflow, false, `161-token final view must not have horizontal overflow at ${vp.width}x${vp.height}`);
  }

  // 2. Real worst case allowed: 'a'.repeat(200) has 200 symbols and 199 implicit concatenations,
  // totaling 200 + 199 = 399 postfix tokens. Because 150 < 399 <= 400 (CAPS.textbookStepping),
  // flat stepping is disabled, but textbook stepping and the final NFA view remain allowed.
  const expr399 = 'a'.repeat(200);
  for (const vp of [{ width: 1280, height: 800 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(vp);
    await page.fill('#regex-input', expr399);
    await page.click('#build-button');
    await page.waitForFunction(() => document.querySelector('#step-counter')?.textContent.includes('step 1 / 399'));
    await page.selectOption('#view-toggle', 'final');
    await page.waitForFunction(() => document.querySelector('#canvas')?.getAttribute('data-view') === 'final');

    const hasHOverflow399 = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    assert.strictEqual(hasHOverflow399, false, `399-token final view must not have horizontal overflow at ${vp.width}x${vp.height}`);
    const mode399 = await page.$eval('#canvas', (el) => el.getAttribute('data-viewport-mode'));
    assert.strictEqual(mode399, 'start', `399-token final view initial mode must be start at ${vp.width}x${vp.height}`);
    const zoom399 = await page.$eval('#canvas', (el) => el.getAttribute('data-zoom'));
    assert.strictEqual(zoom399, '1.0000', `399-token final view initial zoom must be 1.0000 at ${vp.width}x${vp.height}`);

    await page.click('#zoom-fit-btn');
    const svgInside = await page.evaluate(() => {
      const canvas = document.getElementById('canvas');
      const svg = document.querySelector('#canvas-viewport svg');
      if (!canvas || !svg) return false;
      const c = canvas.getBoundingClientRect();
      const s = svg.getBoundingClientRect();
      return s.left >= c.left - 1 && s.right <= c.right + 1 && s.top >= c.top - 1 && s.bottom <= c.bottom + 1;
    });
    assert.strictEqual(svgInside, true, `399-token final view SVG rect must be inside frame after Fit at ${vp.width}x${vp.height}`);
  }

  // 3. Above the cap, message view, no overflow: 'a'.repeat(400) = 400 symbols + 399 concats = 799 postfix tokens (> 400 limit)
  const exprCap799 = 'a'.repeat(400);
  await page.fill('#regex-input', exprCap799);
  await page.click('#build-button');
  await page.waitForFunction(() => document.querySelector('#canvas')?.textContent.includes('Diagram is disabled'));
  for (const vp of [{ width: 1280, height: 800 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(vp);
    const hasHOverflowCap = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    assert.strictEqual(hasHOverflowCap, false, `Above-the-cap message view must not have horizontal overflow at ${vp.width}x${vp.height}`);
  }

  // 4. Textbook last step at the cap (161 postfix tokens)
  await page.fill('#regex-input', expr161);
  await page.click('#build-button');
  await page.waitForFunction(() => document.querySelector('#step-counter')?.textContent.includes('step 1 / 161'));
  await page.selectOption('#view-toggle', 'textbook');
  await page.click('#step-last');
  await page.waitForFunction(() => {
    const text = document.querySelector('#step-counter')?.textContent || '';
    const m = /step\s+(\d+)\s*\/\s*(\d+)/.exec(text);
    return m && m[1] === m[2] && m[1] === '161';
  });
  for (const vp of [{ width: 1280, height: 800 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(vp);
    const hasHOverflow150 = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    assert.strictEqual(hasHOverflow150, false, `Textbook last step must not have horizontal overflow at ${vp.width}x${vp.height}`);
  }
  await page.setViewportSize({ width: 1280, height: 800 });

  // AC3: Initial view modes per D4
  console.log('Testing AC3: Initial view modes per D4...');
  // 1. 161-token final view: fitZoom < 0.5 -> mode start, zoom 1.0000, start state fully inside frame
  await page.fill('#regex-input', expr161);
  await page.click('#build-button');
  await page.waitForFunction(() => document.querySelector('#step-counter')?.textContent.includes('step 1 / 161'));
  await page.selectOption('#view-toggle', 'final');
  await page.waitForFunction(() => document.querySelector('#canvas')?.getAttribute('data-view') === 'final');

  const mode161 = await page.$eval('#canvas', (el) => el.getAttribute('data-viewport-mode'));
  const zoom161 = await page.$eval('#canvas', (el) => el.getAttribute('data-zoom'));
  assert.strictEqual(mode161, 'start', '161-token final view initial mode must be start');
  assert.strictEqual(zoom161, '1.0000', '161-token final view initial zoom must be 1.0000');

  // Verify start state is inside frame bounds
  const startStateInside = await page.evaluate(() => {
    const canvas = document.getElementById('canvas');
    const n0 = document.querySelector('#canvas svg g.node[id="n0"]') || document.querySelector('#canvas svg g.node[data-created-by-step]');
    if (!canvas || !n0) return false;
    const cBox = canvas.getBoundingClientRect();
    const nBox = n0.getBoundingClientRect();
    return nBox.left >= cBox.left && nBox.right <= cBox.right && nBox.top >= cBox.top && nBox.bottom <= cBox.bottom;
  });
  assert.strictEqual(startStateInside, true, 'Start state must be inside canvas frame in start mode');

  // 2. Moderately oversized diagram (fitZoom >= 0.5): (a|b)*a
  await page.fill('#regex-input', '(a|b)*a');
  await page.click('#build-button');
  await page.waitForFunction(() => document.querySelector('#step-counter')?.textContent.includes('step 1 / 6'));
  await page.selectOption('#view-toggle', 'final');
  await page.waitForFunction(() => document.querySelector('#canvas')?.getAttribute('data-view') === 'final');

  const modeMed = await page.$eval('#canvas', (el) => el.getAttribute('data-viewport-mode'));
  const zoomMed = parseFloat(await page.$eval('#canvas', (el) => el.getAttribute('data-zoom')));
  assert.strictEqual(modeMed, 'fit', '(a|b)*a final view initial mode must be fit');
  assert(zoomMed >= 0.5 && zoomMed <= 1.0, `(a|b)*a fitZoom must be between 0.5 and 1.0, got ${zoomMed}`);

  // 3. Small diagram: a (content smaller than frame -> zoom 1.0000, mode fit, centered)
  await page.fill('#regex-input', 'a');
  await page.click('#build-button');
  await page.waitForFunction(() => document.querySelector('#step-counter')?.textContent.includes('step 1 / 1'));
  const modeSmall = await page.$eval('#canvas', (el) => el.getAttribute('data-viewport-mode'));
  const zoomSmall = await page.$eval('#canvas', (el) => el.getAttribute('data-zoom'));
  const panXSmall = parseFloat(await page.$eval('#canvas', (el) => el.getAttribute('data-pan-x')));
  const panYSmall = parseFloat(await page.$eval('#canvas', (el) => el.getAttribute('data-pan-y')));
  assert.strictEqual(modeSmall, 'fit', 'Small diagram mode must be fit');
  assert.strictEqual(zoomSmall, '1.0000', 'Small diagram zoom must be 1.0000');
  assert(panXSmall > 0, `Small diagram must be horizontally centered (panX > 0, got ${panXSmall})`);
  assert(panYSmall > 0, `Small diagram must be vertically centered (panY > 0, got ${panYSmall})`);

  // AC4: Fit reaches full fit below 0.1
  console.log('Testing AC4: Fit reaches full fit below 0.1...');
  await page.fill('#regex-input', expr161);
  await page.click('#build-button');
  await page.waitForFunction(() => document.querySelector('#step-counter')?.textContent.includes('step 1 / 161'));
  await page.selectOption('#view-toggle', 'final');
  await page.waitForFunction(() => document.querySelector('#canvas')?.getAttribute('data-view') === 'final');

  await page.click('#zoom-fit-btn');
  const fitModeAfter = await page.$eval('#canvas', (el) => el.getAttribute('data-viewport-mode'));
  const fitZoomAfter = parseFloat(await page.$eval('#canvas', (el) => el.getAttribute('data-zoom')));
  assert.strictEqual(fitModeAfter, 'fit', 'After Fit button, mode must be fit');
  assert(fitZoomAfter < 0.1, `Fit zoom on 161 tokens must reach below 0.1, got ${fitZoomAfter}`);

  // SVG bounding rect must be entirely inside frame rect
  const svgInsideFrame = await page.evaluate(() => {
    const canvas = document.getElementById('canvas');
    const svg = document.querySelector('#canvas-viewport svg');
    if (!canvas || !svg) return false;
    const c = canvas.getBoundingClientRect();
    const s = svg.getBoundingClientRect();
    return s.left >= c.left - 1 && s.right <= c.right + 1 && s.top >= c.top - 1 && s.bottom <= c.bottom + 1;
  });
  assert.strictEqual(svgInsideFrame, true, 'SVG rect must be completely inside canvas frame after Fit');

  // AC5: Real transform matches state
  console.log('Testing AC5: Real transform matches state...');
  await page.fill('#regex-input', '(a|b)*a');
  await page.click('#build-button');
  await page.waitForFunction(() => document.querySelector('#step-counter')?.textContent.includes('step 1 / 6'));

  const matrixMatches = await page.evaluate(() => {
    const canvas = document.getElementById('canvas');
    const vp = document.getElementById('canvas-viewport');
    if (!canvas || !vp) return false;
    const z = parseFloat(canvas.getAttribute('data-zoom') || '1');
    const px = parseFloat(canvas.getAttribute('data-pan-x') || '0');
    const py = parseFloat(canvas.getAttribute('data-pan-y') || '0');
    const transform = window.getComputedStyle(vp).transform;
    const m = /matrix\(([^)]+)\)/.exec(transform);
    if (!m) return false;
    const vals = m[1].split(',').map((v) => parseFloat(v.trim()));
    return Math.abs(vals[0] - z) < 1e-3 && Math.abs(vals[3] - z) < 1e-3 &&
           Math.abs(vals[4] - px) < 1e-2 && Math.abs(vals[5] - py) < 1e-2;
  });
  assert.strictEqual(matrixMatches, true, 'CSS transform matrix must match data-zoom and data-pan attributes');

  // getBoundingClientRect moves as predicted by math after button zoom
  const rectCheck = await page.evaluate(async () => {
    const node = document.querySelector('#canvas svg g.node[id="n0"]');
    const canvas = document.getElementById('canvas');
    if (!node || !canvas) return null;
    const r0 = node.getBoundingClientRect();
    const c = canvas.getBoundingClientRect();
    const cx = c.width / 2;
    // Click zoom in button
    document.getElementById('zoom-in-btn')?.click();
    const r1 = node.getBoundingClientRect();
    const expectedCenterX = (c.left + cx) + (r0.left + r0.width / 2 - (c.left + cx)) * 1.2;
    const actualCenterX = r1.left + r1.width / 2;
    const expectedW = r0.width * 1.2;
    const actualW = r1.width;
    document.getElementById('zoom-reset-btn')?.click();
    return {
      diffCenterX: Math.abs(actualCenterX - expectedCenterX),
      diffW: Math.abs(actualW - expectedW)
    };
  });
  assert(rectCheck !== null && rectCheck.diffCenterX < 1.0, 'State node center must move as predicted by zoom math');
  assert(rectCheck !== null && rectCheck.diffW < 1.0, 'State node width must scale by 1.2 as predicted by zoom math');

  // AC6: Buttons: x1.2 in, /1.2 out, 100%, disabled at limits
  console.log('Testing AC6: Buttons...');
  await page.fill('#regex-input', 'ab');
  await page.click('#build-button');
  await page.waitForFunction(() => document.querySelector('#step-counter')?.textContent.includes('step 1 / 3'));

  const initialZoom = parseFloat(await page.$eval('#canvas', (el) => el.getAttribute('data-zoom')));
  await page.click('#zoom-in-btn');
  const zoomedIn = parseFloat(await page.$eval('#canvas', (el) => el.getAttribute('data-zoom')));
  assert.strictEqual(Math.round(zoomedIn * 1000) / 1000, Math.round(initialZoom * 1.2 * 1000) / 1000, 'Zoom in button must multiply zoom by 1.2');
  assert.strictEqual((await page.textContent('#zoom-level')).trim(), `${Math.round(zoomedIn * 100)}%`);

  await page.click('#zoom-out-btn');
  const zoomedOut = parseFloat(await page.$eval('#canvas', (el) => el.getAttribute('data-zoom')));
  assert.strictEqual(Math.round(zoomedOut * 1000) / 1000, Math.round(initialZoom * 1000) / 1000, 'Zoom out button must divide zoom by 1.2');

  await page.click('#zoom-reset-btn');
  const resetZoom = await page.$eval('#canvas', (el) => el.getAttribute('data-zoom'));
  assert.strictEqual(resetZoom, '1.0000', '100% button must reset zoom to 1.0000');

  // Zoom in to max zoom (10.0): zoom-in button must become disabled
  for (let i = 0; i < 15; i++) {
    const disabled = await page.$eval('#zoom-in-btn', (el) => el.disabled);
    if (disabled) break;
    await page.click('#zoom-in-btn');
  }
  const maxZoomVal = parseFloat(await page.$eval('#canvas', (el) => el.getAttribute('data-zoom')));
  assert(Math.abs(maxZoomVal - 10.0) < 1e-3, `Zoom must reach max zoom 10.0, got ${maxZoomVal}`);
  assert.strictEqual(await page.$eval('#zoom-in-btn', (el) => el.disabled), true, 'Zoom in button must be disabled at max zoom');
  assert.strictEqual((await page.textContent('#zoom-level')).trim(), '1000%', 'Zoom level text must show 1000% at max zoom');

  // Clicking zoom out re-enables zoom in
  await page.click('#zoom-out-btn');
  assert.strictEqual(await page.$eval('#zoom-in-btn', (el) => el.disabled), false, 'Zoom in button must be re-enabled after zooming out from max');

  // Rebuild to restore clean initial state for AC7
  await page.click('#build-button');
  await page.waitForFunction(() => document.querySelector('#step-counter')?.textContent.includes('step 1 / 3'));

  // AC7: Wheel: Ctrl+wheel zooms about cursor; plain wheel not intercepted; Shift/horizontal wheel pans
  console.log('Testing AC7: Wheel...');
  const zBeforePlain = await page.$eval('#canvas', (el) => el.getAttribute('data-zoom'));
  const panXBeforePlain = await page.$eval('#canvas', (el) => el.getAttribute('data-pan-x'));
  const panYBeforePlain = await page.$eval('#canvas', (el) => el.getAttribute('data-pan-y'));
  const plainWheelResult = await page.evaluate(() => {
    const canvas = document.getElementById('canvas');
    const evt = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
    canvas.dispatchEvent(evt);
    return { defaultPrevented: evt.defaultPrevented };
  });
  assert.strictEqual(plainWheelResult.defaultPrevented, false, 'Plain vertical wheel must NOT be defaultPrevented');
  assert.strictEqual(await page.$eval('#canvas', (el) => el.getAttribute('data-zoom')), zBeforePlain, 'Plain vertical wheel must not change zoom');
  assert.strictEqual(await page.$eval('#canvas', (el) => el.getAttribute('data-pan-x')), panXBeforePlain, 'Plain vertical wheel must not change pan-x');
  assert.strictEqual(await page.$eval('#canvas', (el) => el.getAttribute('data-pan-y')), panYBeforePlain, 'Plain vertical wheel must not change pan-y');

  // Ctrl+wheel with cursor on state center keeps node center within 1 px
  const focalCheck = await page.evaluate(() => {
    const canvas = document.getElementById('canvas');
    const node = document.querySelector('#canvas svg g.node[id="n0"]') || document.querySelector('#canvas svg g.node');
    if (!canvas || !node) return null;
    const r0 = node.getBoundingClientRect();
    const cx0 = r0.left + r0.width / 2;
    const cy0 = r0.top + r0.height / 2;

    const evt = new WheelEvent('wheel', {
      deltaY: -100,
      ctrlKey: true,
      clientX: cx0,
      clientY: cy0,
      bubbles: true,
      cancelable: true
    });
    canvas.dispatchEvent(evt);

    const r1 = node.getBoundingClientRect();
    const cx1 = r1.left + r1.width / 2;
    const cy1 = r1.top + r1.height / 2;
    return {
      defaultPrevented: evt.defaultPrevented,
      diffX: Math.abs(cx1 - cx0),
      diffY: Math.abs(cy1 - cy0)
    };
  });
  assert(focalCheck !== null && focalCheck.defaultPrevented, 'Ctrl+wheel must be defaultPrevented');
  assert(focalCheck !== null && focalCheck.diffX <= 1.0, `Ctrl+wheel focal point X must keep node center within 1 px, drift was ${focalCheck?.diffX}`);
  assert(focalCheck !== null && focalCheck.diffY <= 1.0, `Ctrl+wheel focal point Y must keep node center within 1 px, drift was ${focalCheck?.diffY}`);
  const zAfterCtrl = parseFloat(await page.$eval('#canvas', (el) => el.getAttribute('data-zoom')));
  assert(zAfterCtrl > parseFloat(zBeforePlain), 'Ctrl+wheel with negative deltaY must zoom in');

  // Shift+wheel pans
  const panXBefore = parseFloat(await page.$eval('#canvas', (el) => el.getAttribute('data-pan-x')));
  const shiftWheelResult = await page.evaluate(() => {
    const canvas = document.getElementById('canvas');
    const evt = new WheelEvent('wheel', { deltaY: 50, shiftKey: true, bubbles: true, cancelable: true });
    canvas.dispatchEvent(evt);
    return { defaultPrevented: evt.defaultPrevented };
  });
  assert.strictEqual(shiftWheelResult.defaultPrevented, true, 'Shift+wheel must be defaultPrevented');
  const panXAfter = parseFloat(await page.$eval('#canvas', (el) => el.getAttribute('data-pan-x')));
  assert.strictEqual(panXAfter, panXBefore - 50, 'Shift+wheel must pan X');

  // Horizontal wheel pans X (|deltaX| > |deltaY|)
  const horizPanBefore = parseFloat(await page.$eval('#canvas', (el) => el.getAttribute('data-pan-x')));
  const horizWheelResult = await page.evaluate(() => {
    const canvas = document.getElementById('canvas');
    const evt = new WheelEvent('wheel', { deltaX: 40, deltaY: 0, bubbles: true, cancelable: true });
    canvas.dispatchEvent(evt);
    return { defaultPrevented: evt.defaultPrevented };
  });
  assert.strictEqual(horizWheelResult.defaultPrevented, true, 'Horizontal wheel must be defaultPrevented');
  const horizPanAfter = parseFloat(await page.$eval('#canvas', (el) => el.getAttribute('data-pan-x')));
  assert.strictEqual(horizPanAfter, horizPanBefore - 40, 'Horizontal wheel must pan X by -deltaX');

  // AC8: Drag pan
  console.log('Testing AC8: Drag pan...');
  await page.click('#zoom-reset-btn');
  const pX0 = parseFloat(await page.$eval('#canvas', (el) => el.getAttribute('data-pan-x')));
  const pY0 = parseFloat(await page.$eval('#canvas', (el) => el.getAttribute('data-pan-y')));

  const canvasBox = await page.locator('#canvas').boundingBox();
  await page.mouse.move(canvasBox.x + 200, canvasBox.y + 200);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + 250, canvasBox.y + 230);
  await page.mouse.up();

  const pX1 = parseFloat(await page.$eval('#canvas', (el) => el.getAttribute('data-pan-x')));
  const pY1 = parseFloat(await page.$eval('#canvas', (el) => el.getAttribute('data-pan-y')));
  assert.strictEqual(Math.round(pX1 - pX0), 50, 'Drag pan must shift pan-x by exact mouse delta dx');
  assert.strictEqual(Math.round(pY1 - pY0), 30, 'Drag pan must shift pan-y by exact mouse delta dy');
  const selText = await page.evaluate(() => window.getSelection()?.toString() || '');
  assert.strictEqual(selText, '', 'No text must be selected after drag pan');

  // AC9: Persistence per D5
  console.log('Testing AC9: Persistence per D5...');
  await page.fill('#regex-input', '(a|b)*a');
  await page.click('#build-button');
  await page.waitForFunction(() => document.querySelector('#step-counter')?.textContent.includes('step 1 / 6'));

  await page.click('#zoom-in-btn');
  const zoomStep1 = await page.$eval('#canvas', (el) => el.getAttribute('data-zoom'));
  const panXStep1 = await page.$eval('#canvas', (el) => el.getAttribute('data-pan-x'));

  // Step 2 in flat pinned layout (identical viewBox) -> persist
  await page.click('#step-next');
  await page.waitForFunction(() => document.querySelector('#step-counter')?.textContent.includes('step 2 / 6'));
  const zoomStep2 = await page.$eval('#canvas', (el) => el.getAttribute('data-zoom'));
  const panXStep2 = await page.$eval('#canvas', (el) => el.getAttribute('data-pan-x'));
  assert.strictEqual(zoomStep2, zoomStep1, 'Flat pinned stepping must persist zoom across steps with same viewBox');
  assert.strictEqual(panXStep2, panXStep1, 'Flat pinned stepping must persist pan-x across steps with same viewBox');

  // Switch to textbook view (viewBox changes from 823x349 to 316x102) -> initialView applied
  await page.selectOption('#view-toggle', 'textbook');
  await page.waitForFunction(() => document.querySelector('#step-counter')?.textContent.includes('step'));
  const modeTextbook = await page.$eval('#canvas', (el) => el.getAttribute('data-viewport-mode'));
  assert.strictEqual(modeTextbook, 'fit', 'Switching to textbook view with different viewBox must apply initial view');

  // Textbook stepping: viewBox changes on each step -> initialView applied
  await page.click('#zoom-in-btn');
  assert.strictEqual(await page.$eval('#canvas', (el) => el.getAttribute('data-viewport-mode')), 'manual');
  await page.click('#step-next');
  await page.waitForFunction(() => document.querySelector('#step-counter')?.textContent.includes('step 3 / 6'));
  const modeTextbookStep3 = await page.$eval('#canvas', (el) => el.getAttribute('data-viewport-mode'));
  assert.strictEqual(modeTextbookStep3, 'fit', 'Textbook stepping must re-initialize view when viewBox changes');

  // Final view with compact toggle: viewBox is identical (823x349 in merge mode) -> persists zoom and manual mode
  await page.selectOption('#concat-select', 'merge');
  await page.fill('#regex-input', '(a|b)*a');
  await page.click('#build-button');
  await page.waitForFunction(() => document.querySelector('#step-counter')?.textContent.includes('step 1 / 6'));
  await page.selectOption('#view-toggle', 'final');
  await page.waitForFunction(() => document.querySelector('#canvas')?.getAttribute('data-view') === 'final');
  await page.click('#zoom-in-btn');
  assert.strictEqual(await page.$eval('#canvas', (el) => el.getAttribute('data-viewport-mode')), 'manual');
  const zoomBeforeCompact = await page.$eval('#canvas', (el) => el.getAttribute('data-zoom'));
  await page.click('#compact-labels');
  await page.waitForFunction(() => document.querySelector('#canvas svg g.node#n9 text')?.textContent?.trim() === '8');
  const modeAfterCompact = await page.$eval('#canvas', (el) => el.getAttribute('data-viewport-mode'));
  const zoomAfterCompact = await page.$eval('#canvas', (el) => el.getAttribute('data-zoom'));
  assert.strictEqual(modeAfterCompact, 'manual', 'Compact toggle with identical viewBox must persist manual mode');
  assert.strictEqual(zoomAfterCompact, zoomBeforeCompact, 'Compact toggle with identical viewBox must persist zoom');
  await page.click('#compact-labels'); // restore uncheck
  await page.waitForFunction(() => document.querySelector('#canvas svg g.node#n9 text')?.textContent?.trim() === '9');
  await page.selectOption('#concat-select', 'epsilon-link'); // restore default

  // AC10: Resets on rebuild
  console.log('Testing AC10: Resets on rebuild...');
  await page.click('#zoom-in-btn');
  assert.strictEqual(await page.$eval('#canvas', (el) => el.getAttribute('data-viewport-mode')), 'manual');
  await page.click('#build-button');
  await page.waitForFunction(() => document.querySelector('#step-counter')?.textContent.includes('step 1 / 6'));
  assert.strictEqual(await page.$eval('#canvas', (el) => el.getAttribute('data-viewport-mode')), 'fit', 'Rebuild must reset viewport to fit mode');
  const zoomAfterRebuild = await page.$eval('#canvas', (el) => el.getAttribute('data-zoom'));
  assert.strictEqual(zoomAfterRebuild, '1.0000', 'New build must reset zoom to default');

  await page.fill('#regex-input', '');
  await page.click('#build-button');
  await page.waitForFunction(() => document.querySelector('#error-message')?.textContent.includes('Enter a regular expression'));
  assert.strictEqual(await page.$eval('#canvas', (el) => el.getAttribute('data-zoom')), null, 'Empty rebuild must remove data-zoom');
  assert.strictEqual(await page.$eval('#canvas', (el) => el.getAttribute('data-pan-x')), null, 'Empty rebuild must remove data-pan-x');
  assert.strictEqual(await page.$eval('#canvas', (el) => el.getAttribute('data-pan-y')), null, 'Empty rebuild must remove data-pan-y');
  assert.strictEqual(await page.$eval('#canvas', (el) => el.getAttribute('data-viewport-mode')), null, 'Empty rebuild must remove data-viewport-mode');
  assert.strictEqual(await page.$eval('#zoom-in-btn', (el) => el.disabled), true, 'Empty rebuild must disable zoom-in button');
  assert.strictEqual(await page.$eval('#zoom-out-btn', (el) => el.disabled), true, 'Empty rebuild must disable zoom-out button');
  assert.strictEqual(await page.$eval('#zoom-fit-btn', (el) => el.disabled), true, 'Empty rebuild must disable zoom-fit button');
  assert.strictEqual(await page.$eval('#zoom-reset-btn', (el) => el.disabled), true, 'Empty rebuild must disable zoom-reset button');

  // Reset on notation change
  await page.selectOption('#notation-select', 'standard');
  await page.fill('#regex-input', 'ab');
  await page.click('#build-button');
  await page.waitForFunction(() => document.querySelector('#step-counter')?.textContent.includes('step 1 / 3'));
  await page.click('#zoom-in-btn');
  assert.strictEqual(await page.$eval('#canvas', (el) => el.getAttribute('data-viewport-mode')), 'manual');
  await page.selectOption('#notation-select', 'textbook');
  await page.waitForFunction(() => document.querySelector('#notation-select')?.value === 'textbook');
  assert.strictEqual(await page.$eval('#canvas', (el) => el.getAttribute('data-viewport-mode')), 'fit', 'Notation change must reset viewport to fit mode');
  await page.selectOption('#notation-select', 'standard'); // restore
  await page.waitForFunction(() => document.querySelector('#notation-select')?.value === 'standard');

  // Reset on concatenation change
  await page.click('#zoom-in-btn');
  assert.strictEqual(await page.$eval('#canvas', (el) => el.getAttribute('data-viewport-mode')), 'manual');
  await page.selectOption('#concat-select', 'merge');
  await page.waitForFunction(() => document.querySelector('#stats')?.textContent.includes('3'));
  assert.strictEqual(await page.$eval('#canvas', (el) => el.getAttribute('data-viewport-mode')), 'fit', 'Concatenation change must reset viewport to fit mode');
  await page.selectOption('#concat-select', 'epsilon-link'); // restore
  await page.waitForFunction(() => document.querySelector('#stats')?.textContent.includes('4'));

  // Reset on preset
  await page.click('#zoom-in-btn');
  assert.strictEqual(await page.$eval('#canvas', (el) => el.getAttribute('data-viewport-mode')), 'manual');
  await page.selectOption('#preset-select', 'star-b');
  await page.waitForFunction(() => document.querySelector('#regex-input')?.value === 'a*b');
  assert.strictEqual(await page.$eval('#canvas', (el) => el.getAttribute('data-viewport-mode')), 'fit', 'Preset selection must reset viewport to fit mode');

  // AC11: Keyboard
  console.log('Testing AC11: Keyboard...');
  await page.fill('#regex-input', '(a|b)*a');
  await page.click('#build-button');
  await page.waitForFunction(() => document.querySelector('#step-counter')?.textContent.includes('step 1 / 6'));
  await page.focus('#canvas');

  // + zooms in
  const zBeforePlus = parseFloat(await page.$eval('#canvas', (el) => el.getAttribute('data-zoom')));
  await page.keyboard.press('+');
  const zAfterPlus = parseFloat(await page.$eval('#canvas', (el) => el.getAttribute('data-zoom')));
  assert(zAfterPlus > zBeforePlus, 'Keyboard + must zoom in');

  // = zooms in
  await page.keyboard.press('=');
  const zAfterEqual = parseFloat(await page.$eval('#canvas', (el) => el.getAttribute('data-zoom')));
  assert(zAfterEqual > zAfterPlus, 'Keyboard = must zoom in');

  // - zooms out
  await page.keyboard.press('-');
  const zAfterMinus = parseFloat(await page.$eval('#canvas', (el) => el.getAttribute('data-zoom')));
  assert(zAfterMinus < zAfterEqual, 'Keyboard - must zoom out');

  // _ zooms out
  await page.keyboard.press('_');
  const zAfterUnderscore = parseFloat(await page.$eval('#canvas', (el) => el.getAttribute('data-zoom')));
  assert(zAfterUnderscore < zAfterMinus, 'Keyboard _ must zoom out');

  // 0 resets to 100%
  await page.keyboard.press('0');
  assert.strictEqual(await page.$eval('#canvas', (el) => el.getAttribute('data-zoom')), '1.0000', 'Keyboard 0 must reset to 100%');

  // f fits to container
  await page.keyboard.press('+');
  assert.strictEqual(await page.$eval('#canvas', (el) => el.getAttribute('data-viewport-mode')), 'manual');
  await page.keyboard.press('f');
  assert.strictEqual(await page.$eval('#canvas', (el) => el.getAttribute('data-viewport-mode')), 'fit', 'Keyboard f must fit to container');

  // Shift+ArrowLeft pans X positively (to the right)
  const panXBeforeShiftLeft = parseFloat(await page.$eval('#canvas', (el) => el.getAttribute('data-pan-x')));
  await page.keyboard.press('Shift+ArrowLeft');
  const panXAfterShiftLeft = parseFloat(await page.$eval('#canvas', (el) => el.getAttribute('data-pan-x')));
  assert(panXAfterShiftLeft > panXBeforeShiftLeft, 'Shift+ArrowLeft must pan X positively');

  // Shift+ArrowRight pans X negatively (to the left) and does NOT step
  const panXKbdBefore = parseFloat(await page.$eval('#canvas', (el) => el.getAttribute('data-pan-x')));
  await page.keyboard.press('Shift+ArrowRight');
  const panXKbdAfter = parseFloat(await page.$eval('#canvas', (el) => el.getAttribute('data-pan-x')));
  assert(panXKbdAfter < panXKbdBefore, 'Shift+ArrowRight must pan X');
  assert((await page.textContent('#step-counter')).includes('step 1 / 6'), 'Shift+ArrowRight must NOT step construction');

  // Shift+ArrowUp pans Y positively
  const panYBeforeShiftUp = parseFloat(await page.$eval('#canvas', (el) => el.getAttribute('data-pan-y')));
  await page.keyboard.press('Shift+ArrowUp');
  const panYAfterShiftUp = parseFloat(await page.$eval('#canvas', (el) => el.getAttribute('data-pan-y')));
  assert(panYAfterShiftUp > panYBeforeShiftUp, 'Shift+ArrowUp must pan Y positively');

  // Shift+ArrowDown pans Y negatively
  const panYBeforeShiftDown = parseFloat(await page.$eval('#canvas', (el) => el.getAttribute('data-pan-y')));
  await page.keyboard.press('Shift+ArrowDown');
  const panYAfterShiftDown = parseFloat(await page.$eval('#canvas', (el) => el.getAttribute('data-pan-y')));
  assert(panYAfterShiftDown < panYBeforeShiftDown, 'Shift+ArrowDown must pan Y negatively');

  // Plain ArrowRight steps construction
  await page.keyboard.press('ArrowRight');
  assert((await page.textContent('#step-counter')).includes('step 2 / 6'), 'Plain ArrowRight must step construction');

  // Alt+ArrowLeft is not defaultPrevented
  const altArrowResult = await page.evaluate(() => {
    const evt = new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(evt);
    return { defaultPrevented: evt.defaultPrevented };
  });
  assert.strictEqual(altArrowResult.defaultPrevented, false, 'Alt+ArrowLeft must not be defaultPrevented');

  // AC12: Hit-testing and tooltips survive transforms
  console.log('Testing AC12: Hit-testing and tooltips survive transforms...');
  await page.click('#zoom-reset-btn');
  const hitTestInfo = await page.evaluate(() => {
    const n0 = document.querySelector('#canvas svg g.node[id="n0"]') || document.querySelector('#canvas svg g.node[data-created-by-step]');
    if (!n0) return { error: 'no n0 found' };
    const box = n0.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const elAtPoint = document.elementFromPoint(cx, cy);
    const inNode = n0.contains(elAtPoint) || elAtPoint === n0;
    const hasTitle = !!n0.getAttribute('title') || !!n0.querySelector('title');
    const hasCreatedBy = n0.hasAttribute('data-created-by-step');
    return {
      n0Id: n0.id,
      cx, cy,
      elAtPointTag: elAtPoint?.tagName,
      elAtPointId: elAtPoint?.id,
      inNode,
      hasTitle,
      hasCreatedBy
    };
  });
  console.log('Hit-test info:', hitTestInfo);
  assert.strictEqual(hitTestInfo.inNode, true, 'Element at point must be inside node');
  assert.strictEqual(hitTestInfo.hasTitle, true, 'Node must have title');
  assert.strictEqual(hitTestInfo.hasCreatedBy, true, 'Node must have data-created-by-step');

  // AC13: Zero re-renders
  console.log('Testing AC13: Zero re-renders...');
  const renderCallsInitial = await page.evaluate(() => window.__harnessRenderCalls.length);
  await page.fill('#regex-input', 'ab');
  await page.click('#build-button');
  await page.waitForFunction(() => document.querySelector('#step-counter')?.textContent.includes('step 1 / 3'));
  const renderCallsAfterBuild = await page.evaluate(() => window.__harnessRenderCalls.length);
  assert(renderCallsAfterBuild > renderCallsInitial, 'Fresh build must increment harness render-call count');

  const renderCallsBefore = renderCallsAfterBuild;
  await page.click('#zoom-in-btn');
  await page.click('#zoom-out-btn');
  await page.click('#zoom-fit-btn');
  await page.keyboard.press('Shift+ArrowLeft');
  // Ctrl+wheel
  await page.evaluate(() => {
    const canvas = document.getElementById('canvas');
    canvas?.dispatchEvent(new WheelEvent('wheel', { deltaY: -50, ctrlKey: true, clientX: 200, clientY: 200, bubbles: true, cancelable: true }));
  });
  // Horizontal wheel
  await page.evaluate(() => {
    const canvas = document.getElementById('canvas');
    canvas?.dispatchEvent(new WheelEvent('wheel', { deltaX: 50, deltaY: 0, bubbles: true, cancelable: true }));
  });
  // Pointer drag
  const box = await page.locator('#canvas').boundingBox();
  if (box) {
    await page.mouse.move(box.x + 100, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + 120);
    await page.mouse.up();
  }
  const renderCallsAfter = await page.evaluate(() => window.__harnessRenderCalls.length);
  assert.strictEqual(renderCallsAfter, renderCallsBefore, 'Zoom, pan, wheel, drag and keyboard actions must never trigger Graphviz render calls');

  // AC14: The layer survives every replacement
  console.log('Testing AC14: The layer survives every replacement...');
  // Step
  await page.click('#step-next');
  // Toggle view
  await page.selectOption('#view-toggle', 'final');
  // Cap message
  await page.fill('#regex-input', 'a'.repeat(201)); // 201 symbols + 200 concats = 401 postfix tokens (> 400)
  await page.click('#build-button');
  await page.waitForFunction(() => document.querySelector('#canvas')?.textContent.includes('Diagram is disabled'));
  // Refused build
  await page.fill('#regex-input', '(a|');
  await page.click('#build-button');
  await page.waitForFunction(() => (document.querySelector('#error-message')?.textContent || '').includes('Missing operand'));
  // Valid build
  await page.fill('#regex-input', 'ab');
  await page.click('#build-button');
  await page.waitForFunction(() => document.querySelector('#step-counter')?.textContent.includes('step 1 / 3'));

  const viewportCount = await page.evaluate(() => document.querySelectorAll('#canvas-viewport').length);
  assert.strictEqual(viewportCount, 1, 'Exactly one #canvas-viewport must exist after replacements');
  const zoomBtnEnabled = await page.$eval('#zoom-in-btn', (el) => !el.disabled);
  assert.strictEqual(zoomBtnEnabled, true, 'Toolbar buttons must still work after replacements');

  // AC15: Visual proof screenshots
  const scratchDir = 'C:/Users/ydash/.gemini/antigravity/brain/2b158c28-fe75-4f43-87fa-2e91bb0a163a/scratch';
  await page.fill('#regex-input', expr161);
  await page.click('#build-button');
  await page.waitForFunction(() => document.querySelector('#step-counter')?.textContent.includes('step 1 / 161'));
  await page.selectOption('#view-toggle', 'final');
  await page.waitForFunction(() => document.querySelector('#canvas')?.getAttribute('data-view') === 'final');

  const canvasLocator = page.locator('#canvas');
  await canvasLocator.scrollIntoViewIfNeeded();

  // 1. Start mode
  await canvasLocator.screenshot({ path: `${scratchDir}/ac15_161_start.png` });

  // 2. After Fit
  await page.click('#zoom-fit-btn');
  await canvasLocator.screenshot({ path: `${scratchDir}/ac15_161_fit.png` });

  // 3. At 10x on a state label
  await page.evaluate(() => {
    const canvas = document.getElementById('canvas');
    const vp = document.getElementById('canvas-viewport');
    if (canvas && vp) {
      // Center state n0 (start state) at 10x in canvas
      const panX = 620 - 37 * 10;
      const panY = 240 - 86 * 10;
      canvas.setAttribute('data-zoom', '10.0000');
      canvas.setAttribute('data-pan-x', String(panX));
      canvas.setAttribute('data-pan-y', String(panY));
      vp.style.transform = `translate(${panX}px, ${panY}px) scale(10.0000)`;
    }
  });
  await canvasLocator.screenshot({ path: `${scratchDir}/ac15_161_10x.png` });

  // ==========================================
  // Ticket 19 AC1 - AC4: NFA Exports
  // ==========================================
  console.log('Testing Ticket 19 AC1 - AC4: NFA Exports...');

  // Reset to clean expression (a|b)*a
  await page.fill('#regex-input', '(a|b)*a');
  await page.click('#build-button');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });
  assert.strictEqual(await page.$eval('#export-dot-btn', (el) => el.disabled), false, 'Normal build enables #export-dot-btn');
  assert.strictEqual(await page.$eval('#export-svg-btn', (el) => el.disabled), false, 'Normal build enables #export-svg-btn');

  // Step 2 flat view export
  await page.click('#step-next'); // step 2
  await page.waitForFunction(() => document.querySelector('#step-counter')?.textContent.includes('step 2 / 6'));

  // AC1: SVG export flat step 2
  const [downloadStep2] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#export-svg-btn')
  ]);
  assert.strictEqual(downloadStep2.suggestedFilename(), 'nfa-step-2-flat.svg', 'Exported flat step 2 filename must be nfa-step-2-flat.svg');
  const step2SvgStream = await downloadStep2.createReadStream();
  const step2Chunks = [];
  for await (const chunk of step2SvgStream) step2Chunks.push(chunk);
  const step2SvgText = Buffer.concat(step2Chunks).toString('utf-8');

  assert(step2SvgText.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n'), 'Exported SVG must start with XML declaration');
  const xmlDeclMatches = step2SvgText.match(/<\?xml\b/g);
  assert(xmlDeclMatches && xmlDeclMatches.length === 1, 'Exported SVG must have exactly one XML declaration');
  assert(step2SvgText.includes('<rect width="100%" height="100%" fill="#ffffff"/>'), 'Exported SVG must contain opaque white background rect');

  const onScreenStep2Vb = await page.evaluate(() => document.querySelector('#canvas-viewport svg')?.getAttribute('viewBox'));

  const step2Xml = await page.evaluate((svgText) => {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    return {
      errors: doc.querySelectorAll('parsererror').length,
      root: doc.documentElement.tagName.toLowerCase(),
      xmlns: doc.documentElement.getAttribute('xmlns'),
      xlink: doc.documentElement.getAttribute('xmlns:xlink'),
      width: doc.documentElement.getAttribute('width'),
      height: doc.documentElement.getAttribute('height'),
      viewBox: doc.documentElement.getAttribute('viewBox')
    };
  }, step2SvgText);

  assert.strictEqual(step2Xml.errors, 0, 'Exported SVG must parse with 0 errors');
  assert.strictEqual(step2Xml.root, 'svg', 'Root must be svg');
  assert.strictEqual(step2Xml.xmlns, 'http://www.w3.org/2000/svg', 'xmlns must be SVG namespace');
  assert.strictEqual(step2Xml.xlink, 'http://www.w3.org/1999/xlink', 'xlink must be present');
  assert(step2Xml.width && step2Xml.height, 'Exported SVG must have explicit width and height');
  assert.strictEqual(step2Xml.viewBox, onScreenStep2Vb, 'Exported SVG viewBox must match original diagram viewBox without zoom transform leakage');

  // Zoom canvas and export again - prove zoom does not leak
  await page.click('#zoom-in-btn');
  await page.click('#zoom-in-btn');
  const [downloadStep2Zoom] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#export-svg-btn')
  ]);
  const step2ZoomStream = await downloadStep2Zoom.createReadStream();
  const step2ZoomChunks = [];
  for await (const chunk of step2ZoomStream) step2ZoomChunks.push(chunk);
  const step2ZoomSvg = Buffer.concat(step2ZoomChunks).toString('utf-8');
  const step2ZoomVb = await page.evaluate((svgText) => {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    return doc.documentElement.getAttribute('viewBox');
  }, step2ZoomSvg);
  assert.strictEqual(step2ZoomVb, onScreenStep2Vb, 'Exported SVG viewBox must match original diagram viewBox without zoom transform leakage');
  assert(!step2ZoomSvg.includes('data-created-by-step'), 'Exported SVG must come from cached SVG string, never from mutated DOM');
  await page.click('#zoom-reset-btn');

  // Textbook step export
  await page.selectOption('#view-toggle', 'textbook');
  await page.waitForFunction(() => document.querySelector('#view-toggle')?.value === 'textbook');
  const [downloadTextbook] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#export-svg-btn')
  ]);
  assert.strictEqual(downloadTextbook.suggestedFilename(), 'nfa-step-2-textbook.svg', 'Exported textbook step filename must be nfa-step-2-textbook.svg');

  // Final view export
  await page.selectOption('#view-toggle', 'final');
  await page.waitForFunction(() => document.querySelector('#canvas')?.getAttribute('data-view') === 'final');
  const [downloadFinalSvg] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#export-svg-btn')
  ]);
  assert.strictEqual(downloadFinalSvg.suggestedFilename(), 'nfa-final.svg', 'Exported final SVG filename must be nfa-final.svg');

  // AC2: DOT export equals rendered view DOT
  const [downloadFinalDot] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#export-dot-btn')
  ]);
  assert.strictEqual(downloadFinalDot.suggestedFilename(), 'nfa-final.dot', 'Exported DOT filename must match expected convention');
  const finalDotStream = await downloadFinalDot.createReadStream();
  const finalDotChunks = [];
  for await (const chunk of finalDotStream) finalDotChunks.push(chunk);
  const finalDotText = Buffer.concat(finalDotChunks).toString('utf-8');
  const lastRenderedDot = await page.evaluate(() => window.__lastRenderedDot);
  assert.strictEqual(finalDotText, lastRenderedDot, 'Exported DOT must match the rendered view DOT');

  // AC3: Button states & Diagram-capped build (> 400 postfix tokens)
  const cappedExpr = 'a'.repeat(210);
  await page.fill('#regex-input', cappedExpr);
  await page.click('#build-button');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });
  assert.strictEqual(await page.$eval('#export-dot-btn', (el) => el.disabled), false, '#export-dot-btn must be enabled when diagram is capped');
  assert.strictEqual(await page.$eval('#export-svg-btn', (el) => el.disabled), true, '#export-svg-btn must be disabled when diagram is capped');

  // For capped build, compare DOT node count with #stats state count
  const [downloadCappedDot] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#export-dot-btn')
  ]);
  const cappedDotStream = await downloadCappedDot.createReadStream();
  const cappedDotChunks = [];
  for await (const chunk of cappedDotStream) cappedDotChunks.push(chunk);
  const cappedDotText = Buffer.concat(cappedDotChunks).toString('utf-8');
  const dotNodeMatches = cappedDotText.match(/^\s*q\d+\s*\[/gm);
  const statsStatesText = await page.textContent('#stats');
  const statesMatch = statsStatesText.match(/States:\s*(\d+)/);
  const expectedStates = statesMatch ? parseInt(statesMatch[1], 10) : 0;
  assert.strictEqual(dotNodeMatches ? dotNodeMatches.length : 0, expectedStates, 'Capped DOT node count must equal #stats state count');

  // Check disabled in flight
  await page.fill('#regex-input', '(a|b)*a');
  await page.evaluate(() => { window.__testRenderDelay = 500; });
  const buildPromise = page.click('#build-button');
  await page.waitForFunction(() => window.__buildDone === false);
  assert.strictEqual(await page.$eval('#export-dot-btn', (el) => el.disabled), true, 'Export buttons must be disabled during build in flight');
  assert.strictEqual(await page.$eval('#export-svg-btn', (el) => el.disabled), true, 'Export buttons must be disabled during build in flight');
  await buildPromise;
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });
  await page.evaluate(() => { window.__testRenderDelay = null; });

  // Over 2000 tokens engine limit refusal
  const over2000Expr = 'a'.repeat(2001);
  await page.fill('#regex-input', over2000Expr);
  await page.click('#build-button');
  await page.waitForFunction(() => document.querySelector('#error-message')?.textContent.includes('exceeds the engine limit'));
  assert.strictEqual(await page.$eval('#export-dot-btn', (el) => el.disabled), true, 'Export buttons must be disabled after 2000+ token refusal');
  assert.strictEqual(await page.$eval('#export-svg-btn', (el) => el.disabled), true, 'Export buttons must be disabled after 2000+ token refusal');

  // AC4: No stale export after rebuilding different expression
  await page.fill('#regex-input', 'b');
  await page.click('#build-button');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });
  const [downloadNewDot] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#export-dot-btn')
  ]);
  const newDotChunks = [];
  for await (const chunk of await downloadNewDot.createReadStream()) newDotChunks.push(chunk);
  const newDotText = Buffer.concat(newDotChunks).toString('utf-8');
  assert(newDotText.includes('b (new)'), 'Exported DOT after rebuild must belong to new expression');

  // AC4: No stale export after refused build
  await page.fill('#regex-input', '(a|');
  await page.click('#build-button');
  await page.waitForFunction(() => document.querySelector('#error-message')?.textContent.includes('Missing operand'));
  assert.strictEqual(await page.$eval('#export-dot-btn', (el) => el.disabled), true, 'Export buttons must be disabled after refused build');
  assert.strictEqual(await page.$eval('#export-svg-btn', (el) => el.disabled), true, 'Export buttons must be disabled after refused build');

  // ==========================================
  // Ticket 19 AC6 - AC8: Deep Links and Copy Link
  // ==========================================
  console.log('Testing Ticket 19 AC6 - AC8: Deep Links and Copy Link...');

  // AC6: Deep link load in a fresh page
  const freshAc6Page = await createHarnessPage(browser);
  const deepLinkUrl = fileUrl + '?regex=(a%7Cb)*a&notation=bad_notation&view=textbook&step=999&input=ba&preset=nonexistent_preset';
  await freshAc6Page.goto(deepLinkUrl);
  await freshAc6Page.waitForFunction('window.__ready === true', null, { timeout: 15000 });
  await freshAc6Page.waitForFunction(() => document.body.getAttribute('data-deep-link-done') === 'true', null, { timeout: 15000 });

  // Auto-build and controls set
  const ac6Stats = await freshAc6Page.textContent('#stats');
  assert(ac6Stats.includes('States: 10, Transitions: 12'), 'Auto-build must populate #stats on deep link load');
  assert.strictEqual(await freshAc6Page.$eval('#regex-input', (el) => el.value), '(a|b)*a', 'Regex input must be set from deep link');
  assert.strictEqual(await freshAc6Page.$eval('#test-input', (el) => el.value), 'ba', 'Test input must be set from deep link');
  assert.strictEqual(await freshAc6Page.textContent('#verdict'), 'ACCEPT', 'Simulation verdict must be rendered on deep link load');

  // View and step clamped
  assert.strictEqual(await freshAc6Page.$eval('#view-toggle', (el) => el.value), 'textbook', 'View must be restored on deep link load');
  const ac6StepText = await freshAc6Page.textContent('#step-counter');
  assert.strictEqual(ac6StepText, 'step 6 / 6', 'Step index over total steps must be clamped to max step');

  // Link notice for invalid params
  const ac6NoticeText = await freshAc6Page.textContent('#link-notice');
  assert(ac6NoticeText.includes('Ignored link parameters:'), 'Link notice must display ignored parameters');
  assert(ac6NoticeText.includes('notation') && ac6NoticeText.includes('preset'), 'Link notice must report ignored notation and preset');
  assert.strictEqual(await freshAc6Page.$eval('#link-notice', (el) => el.getAttribute('role')), 'status', '#link-notice must have role=status');

  await freshAc6Page.close();

  // AC6 preset restore in fresh page
  const freshPresetPage = await createHarnessPage(browser);
  await freshPresetPage.goto(fileUrl + '?preset=worked-example');
  await freshPresetPage.waitForFunction('window.__ready === true', null, { timeout: 15000 });
  await freshPresetPage.waitForFunction(() => document.body.getAttribute('data-deep-link-done') === 'true', null, { timeout: 15000 });
  assert.strictEqual(await freshPresetPage.$eval('#preset-select', (el) => el.value), 'worked-example', 'Preset select must be restored on deep link load');
  assert(await freshPresetPage.evaluate(() => document.getElementById('link-notice')?.textContent === ''), '#link-notice must be empty when no invalid params');
  await freshPresetPage.close();

  // AC7: XSS safety in fresh page
  const xssPage = await createHarnessPage(browser);
  const xssUrl = fileUrl + '?regex=a&alphabet=%3Cimg+src%3Dx+onerror%3Dwindow.__pwned%3D1%3E';
  await xssPage.goto(xssUrl);
  await xssPage.waitForFunction('window.__ready === true', null, { timeout: 15000 });
  await xssPage.waitForFunction(() => document.body.getAttribute('data-deep-link-done') === 'true', null, { timeout: 15000 });
  const pwned = await xssPage.evaluate(() => window.__pwned);
  assert.strictEqual(pwned, undefined, 'Malicious param must not execute XSS script');
  const errText = await xssPage.textContent('#error-message');
  assert(errText.includes('<img src=x onerror=window.__pwned=1>'), 'Error message must display escaped malicious regex text');
  await xssPage.close();

  // Malicious regex param renders safely as raw characters
  const xssRegexPage = await createHarnessPage(browser);
  await xssRegexPage.goto(fileUrl + '?regex=%3Cimg+src%3Dx+onerror%3Dwindow.__pwned%3D1%3E');
  await xssRegexPage.waitForFunction('window.__ready === true', null, { timeout: 15000 });
  await xssRegexPage.waitForFunction(() => document.body.getAttribute('data-deep-link-done') === 'true', null, { timeout: 15000 });
  assert.strictEqual(await xssRegexPage.$eval('#regex-input', (el) => el.value), '<img src=x onerror=window.__pwned=1>', 'Malicious regex input value must match raw string');
  assert.strictEqual(await xssRegexPage.evaluate(() => window.__pwned), undefined, 'Malicious regex must not execute XSS script');
  await xssRegexPage.close();

  // AC8: Copy Link button
  // Configure page state: custom alphabet, compact labels, step 2
  await page.selectOption('#view-toggle', 'flat');
  await page.fill('#regex-input', '(a|b)*a');
  await page.click('#build-button');
  await page.waitForFunction('window.__buildDone === true', null, { timeout: 15000 });
  await page.fill('#alphabet-input', 'a, b, x');
  await page.evaluate(() => document.getElementById('alphabet-input')?.dispatchEvent(new Event('change')));
  await page.fill('#test-input', 'ba');
  await page.click('#compact-labels');
  await page.click('#step-next'); // step 2
  await page.waitForFunction(() => document.querySelector('#step-counter')?.textContent.includes('step 2 / 6'));

  // Click Copy Link
  await page.click('#copy-link-btn');
  await page.waitForFunction(() => document.getElementById('copy-link-status')?.textContent === 'Link copied!');
  assert.strictEqual(await page.textContent('#copy-link-status'), 'Link copied!', '#copy-link-status must display "Link copied!"');
  assert.strictEqual(await page.$eval('#copy-link-status', (el) => el.getAttribute('data-copied')), 'true', 'data-copied must be true on copy link');
  assert.strictEqual(await page.$eval('#copy-link-status', (el) => el.getAttribute('role')), 'status', '#copy-link-status must have role=status');
  assert(!((await page.textContent('#live-region')) || '').includes('Link copied!'), 'Copy Link must not write to #live-region');

  const copiedUrl = await page.evaluate(() => navigator.clipboard.readText());
  assert(copiedUrl.includes('regex='), 'Clipboard must contain copied deep link URL');
  assert(copiedUrl.includes('alphabet='), 'Copied URL must include edited alphabet');
  assert(copiedUrl.includes('input=ba'), 'Copied URL must include test input');
  assert(copiedUrl.includes('compact=1'), 'Copied URL must include compact=1');

  // Verify 2s clear timer
  await page.waitForFunction(() => !document.getElementById('copy-link-status')?.hasAttribute('data-copied'), null, { timeout: 5000 });
  assert.strictEqual(await page.textContent('#copy-link-status'), '', 'Copy link status text must be cleared after 2 s');

  // Verify opening copied URL reproduces exact state in fresh page
  const freshCopyPage = await createHarnessPage(browser);
  await freshCopyPage.goto(copiedUrl);
  await freshCopyPage.waitForFunction('window.__ready === true', null, { timeout: 15000 });
  await freshCopyPage.waitForFunction(() => document.querySelector('#stats')?.textContent.includes('States:'), null, { timeout: 15000 });

  assert.strictEqual(await freshCopyPage.$eval('#regex-input', (el) => el.value), '(a|b)*a', 'Regex must reproduce in fresh page');
  assert.strictEqual(await freshCopyPage.$eval('#notation-select', (el) => el.value), 'standard', 'Notation must reproduce in fresh page');
  assert.strictEqual(await freshCopyPage.$eval('#concat-select', (el) => el.value), 'epsilon-link', 'Concat mode must reproduce in fresh page');
  assert.strictEqual(await freshCopyPage.$eval('#test-input', (el) => el.value), 'ba', 'Test input must reproduce in fresh page');
  assert.strictEqual(await freshCopyPage.$eval('#view-toggle', (el) => el.value), 'flat', 'View mode must reproduce in fresh page');
  assert.strictEqual(await freshCopyPage.textContent('#step-counter'), 'step 2 / 6', 'Step counter must reproduce step 2 in fresh page');
  assert.strictEqual(await freshCopyPage.$eval('#compact-labels', (el) => el.checked), true, 'Compact labels must reproduce in fresh page');
  await freshCopyPage.close();

  // ---------------------------------------------------------
  // Ticket 19 AC9: Keyboard help dialog
  // ---------------------------------------------------------
  // 1. Initial state: dialog is closed
  assert.strictEqual(await page.$eval('#keyboard-help-dialog', (el) => el.open), false, 'Keyboard help dialog must initially be closed');

  // 2. Table has exactly 9 shortcut rows covering required shortcuts
  const shortcutRows = await page.$$eval('#keyboard-help-table tbody tr', (rows) =>
    rows.map((r) => r.textContent.trim())
  );
  assert.strictEqual(shortcutRows.length, 9, 'Keyboard help table must contain 9 shortcut rows');
  assert(shortcutRows.some((t) => t.includes('Enter')), 'Keyboard help table must list Enter');
  assert(shortcutRows.some((t) => t.includes('←') || t.includes('Left')), 'Keyboard help table must list Left/Right arrows');
  assert(shortcutRows.some((t) => t.includes('+') || t.includes('=')), 'Keyboard help table must list + or =');
  assert(shortcutRows.some((t) => t.includes('-') || t.includes('_')), 'Keyboard help table must list - or _');
  assert(shortcutRows.some((t) => t.includes('0')), 'Keyboard help table must list 0');
  assert(shortcutRows.some((t) => t.includes('f')), 'Keyboard help table must list f');
  assert(shortcutRows.some((t) => t.includes('Shift')), 'Keyboard help table must list Shift+arrows');
  assert(shortcutRows.some((t) => t.includes('?')), 'Keyboard help table must list ?');
  assert(shortcutRows.some((t) => t.includes('Esc')), 'Keyboard help table must list Esc');

  // 3. Open dialog via button click, close via close button, verify focus returns to button
  await page.focus('#build-button');
  await page.evaluate(() => {
    document.getElementById('keyboard-help-btn')?.click();
  });
  assert.strictEqual(await page.$eval('#keyboard-help-dialog', (el) => el.open), true, 'Clicking #keyboard-help-btn must open dialog');
  await page.click('#keyboard-help-close');
  assert.strictEqual(await page.$eval('#keyboard-help-dialog', (el) => el.open), false, 'Clicking #keyboard-help-close must close dialog');
  assert.strictEqual(await page.evaluate(() => document.activeElement?.id), 'keyboard-help-btn', 'Focus must return to opener button on close');

  // 4. Open dialog via '?' key shortcut from a non-input element
  await page.focus('#build-button');
  await page.keyboard.press('Control+?');
  assert.strictEqual(await page.$eval('#keyboard-help-dialog', (el) => el.open), false, 'Ctrl+? must not open keyboard help');
  await page.keyboard.press('Alt+?');
  assert.strictEqual(await page.$eval('#keyboard-help-dialog', (el) => el.open), false, 'Alt+? must not open keyboard help');

  await page.keyboard.press('?');
  assert.strictEqual(await page.$eval('#keyboard-help-dialog', (el) => el.open), true, 'Pressing ? outside inputs must open dialog');

  // 5. While open, global arrow stepping and canvas keys do nothing
  const beforeStep = await page.textContent('#step-counter');
  await page.keyboard.press('ArrowRight');
  assert.strictEqual(await page.textContent('#step-counter'), beforeStep, 'Arrow stepping must be disabled while keyboard help is open');

  const transformBefore = await page.evaluate(() => document.getElementById('canvas-viewport')?.getAttribute('transform') || '');
  await page.evaluate(() => document.getElementById('canvas')?.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true })));
  await page.evaluate(() => document.getElementById('canvas')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true })));
  const transformAfter = await page.evaluate(() => document.getElementById('canvas-viewport')?.getAttribute('transform') || '');
  assert.strictEqual(transformAfter, transformBefore, 'Canvas shortcuts must not act while keyboard help dialog is open');

  // 6. Close via Esc key, verify focus returns to #build-button
  await page.keyboard.press('Escape');
  assert.strictEqual(await page.$eval('#keyboard-help-dialog', (el) => el.open), false, 'Pressing Esc must close keyboard help dialog');
  assert.strictEqual(await page.evaluate(() => document.activeElement?.id), 'build-button', 'Focus must return to opener element on Esc close');

  // 7. Verify ? is ignored while typing inside input elements
  await page.focus('#regex-input');
  await page.keyboard.press('?');
  assert.strictEqual(await page.$eval('#keyboard-help-dialog', (el) => el.open), false, 'Typing ? in input must not open keyboard help');

  console.log(`E2E policy: treated ${consoleWarnings.length} console warning(s) as non-fatal notices (${consoleWarnings.join('; ') || 'none'}).`);
  assert.strictEqual(consoleErrors.length, 0, `Browser console errors encountered: ${consoleErrors.join(', ')}`);
  assert.strictEqual(errors.length, 0, `Page errors encountered: ${errors.join(', ')}`);



  await browser.close();
  console.log('E2E test passed successfully!');
})().catch((err) => {
  console.error('E2E test failed:', err);
  process.exit(1);
});
