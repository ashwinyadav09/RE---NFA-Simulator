const { chromium } = require('playwright');
const path = require('node:path');
const assert = require('node:assert');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

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

  await page.addInitScript(() => {
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
            if (window.__testForceLayoutFailure && options && options.format === 'json') {
              return { ok: false, error: 'Forced test failure' };
            }
            if (window.__testForcePinnedRenderFailure && options && options.engine === 'neato') {
              return { ok: false, error: 'Forced pinned failure' };
            }
            if (window.__testRenderDelay && window.__testRenderDelay[2] && dot.includes('box_0_1')) {
              await new Promise((r) => setTimeout(r, window.__testRenderDelay[2] || 250));
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
    const origAEL = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function(type, listener, options) {
      const target = this;
      const id = target && target.id;
      if (
        (id === 'build-button' && type === 'click') ||
        (id === 'notation-select' && type === 'change') ||
        (id === 'concat-select' && type === 'change') ||
        (id === 'preset-select' && type === 'change')
      ) {
        const wrapped = async function(...args) {
          window.__buildDone = false;
          try {
            return await listener.apply(this, args);
          } finally {
            window.__buildDone = true;
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
            window.__suiteResults = Array.from(rows).map((r) => ({
              passed: r.textContent.includes('PASS')
            }));
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
            let regExpStatus = 'pass';
            let allPassed = true;
            if (statusText.includes('ORACLE ERROR')) {
              regExpStatus = 'error';
              allPassed = false;
            } else if (statusText.includes('skipped: timeout')) {
              regExpStatus = 'skipped (timeout)';
            } else if (statusText.includes('MISMATCH')) {
              allPassed = false;
            }
            window.__diffResult = {
              allPassed,
              mismatches: [],
              oracles: {
                nfa: { status: 'pass' },
                minDFA: { status: 'pass' },
                enumerator: { status: 'pass' },
                derivatives: { status: 'pass' },
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
  });

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
  await page.fill('#test-input', 'a'.repeat(41));
  await page.click('#run-button');
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
  await page.fill('#regex-input', '(a|b)*a');
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

  // 2. Initial inline-SVG chart exists
  const initialChartExists = await page.evaluate(() => !!document.querySelector('#stress-chart-container svg'));
  assert(initialChartExists, 'Initial inline-SVG chart must be rendered in #stress-chart-container');

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

  // 8. Test second family ((a+)+ on a^n b)
  await page.selectOption('#stress-family', 'plus-plus');
  await page.evaluate(() => { window.__stressRowAdded = false; window.__stressDone = false; });
  await page.click('#stress-run');
  await page.waitForFunction('window.__stressRowAdded === true', null, { timeout: 15000 });

  const plusRowText = await page.$eval('#stress-table tbody tr:first-child', (el) => el.textContent);
  console.log('Second family first row text:', plusRowText);
  assert(plusRowText.includes('12'), 'Second family row must test n=12');
  assert(plusRowText.includes('13'), 'Second family string length must be 13');
  assert(plusRowText.includes('REJECT'), 'Second family verdict must be REJECT');

  await page.click('#stress-cancel');
  await page.waitForFunction('window.__stressDone === true', null, { timeout: 15000 });

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
  await page.click('#run-button');
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
  await page.click('#run-button');
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
  await page.click('#run-button');
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

    // Ensure all three attributes (data-current-step, data-view, data-run-status) are present
    await page.evaluate(() => {
      document.querySelector('#canvas')?.setAttribute('data-current-step', '2');
    });

    const priorStep = await page.$eval('#canvas', (el) => el.getAttribute('data-current-step'));
    const priorView = await page.$eval('#canvas', (el) => el.getAttribute('data-view'));
    const priorRunStatus = await page.$eval('#canvas', (el) => el.getAttribute('data-run-status'));
    assert.strictEqual(priorStep, '2', 'Prior state must have data-current-step="2"');
    assert.strictEqual(priorView, 'final', 'Prior state must have data-view="final"');
    assert.strictEqual(priorRunStatus, 'dead', 'Prior state must have data-run-status="dead"');
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

  console.log(`E2E policy: treated ${consoleWarnings.length} console warning(s) as non-fatal notices (${consoleWarnings.join('; ') || 'none'}).`);
  assert.strictEqual(consoleErrors.length, 0, `Browser console errors encountered: ${consoleErrors.join(', ')}`);
  assert.strictEqual(errors.length, 0, `Page errors encountered: ${errors.join(', ')}`);



  await browser.close();
  console.log('E2E test passed successfully!');
})().catch((err) => {
  console.error('E2E test failed:', err);
  process.exit(1);
});
