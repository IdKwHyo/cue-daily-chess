'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTracker, describeMove, START_FEN } = require('../core/chess-position.cjs');

test('observes a legal move and preserves its engine position history', () => {
  const tracker = createTracker();
  const initial = tracker.observe(START_FEN.split(' ')[0]);
  assert.equal(initial.changed, false);
  const result = tracker.observe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR');
  assert.equal(result.changed, true);
  assert.equal(result.fen, 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
  assert.deepEqual(tracker.position(), { fen: START_FEN, moves: ['e2e4'] });
  assert.deepEqual(result.position, tracker.position());
  result.position.moves.push('invalid');
  assert.deepEqual(tracker.position().moves, ['e2e4']);
});

test('recovers two missed plies without guessing the turn or dropping history', () => {
  const tracker = createTracker();
  const result = tracker.observe('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR');
  assert.equal(result.fen, 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2');
  assert.deepEqual(result.position.moves, ['e2e4', 'e7e5']);
  assert.equal(tracker.observe('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR').changed, false);
});

test('rejects malformed observations and missed move sequences without changing the confirmed state', () => {
  const tracker = createTracker();
  for (const placement of [null, '8/8/8', '8/8/8/8/8/8/8/8',
    '4k3/8/8/8/8/8/8/4KK2', '4k3/8/8/8/8/8/8/P3K3', START_FEN,
    'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R']) {
    assert.throws(() => tracker.observe(placement), /board|placement|FEN|king|pawn/i);
    assert.equal(tracker.fen(), START_FEN);
    assert.deepEqual(tracker.position().moves, []);
  }
});

test('reset requires a complete legal FEN and never guesses hidden game state', () => {
  const tracker = createTracker();
  assert.throws(() => tracker.reset('4k3/8/8/8/8/8/8/4K3'), /full FEN|six|complete/i);
  assert.throws(() => tracker.reset('4k3/8/8/8/8/8/8/4K3 w KQ - 0 1'), /castling/i);
  assert.throws(() => tracker.reset('4k3/8/8/8/8/8/4R3/4K3 w - - 0 1'), /king|legal/i);
  assert.equal(tracker.fen(), START_FEN);
  const fen = '4k3/8/8/8/8/8/4P3/4K3 b - - 10 12';
  tracker.reset(fen);
  assert.equal(tracker.fen(), fen);
  assert.deepEqual(tracker.position(), { fen, moves: [] });
});

test('describes engine moves with piece names, special moves and terminal status', () => {
  assert.equal(describeMove('4k3/8/8/5p2/4B3/8/8/4K3 w - - 0 1', 'e4f5'), 'Bishop e4 → f5 · captures pawn');
  assert.equal(describeMove('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'e1g1'), 'Castle kingside · King e1 → g1');
  assert.equal(describeMove('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 3', 'e5d6'), 'Pawn e5 → d6 · captures pawn en passant');
  assert.equal(describeMove('4k3/P7/8/8/8/8/8/4K3 w - - 0 1', 'a7a8q'), 'Pawn a7 → a8 · promotes to queen · Check');
  assert.equal(describeMove('rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2', 'd8h4'), 'Queen d8 → h4 · Checkmate');
  assert.equal(describeMove('7k/5K2/6Q1/8/8/8/8/8 b - - 0 1', '0000'), 'Stalemate');
  assert.throws(() => describeMove(START_FEN, 'e2e5'), /legal|invalid/i);
  assert.throws(() => describeMove(START_FEN, 'e2e4\nquit'), /invalid/i);
  assert.throws(() => describeMove(START_FEN, '0000'), /legal|no move/i);
});

test('retains lost castling rights even when a rook returns to its starting square', () => {
  const tracker = createTracker('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  tracker.observe('r3k2r/8/8/8/8/8/7R/R3K3');
  tracker.observe('4k2r/r7/8/8/8/8/7R/R3K3');
  tracker.observe('4k2r/r7/8/8/8/8/8/R3K2R');
  assert.equal(tracker.fen(), '4k2r/r7/8/8/8/8/8/R3K2R b Qk - 3 2');
  assert.deepEqual(tracker.position().moves, ['h1h2', 'a8a7', 'h2h1']);
});

test('recovers an en passant capture across two plies and reports a terminal board', () => {
  const tracker = createTracker('4k3/3p4/8/4P3/8/8/8/4K3 b - - 0 1');
  const result = tracker.observe('4k3/8/3P4/8/8/8/8/4K3');
  assert.equal(result.fen, '4k3/8/3P4/8/8/8/8/4K3 b - - 0 2');
  assert.deepEqual(result.position.moves, ['d7d5', 'e5d6']);
  assert.equal(createTracker('7k/5K2/6Q1/8/8/8/8/8 b - - 0 1').observe('7k/5K2/6Q1/8/8/8/8/8').gameOver, true);
});
