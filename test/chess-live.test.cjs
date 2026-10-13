'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLiveChess, validateSettings } = require('../core/chess-live.cjs');
const { recognizeBoard } = require('../core/chess-vision.cjs');
const { START_FEN } = require('../core/chess-position.cjs');

const startPlacement = START_FEN.split(' ')[0];
const e4Placement = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR';
const image = 'data:image/png;base64,YWJj';
const changedImage = 'data:image/png;base64,YWJk';
const visible = placement => ({ visible: true, placement, orientation: 'white' });
const frame = dataUrl => ({ dataUrl, size: { width: 1200, height: 900 } });
async function waitFor(predicate, timeout = 3000) {
  const limit = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= limit) throw new Error('Timed out waiting for the live chess state.');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
const nextTurn = () => new Promise(resolve => setImmediate(resolve));

test('an uncertain read retries the same visible frame automatically within the next watch interval', async t => {
  let reads = 0;
  const live = createLiveChess({ initial: { interval: 1000 }, capture: async () => frame(image),
    recognize: async () => ++reads === 1 ? { visible: false, reason: 'The board is still animating.' } : visible(startPlacement),
    engine: { analyze: async () => ({ bestmove: 'e2e4' }), close() {} }
  });
  t.after(() => live.stop());
  live.start();
  await waitFor(() => live.status().status === 'ready', 2500);
  assert.equal(reads, 2);
});

test('live screen capture flows through recognition and legal tracking to text; unchanged screen skips AI and engine work', async t => {
  let currentImage = image, captures = 0, reads = 0;
  const searches = [], updates = [];
  const live = createLiveChess({ initial: { interval: 1000 },
    capture: async () => { captures++; return frame(currentImage); },
    recognize: (screenshot, options) => recognizeBoard(screenshot, { key: 'not-a-real-key', model: 'test-model' }, {
      ...options, fetchImpl: async (_url, request) => {
        reads++;
        const boardImage = JSON.parse(request.body).contents[0].parts[0].inlineData.data;
        const placement = boardImage === 'YWJj' ? startPlacement : e4Placement;
        return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({
          visible: true, certain: true, placement, orientation: 'white', bounds: [100, 100, 700, 700]
        }) }] } }] }));
      }
    }),
    engine: { analyze: async (fen, options) => { searches.push({ fen, options }); return { bestmove: fen.split(' ')[1] === 'w' ? 'e2e4' : 'e7e5' }; }, close() {} },
    emit: state => updates.push(state)
  });
  t.after(() => live.stop());
  live.start();
  await waitFor(() => live.status().status === 'ready');
  assert.equal(live.status().answer, 'White · Pawn e2 → e4');
  assert.deepEqual(searches[0].options.position, { fen: START_FEN, moves: [] });
  await waitFor(() => captures >= 2);
  await nextTurn();
  assert.equal(reads, 1);
  assert.equal(searches.length, 1);
  const priorUpdates = updates.length;
  currentImage = changedImage;
  await waitFor(() => live.status().answer === 'Black · Pawn e7 → e5');
  assert.equal(reads, 2);
  assert.equal(searches.length, 2);
  assert.match(searches[1].fen, /^rnbqkbnr\/pppppppp\/8\/8\/4P3\/8\/PPPP1PPP\/RNBQKBNR b /);
  assert.deepEqual(searches[1].options.position, { fen: START_FEN, moves: ['e2e4'] });
  const changedUpdates = updates.slice(priorUpdates);
  assert.ok(changedUpdates.some(state => state.status === 'reading' && state.answer === ''));
  assert.ok(changedUpdates.some(state => state.status === 'thinking' && state.answer === ''));
});

test('stopping discards late recognition, aborts its request, and never sends the obsolete board to Stockfish', async t => {
  let resolveRecognition, observedSignal, searches = 0;
  const updates = [];
  const live = createLiveChess({ capture: async () => frame(image),
    recognize: (_image, options) => { observedSignal = options.signal; return new Promise(resolve => { resolveRecognition = resolve; }); },
    engine: { analyze: async () => { searches++; return { bestmove: 'e2e4' }; }, close() {} },
    emit: state => updates.push(state)
  });
  t.after(() => live.stop());
  live.start();
  await waitFor(() => Boolean(resolveRecognition));
  live.stop();
  const updatesAfterStop = updates.length;
  assert.equal(observedSignal.aborted, true);
  resolveRecognition(visible(startPlacement));
  await nextTurn();
  await nextTurn();
  assert.equal(searches, 0);
  assert.equal(updates.length, updatesAfterStop);
  assert.equal(live.status().running, false);
  assert.equal(live.status().answer, '');
});

test('an uncertain screenshot clears the recommendation and never analyzes a guessed position', async t => {
  let searches = 0;
  const live = createLiveChess({ capture: async () => frame(image),
    recognize: async () => ({ visible: false, reason: 'The board is still animating.' }),
    engine: { analyze: async () => { searches++; return { bestmove: 'e2e4' }; }, close() {} }
  });
  t.after(() => live.stop());
  live.start();
  await waitFor(() => live.status().status === 'waiting');
  assert.equal(live.status().message, 'The board is still animating.');
  assert.equal(live.status().answer, '');
  assert.equal(live.status().fen, START_FEN);
  assert.equal(searches, 0);
});

test('a failed engine search can retry the identical frame after stop and restart', async t => {
  let searches = 0, reads = 0;
  const live = createLiveChess({ capture: async () => frame(image),
    recognize: async () => { reads++; return visible(startPlacement); },
    engine: { analyze: async () => { if (++searches === 1) throw new Error('Stockfish failed to start.'); return { bestmove: 'e2e4' }; }, close() {} }
  });
  t.after(() => live.stop());
  live.start();
  await waitFor(() => live.status().status === 'waiting');
  assert.equal(live.status().answer, '');
  assert.equal(live.status().message, 'Stockfish failed to start.');
  live.stop();
  live.start();
  await waitFor(() => live.status().status === 'ready');
  assert.equal(live.status().answer, 'White · Pawn e2 → e4');
  assert.equal(searches, 2);
  assert.equal(reads, 2);
});

test('stop and restart replace a permanently closed Stockfish instance when an engine factory is supplied', async t => {
  const instances = [];
  const live = createLiveChess({ capture: async () => frame(image), recognize: async () => visible(startPlacement),
    engineFactory: () => {
      const instance = { closed: false, searches: 0,
        async analyze() { if (this.closed) throw new Error('Stockfish has been closed.'); this.searches++; return { bestmove: 'e2e4' }; },
        close() { this.closed = true; }
      };
      instances.push(instance);
      return instance;
    }
  });
  t.after(() => live.stop());
  live.start();
  await waitFor(() => live.status().status === 'ready');
  assert.equal(instances[0].searches, 1);
  live.stop();
  assert.equal(instances[0].closed, true);
  live.start();
  await waitFor(() => live.status().status === 'ready');
  assert.equal(instances.length, 2);
  assert.equal(instances[1].closed, false);
  assert.equal(instances[1].searches, 1);
});

test('configuration imports a confirmed full FEN, persists it, and clears prior game state', async t => {
  const saved = [];
  const importedFen = '4k3/8/8/8/8/8/4P3/4K3 b - - 10 12';
  const live = createLiveChess({ capture: async () => frame(image), recognize: async () => visible(e4Placement),
    engine: { analyze: async () => ({ bestmove: 'e7e5' }), close() {} }, save: async settings => saved.push(settings)
  });
  t.after(() => live.stop());
  live.start();
  await waitFor(() => live.status().status === 'ready');
  assert.notEqual(live.status().fen, START_FEN);
  const configured = await live.configure({ initialFen: importedFen, orientation: 'black', path: '/opt/homebrew/bin/stockfish' });
  assert.equal(configured.fen, importedFen);
  assert.equal(configured.running, false);
  assert.equal(configured.answer, '');
  assert.equal(configured.lastAnswer, '');
  assert.equal(saved[0].initialFen, importedFen);
  assert.equal(saved[0].orientation, 'black');
  assert.equal(live.reset().fen, importedFen);
  assert.equal((await live.configure({ initialFen: 'start' })).fen, START_FEN);
  await assert.rejects(live.configure({ interval: 1 }), /watch interval/);
  assert.equal(live.status().settings.interval, 2000);
});

test('invalid watch settings are rejected before capture, engine, or persistence', async () => {
  assert.equal(validateSettings({ initialFen: 'start' }).initialFen, START_FEN);
  for (const settings of [{ interval: 999 }, { interval: 30001 }, { interval: 1000.5 },
    { orientation: 'up' }, { path: 'stockfish\nquit' }, { path: 123 }, { initialFen: startPlacement }]) {
    assert.throws(() => validateSettings(settings), /interval|orientation|path|full FEN|six|complete/i);
  }
  let captured = false;
  assert.throws(() => createLiveChess({ initial: { interval: 0 }, capture: async () => { captured = true; },
    recognize: async () => visible(startPlacement), engine: { close() {}, analyze: async () => ({ bestmove: 'e2e4' }) }
  }), /watch interval/);
  assert.equal(captured, false);
});

test('an initial full-frame recognition caches the board crop without a redundant model read', async t => {
  let captures = 0, reads = 0;
  const live = createLiveChess({ initial: { interval: 1000 }, capture: async () => { captures++; return frame(image); },
    crop: url => url + '-crop',
    recognize: async () => { reads++; return { ...visible(startPlacement), bounds: [100, 100, 600, 600] }; },
    engine: { analyze: async () => ({ bestmove: 'e2e4' }), close() {} }
  });
  t.after(() => live.stop()); live.start();
  await waitFor(() => captures >= 3);
  assert.equal(reads, 1);
  assert.equal(live.status().answer, 'White · Pawn e2 → e4');
});

test('repeated crop failures relocate automatically and recover without resetting the legal position', async t => {
  let currentImage = image;
  const optionsSeen = [], searches = [];
  const live = createLiveChess({ initial: { interval: 1000 }, capture: async () => frame(currentImage), crop: url => url + '-crop',
    recognize: async (_url, options) => {
      optionsSeen.push({ cropped: options.cropped, orientation: options.orientation });
      if (optionsSeen.length === 2 || optionsSeen.length === 3) return { visible: false, reason: 'Board edge is clipped.' };
      return { ...visible(currentImage === image ? startPlacement : e4Placement), bounds: [120, 110, 600, 600] };
    },
    engine: { analyze: async fen => { searches.push(fen); return { bestmove: fen.split(' ')[1] === 'w' ? 'e2e4' : 'e7e5' }; }, close() {} }
  });
  t.after(() => live.stop()); live.start();
  await waitFor(() => live.status().status === 'ready'); currentImage = changedImage;
  await waitFor(() => live.status().answer === 'Black · Pawn e7 → e5', 6500);
  assert.deepEqual(optionsSeen, [{ cropped: false, orientation: 'auto' }, { cropped: true, orientation: 'white' }, { cropped: true, orientation: 'white' }, { cropped: false, orientation: 'auto' }]);
  assert.equal(searches.length, 2);
  assert.match(live.status().fen, / b KQkq - 0 1$/);
});

test('a board changed during analysis is caught up before showing the next suggestion', async t => {
  let currentImage = image, finishSearch;
  const updates = [];
  const live = createLiveChess({ initial: { interval: 1000 }, capture: async () => frame(currentImage),
    recognize: async url => visible(url === image ? startPlacement : e4Placement),
    engine: { analyze: async fen => fen === START_FEN ? new Promise(resolve => { finishSearch = resolve; }) : { bestmove: 'e7e5' }, close() {} },
    emit: state => updates.push(state)
  });
  t.after(() => live.stop()); live.start(); await waitFor(() => finishSearch);
  currentImage = changedImage; finishSearch({ bestmove: 'e2e4' });
  await waitFor(() => live.status().answer === 'Black · Pawn e7 → e5');
  assert.ok(!updates.some(state => state.answer === 'White · Pawn e2 → e4'));
  assert.ok(updates.some(state => /Catching up/.test(state.message)));
});

test('provider rate limits pause recognition even when the whole screen changes', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  let reads = 0, captures = 0;
  const live = createLiveChess({ initial: { interval: 1000 }, capture: async () => frame(image + ++captures),
    recognize: async () => { reads++; const error = new Error('Rate limit'); error.httpStatus = 429; error.retryAfterMs = 30000; throw error; },
    engine: { close() {} }
  });
  t.after(() => live.stop()); live.start(); await nextTurn();
  assert.equal(reads, 1);
  t.mock.timers.tick(29999); await nextTurn(); assert.equal(reads, 1);
  t.mock.timers.tick(1); await nextTurn(); assert.equal(reads, 2);
});
