const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { startServer } = require('../server.cjs');
const fs = require('node:fs');
const { validateSettings } = require('../core/chess-live.cjs');

(async () => {
  const server = await startServer({ port: 0 });
  let browser;
  try {
    browser = await chromium.launch({ headless: true,
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
      args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 700, height: 760 } });
    const errors = [];
    await page.exposeFunction('validateChessSetup', settings => validateSettings(settings));
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
          if (action === 'configure') { const settings = await window.validateChessSetup({ ...state.settings, ...payload }); state = { ...state, running: false, status: 'paused', answer: '', fen: settings.initialFen, settings }; }
          if (action === 'start') {
            state = { ...state, running: true, status: 'watching', message: 'Watching for board changes.' };
            if (window.chessStartOvertaken) {
              window.chessEvent({ ...state, status: 'ready', answer: 'Move your bishop from c1 to f4.' });
              await new Promise(resolve => setTimeout(resolve, 20));
            }
          }
          if (action === 'stop') state = { ...state, running: false, status: 'paused', answer: '', message: 'Watching paused.' };
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
    assert.equal(await page.locator('#loadChessFen').isVisible(), true, 'FEN loading is available directly in the Chess popup');
    await page.click('#loadChessFen');
    await page.fill('#chessFenText', '8/8/8/8/8/8/8/8'); await page.click('#applyChessFen');
    await page.locator('#fenImportError').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#chessFenDialog').isVisible(), true);
    const importedFen = '4k3/8/8/8/8/8/4P3/4K3 b - - 10 12';
    await page.fill('#chessFenText', importedFen); await page.click('#applyChessFen');
    await page.locator('#chessFenDialog').waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.chessActions.at(-1).payload.initialFen), importedFen);
    assert.equal(await page.locator('#loadChessFen').evaluate(node => document.activeElement === node), true);
    await page.click('#loadChessFen');
    await page.setInputFiles('#chessFenFile', { name: 'game.fen', mimeType: 'text/plain', buffer: Buffer.from(importedFen) });
    await page.waitForFunction(fen => document.querySelector('#chessFenText').value === fen, importedFen);
    await page.evaluate(fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'));
    const fenAudit = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } }));
    assert.equal(fenAudit.violations.length, 0, JSON.stringify(fenAudit.violations.map(issue => issue.id)));
    fs.mkdirSync(__dirname + '/../test-results', { recursive: true });
    await page.screenshot({ path: __dirname + '/../test-results/chess-fen.png' });
    await page.click('#applyChessFen'); await page.locator('#chessFenDialog').waitFor({ state: 'hidden' });
    await page.click('#newChessGame'); await page.waitForFunction(() => !document.querySelector('#newChessGame').disabled);
    assert.equal(await page.evaluate(() => window.chessActions.at(-1).payload.initialFen), 'start');
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
    const historyCount = await page.locator('.chess-history-turn').count();
    await page.evaluate(() => window.chessEvent({ running: true, status: 'ready', answer: 'White · Move your knight from g1 to f3.', message: 'Watching for board changes.' }));
    assert.equal(await page.locator('.chess-history-turn').count(), historyCount, 'Repeated observations do not duplicate the move');
    fs.mkdirSync(__dirname + '/../test-results', { recursive: true });
    await page.screenshot({ path: __dirname + '/../test-results/chess-desktop.png' });
    await page.setViewportSize({ width: 320, height: 760 });
    await page.screenshot({ path: __dirname + '/../test-results/chess-narrow.png' });
    await page.setViewportSize({ width: 700, height: 760 });
    await page.evaluate(() => window.chessEvent({ running: true, status: 'thinking', message: 'Calculating the changed position.' }));
    assert.match(await page.locator('#answerContent').textContent(), /knight/, 'Reading a new position must retain previous move history');
    assert.equal(await page.locator('#copyChessMove').isEnabled(), false);
    await page.evaluate(() => window.chessEvent({ running: true, status: 'waiting', message: 'Wait for the move animation to settle.' }));
    assert.match(await page.locator('#answerMeta').textContent(), /animation/);
    await page.click('#overlaySettings');
    await page.locator('#settingsDialog').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#chessSetup').isVisible(), true);
    await page.fill('#stockfishPath', '/usr/local/bin/stockfish');
    await page.selectOption('#boardOrientation', 'black');
    await page.selectOption('#chessInterval', '8000');
    await page.click('#saveChessSetup');
    await page.waitForFunction(() => document.querySelector('#chessSettingsStatus').textContent === 'Chess setup saved.');
    assert.deepEqual(await page.evaluate(() => window.chessActions.filter(request => request.action === 'configure').at(-1).payload), { path: '/usr/local/bin/stockfish', interval: 8000, orientation: 'black', initialFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' });
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
    assert.equal(await page.locator('.chess-history-turn').count(), historyCount);
    assert.match(await page.locator('#answerContent').textContent(), /knight/);
    // A status update must not scroll away from an earlier suggestion.
    await page.locator('#answerContent').evaluate(node => { node.scrollTop = 0; });
    await page.evaluate(() => window.chessEvent({ running: true, status: 'reading', answer: '', message: 'Reading another board.' }));
    assert.equal(await page.locator('#answerContent').evaluate(node => node.scrollTop), 0);
    for (const width of [700, 420, 320]) {
      await page.setViewportSize({ width, height: 760 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${width}`);
    }
    await page.setViewportSize({ width: 700, height: 760 });
    const audit = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } }));
    assert.equal(audit.violations.length, 0, JSON.stringify(audit.violations.map(issue => ({ id: issue.id, nodes: issue.nodes.map(node => node.target) }))));
    await page.reload(); await page.waitForFunction(() => window.overlayHeight !== undefined);
    assert.equal(await page.locator('.chess-history-turn').count(), historyCount, 'Chess history survives reopening the app');
    assert.match(await page.locator('#answerContent').textContent(), /knight/);
    await page.click('#clearChessHistory'); assert.equal(await page.locator('.chess-history-turn').count(), 0);
    assert.deepEqual(errors, []);
    console.log('Passed: same overlay, paste/file FEN import with real validation, focus return, watch/pause, persisted move history through errors and mode switches, deduplication, safe text, settings, late-event isolation, responsive widths, and zero axe violations. Native recognition and Stockfish mocked.');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
