'use strict';
const { createHash } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { createTracker, START_FEN, describeMove } = require('./chess-position.cjs');
function validateSettings(input = {}) {
  const settings = { path: '', interval: 2000, orientation: 'auto', initialFen: START_FEN, ...input };
  if (settings.initialFen === 'start') settings.initialFen = START_FEN;
  if (typeof settings.path !== 'string' || settings.path.length > 1024 || /[\r\n\0]/.test(settings.path)) throw new Error('Invalid Stockfish path.');
  if (!Number.isInteger(settings.interval) || settings.interval < 1000 || settings.interval > 30000) throw new Error('Choose a watch interval between 1 and 30 seconds.');
  if (!['auto', 'white', 'black'].includes(settings.orientation)) throw new Error('Choose a board orientation.');
  createTracker(settings.initialFen);
  return settings;
}
const hashImage = image => createHash('sha256').update(image).digest('hex');
function createLiveChess({ capture, crop = image => image, recognize, engine, engineFactory, initial = {}, emit = () => {}, save = async () => {} }) {
  let currentEngine = engine;
  let settings = validateSettings(initial), tracker = createTracker(settings.initialFen), timer, controller;
  let epoch = 0, bounds, imageSize, lastHash, lastFen, failures = 0, retryAt = 0, orientation = settings.orientation;
  let state = { running: false, status: 'paused', message: 'Choose Watch board to start.', answer: '' };
  const status = () => ({ ...state, fen: tracker.fen(), settings: { ...settings } });
  const publish = data => { state = { ...state, ...data }; emit(status()); return status(); };
  function stop() {
    epoch++; clearTimeout(timer); controller?.abort(); controller = null; currentEngine?.close();
    if (engineFactory) currentEngine = undefined;
    lastHash = lastFen = undefined;
    return publish({ running: false, status: 'paused', message: 'Board watching paused.', answer: '' });
  }
  function retry(message, error) {
    failures++;
    lastHash = undefined;
    // One uncertain crop is commonly an animation. Re-read it before relocating.
    if (failures >= 2 && !error?.httpStatus) { bounds = undefined; orientation = settings.orientation; }
    const backoff = error?.httpStatus === 429 ? Math.max(15000, error.retryAfterMs || 0)
      : error?.httpStatus >= 500 ? Math.min(30000, 2000 * 2 ** Math.min(failures - 1, 4)) : settings.interval;
    retryAt = Date.now() + Math.min(60000, backoff);
    publish({ status: 'waiting', message, answer: '' });
  }
  async function tick(generation) {
    if (generation !== epoch || !state.running) return;
    const started = Date.now();
    const abort = new AbortController(); controller = abort;
    let catchUp = false;
    try {
      if (Date.now() < retryAt) return;
      let frame = await capture();
      if (generation !== epoch) return;
      if (frame.size && imageSize && (frame.size.width !== imageSize.width || frame.size.height !== imageSize.height)) {
        bounds = undefined; lastHash = undefined; orientation = settings.orientation;
      }
      imageSize = frame.size;
      let image = bounds ? crop(frame.dataUrl, bounds) : frame.dataUrl;
      let hash = hashImage(image);
      if (hash === lastHash && lastFen === tracker.fen()) {
        if (state.status !== 'ready') publish({ status: 'ready', message: 'Watching for board changes.', answer: state.lastAnswer || '' });
        return;
      }
      publish({ status: 'reading', message: 'Reading the visible board…', answer: '' });
      if (bounds) {
        // Read settled pieces, not an in-between animation frame or a dragged piece.
        await delay(250, undefined, { signal: abort.signal });
        const settled = await capture();
        if (generation !== epoch) return;
        if (settled.size && imageSize && (settled.size.width !== imageSize.width || settled.size.height !== imageSize.height)) {
          bounds = undefined; lastHash = undefined; catchUp = true; return;
        }
        const settledImage = crop(settled.dataUrl, bounds);
        if (hashImage(settledImage) !== hash) { catchUp = true; publish({ status: 'watching', message: 'Waiting for the pieces to settle…', answer: '' }); return; }
        frame = settled; image = settledImage;
      }
      const observed = await recognize(image, { signal: abort.signal, orientation: bounds ? orientation : settings.orientation, cropped: Boolean(bounds) });
      if (generation !== epoch) return;
      if (!observed.visible) { retry(observed.reason || 'Keep the board visible. Retrying automatically.'); return; }
      // Commit the observed placement only after it matches a legal continuation.
      const result = tracker.observe(observed.placement);
      if (!bounds && observed.bounds) bounds = observed.bounds;
      orientation = settings.orientation === 'auto' ? observed.orientation : settings.orientation;
      failures = 0; retryAt = 0;
      // Cache the crop from THIS frame. The old full-image hash forced an extra AI read.
      lastHash = hashImage(bounds ? crop(frame.dataUrl, bounds) : frame.dataUrl);
      if (result.gameOver) {
        const chess = new (require('chess.js').Chess)(result.fen);
        const answer = chess.isCheckmate() ? 'Checkmate.' : 'Game over · draw.';
        lastFen = result.fen;
        publish({ status: 'ready', message: 'Watching for board changes.', answer, lastAnswer: answer });
        return;
      }
      if (!result.changed && lastFen === result.fen) { publish({ status: 'ready', message: 'Watching for board changes.', answer: state.lastAnswer || '' }); return; }
      publish({ status: 'thinking', message: 'Stockfish is analyzing…', answer: '' });
      const recommendation = await currentEngine.analyze(result.fen, { path: settings.path || undefined, movetime: 700, position: tracker.position() });
      if (generation !== epoch) return;
      // Inference can take seconds; do not display advice for an already-changed board.
      const latest = await capture();
      if (generation !== epoch) return;
      if (latest.size && imageSize && (latest.size.width !== imageSize.width || latest.size.height !== imageSize.height)) {
        bounds = undefined; lastHash = undefined; catchUp = true; return;
      }
      if (hashImage(bounds ? crop(latest.dataUrl, bounds) : latest.dataUrl) !== lastHash) {
        catchUp = true; publish({ status: 'watching', message: 'Board changed while reading. Catching up…', answer: '' }); return;
      }
      const turn = result.fen.split(' ')[1] === 'w' ? 'White' : 'Black';
      const answer = recommendation.bestmove ? `${turn} · ${describeMove(result.fen, recommendation.bestmove)}` : 'Game over · no legal move.';
      lastFen = result.fen;
      publish({ status: 'ready', message: 'Watching for board changes.', answer, lastAnswer: answer });
    } catch (error) {
      if (generation !== epoch) return;
      retry(error.message, error);
    } finally {
      if (generation === epoch && state.running) {
        controller = null;
        timer = setTimeout(() => tick(generation), catchUp ? 300 : Math.max(100, retryAt - Date.now(), settings.interval - (Date.now() - started)));
      }
    }
  }
  return {
    status, stop,
    start() {
      if (state.running) return status();
      currentEngine ||= engineFactory?.();
      const generation = ++epoch; bounds = undefined; failures = 0; retryAt = 0; orientation = settings.orientation;
      publish({ running: true, status: 'watching', message: 'Locating the visible board…', answer: '' });
      void tick(generation); return status();
    },
    async configure(input) {
      const next = validateSettings({ ...settings, ...input });
      await save(next); stop(); settings = next; tracker = createTracker(settings.initialFen); bounds = undefined;
      return publish({ status: 'paused', message: 'Position loaded. Choose Watch board.', answer: '', lastAnswer: '' });
    },
    reset(input = {}) { const next = createTracker(input.fen || settings.initialFen); stop(); tracker = next; bounds = undefined; return publish({ message: 'Position reset. Choose Watch board.', answer: '', lastAnswer: '' }); }
  };
}
module.exports = { createLiveChess, validateSettings };
