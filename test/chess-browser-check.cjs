const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { startServer } = require('../server.cjs');
const fs = require('node:fs');

(async () => {
  const server = await startServer({ port: 0 });
  let browser;
  try {
    browser = await chromium.launch({ headless: true,
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
      args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 700, height: 760 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      let state = { running: false, status: 'paused', message: 'Keep your board visible.', settings: { path: '', interval: 4000, orientation: 'auto', initialFen: 'start' } };
      window.chessActions = [];
      window.desktop = {
        platform: 'linux',
        resizeOverlay: async height => { window.overlayHeight = height; },
        onScan: () => {},
        onChess: callback => { window.chessEvent = callback; return () => {}; },
        chess: async (action, payload) => {
          window.chessActions.push({ action, payload });
          if (action === 'configure') state = { ...state, settings: payload };
          if (action === 'start') {
            state = { ...state, running: true, status: 'watching', message: 'Watching for board changes.' };
            if (window.chessStartOvertaken) {
              window.chessEvent({ ...state, status: 'ready', answer: 'Move your bishop from c1 to f4.' });
              await new Promise(resolve => setTimeout(resolve, 20));
            }
          }
          if (action === 'stop') state = { ...state, running: false, status: 'paused', message: 'Watching paused.' };
          return state;
        },
        call: async action => action === 'settings' || action === 'configure' ? { hasKey: true, hasGroqKey: true, model: 'fixture', canRemember: false } : { answer: 'A useful daily answer.', usage: 10 }
      };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.overlayHeight === 84);
    await page.click('[data-mode=chess]');
    assert.equal(await page.locator('#record').isVisible(), false);
    assert.equal(await page.locator('.question-details').isVisible(), false);
    assert.equal(await page.locator('#followupForm').isVisible(), false);
    assert.match(await page.locator('#scan').textContent(), /Watch board/);
    await page.evaluate(() => { window.chessStartOvertaken = true; });
    await page.click('#scan');
    await page.waitForFunction(() => window.chessActions.some(request => request.action === 'start'));
    await page.waitForFunction(() => document.querySelector('#scan').getAttribute('aria-pressed') === 'true');
    await page.waitForFunction(() => !document.querySelector('#scan').disabled);
    assert.match(await page.locator('#answerContent').textContent(), /bishop/);
    await page.evaluate(() => window.chessEvent({ running: true, status: 'ready', answer: 'Move your **knight** from **g1** to **f3**.\n<img src=x onerror=alert(1)>', message: 'Stockfish · 14 ply' }));
    assert.equal(await page.locator('#cuePopup').isVisible(), true);
    assert.match(await page.locator('#answerContent').textContent(), /knight.*g1.*f3/s);
    assert.equal(await page.locator('#answerContent img').count(), 0);
    assert.equal(await page.locator('#copyChessMove').isEnabled(), true);
    await page.evaluate(() => window.chessEvent({ running: true, status: 'ready', answer: 'White · Move your knight from g1 to f3.', message: 'Watching for board changes.' }));
    fs.mkdirSync(__dirname + '/../test-results', { recursive: true });
    await page.screenshot({ path: __dirname + '/../test-results/chess-desktop.png' });
    await page.setViewportSize({ width: 320, height: 760 });
    await page.screenshot({ path: __dirname + '/../test-results/chess-narrow.png' });
    await page.setViewportSize({ width: 700, height: 760 });
    await page.evaluate(() => window.chessEvent({ running: true, status: 'thinking', message: 'Calculating the changed position.' }));
    assert.doesNotMatch(await page.locator('#answerContent').textContent(), /knight/);
    assert.equal(await page.locator('#copyChessMove').isEnabled(), false);
    await page.evaluate(() => window.chessEvent({ running: true, status: 'waiting', message: 'Wait for the move animation to settle.' }));
    assert.match(await page.locator('#answerContent').textContent(), /animation/);
    await page.click('#overlaySettings');
    await page.locator('#settingsDialog').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#chessSetup').isVisible(), true);
    await page.fill('#stockfishPath', '/usr/local/bin/stockfish');
    await page.selectOption('#boardOrientation', 'black');
    await page.selectOption('#chessInterval', '8000');
    await page.click('#saveChessSetup');
    await page.waitForFunction(() => document.querySelector('#chessSettingsStatus').textContent === 'Chess setup saved.');
    assert.deepEqual(await page.evaluate(() => window.chessActions.find(request => request.action === 'configure').payload), { path: '/usr/local/bin/stockfish', interval: 8000, orientation: 'black', initialFen: 'start' });
    await page.locator('#chessSetup').scrollIntoViewIfNeeded();
    await page.screenshot({ path: __dirname + '/../test-results/chess-settings.png' });
    await page.evaluate(fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'));
    const settingsAudit = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } }));
    assert.equal(settingsAudit.violations.length, 0, JSON.stringify(settingsAudit.violations.map(issue => ({ id: issue.id, nodes: issue.nodes.map(node => node.target) }))));
    await page.click('[data-close=settingsDialog]');
    await page.click('[data-mode=daily]');
    await page.waitForFunction(() => window.chessActions.some(request => request.action === 'stop'));
    assert.equal(await page.locator('#record').isVisible(), true);
    assert.equal(await page.locator('#followupForm').isVisible(), true);
    assert.match(await page.locator('#scan').textContent(), /Scan screen/);
    const dailyText = await page.locator('#answerContent').textContent();
    await page.evaluate(() => window.chessEvent({ running: true, status: 'ready', answer: 'Late chess move', message: 'Late event' }));
    assert.equal(await page.locator('#answerContent').textContent(), dailyText);
    await page.click('[data-mode=chess]');
    assert.match(await page.locator('#answerStatus').textContent(), /PAUSED/);
    for (const width of [700, 420, 320]) {
      await page.setViewportSize({ width, height: 760 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${width}`);
    }
    await page.setViewportSize({ width: 700, height: 760 });
    const audit = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } }));
    assert.equal(audit.violations.length, 0, JSON.stringify(audit.violations.map(issue => ({ id: issue.id, nodes: issue.nodes.map(node => node.target) }))));
    assert.deepEqual(errors, []);
    console.log('Passed: same overlay, watch/pause, safe move text, stale move suppression, setup persistence calls, Daily restore, late-event isolation, responsive widths, no uncaught errors, zero axe WCAG2A/AA violations. Native recognition and Stockfish mocked.');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
