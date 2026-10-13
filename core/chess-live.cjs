'use strict';
const { createHash } = require('node:crypto');
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
function createLiveChess({ capture, crop = image => image, recognize, engine, engineFactory, initial = {}, emit = () => {}, save = async () => {} }) {
  let currentEngine = engine;
  let settings = validateSettings(initial), tracker = createTracker(settings.initialFen), timer, controller;
  let epoch = 0, bounds, imageSize, lastHash, failedHash, failedAt = 0, lastFen, orientation = settings.orientation;
  let state = { running: false, status: 'paused', message: 'Choose Watch board to start.', answer: '' };
  const status = () => ({ ...state, fen: tracker.fen(), settings: { ...settings } });
  const publish = data => { state = { ...state, ...data }; emit(status()); return status(); };
  function stop() {
    epoch++; clearTimeout(timer); controller?.abort(); controller = null; currentEngine?.close();
    if (engineFactory) currentEngine = undefined;
    lastHash = lastFen = undefined;
    return publish({ running: false, status: 'paused', message: 'Board watching paused.', answer: '' });
  }
  async function tick(generation) {
    if (generation !== epoch || !state.running) return;
    controller = new AbortController();
    let hash;
    try {
      const frame = await capture();
      if (generation !== epoch) return;
      if (frame.size && imageSize && (frame.size.width !== imageSize.width || frame.size.height !== imageSize.height)) bounds = undefined;
      imageSize = frame.size;
      const image = bounds ? crop(frame.dataUrl, bounds) : frame.dataUrl;
      hash = createHash('sha256').update(image).digest('hex');
      if (hash === lastHash || (hash === failedHash && Date.now() - failedAt < 15000)) return;
      publish({ status: 'reading', message: 'Reading the visible board…', answer: '' });
      const observed = await recognize(image, { signal: controller.signal, orientation, cropped: Boolean(bounds) });
      if (generation !== epoch) return;
      if (!observed.visible) {
        bounds = undefined; failedHash = hash; failedAt = Date.now();
        publish({ status: 'waiting', message: observed.reason || 'Keep the board visible.', answer: '' }); return;
      }
      if (!bounds && observed.bounds) bounds = observed.bounds;
      orientation = settings.orientation === 'auto' ? observed.orientation : settings.orientation;
      const result = tracker.observe(observed.placement);
      lastHash = hash; failedHash = undefined;
      if (result.gameOver) {
        const chess = new (require('chess.js').Chess)(result.fen);
        publish({ status: 'ready', message: 'Watching for board changes.', answer: chess.isCheckmate() ? 'Checkmate.' : 'Game over · draw.', lastAnswer: '' });
        return;
      }
      if (!result.changed && lastFen === result.fen) { publish({ status: 'ready', message: 'Watching for board changes.', answer: state.lastAnswer || '' }); return; }
      publish({ status: 'thinking', message: 'Stockfish is analyzing…', answer: '' });
      const recommendation = await currentEngine.analyze(result.fen, { path: settings.path || undefined, movetime: 700, position: tracker.position() });
      if (generation !== epoch) return;
      const turn = result.fen.split(' ')[1] === 'w' ? 'White' : 'Black';
      const answer = recommendation.bestmove ? `${turn} · ${describeMove(result.fen, recommendation.bestmove)}` : 'Game over · no legal move.';
      lastFen = result.fen;
      publish({ status: 'ready', message: 'Watching for board changes.', answer, lastAnswer: answer });
    } catch (error) {
      if (generation !== epoch) return;
      failedHash = hash; failedAt = Date.now(); bounds = undefined;
      lastHash = undefined;
      publish({ status: 'waiting', message: error.message, answer: '' });
    } finally {
      if (generation === epoch && state.running) { controller = null; timer = setTimeout(() => tick(generation), settings.interval); }
    }
  }
  return {
    status, stop,
    start() { if (state.running) return status(); currentEngine ||= engineFactory?.(); const generation = ++epoch; bounds = undefined; failedHash = undefined; orientation = settings.orientation; publish({ running: true, status: 'watching', message: 'Locating the visible board…', answer: '' }); void tick(generation); return status(); },
    async configure(input) {
      const next = validateSettings({ ...settings, ...input });
      await save(next); stop(); settings = next; tracker = createTracker(settings.initialFen); bounds = undefined;
      return publish({ status: 'paused', message: 'Chess setup saved. Choose Watch board.', answer: '', lastAnswer: '' });
    },
    reset(input = {}) { const next = createTracker(input.fen || settings.initialFen); stop(); tracker = next; bounds = undefined; return publish({ message: 'Position reset. Choose Watch board.', answer: '', lastAnswer: '' }); }
  };
}
module.exports = { createLiveChess, validateSettings };
