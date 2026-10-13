const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { Chess } = require('chess.js');
const { createStockfish } = require('../core/stockfish.cjs');
const fixture = join(__dirname, 'fixtures/fake-stockfish.cjs');
const fen = new Chess().fen();

function fake(t, { mode = 'normal', env = {}, modes, calls = [] } = {}) {
  const engine = createStockfish({ env: { ...env, STOCKFISH_PATH: '/fake/stockfish' }, spawnImpl(command, args, options) {
    calls.push({ command, args, options });
    return spawn(process.execPath, [fixture], { ...options, env: { ...options.env, FAKE_STOCKFISH_MODE: modes?.[calls.length - 1] || mode } });
  } });
  t.after(() => engine.close());
  return engine;
}

test('handles fragmented UCI handshakes and info lines without mixing alternate PV or bound scores', async t => {
  const calls = [];
  const engine = fake(t, { calls });
  const result = await engine.analyze(fen, { movetime: 20 });
  assert.deepEqual(result, { engine: 'Fake Fish 1.0', depth: 14, score: { type: 'cp', value: 38 }, pv: ['e2e4', 'e7e5'], bestmove: 'e2e4', ponder: 'e7e5' });
  await engine.analyze(fen, { movetime: 20 });
  assert.equal(calls.length, 1, 'finished searches reuse one ready engine');
  assert.equal(calls[0].command, '/fake/stockfish');
  assert.deepEqual(calls[0].args, []);
  assert.equal(calls[0].options.shell, false);
});

test('rejects invalid FEN, command injection, search durations and illegal history before spawning', async t => {
  const calls = [];
  const engine = fake(t, { calls });
  await assert.rejects(engine.analyze('not a fen'), /Invalid FEN/);
  await assert.rejects(engine.analyze('8/8/8/8/8/8/4k3/4K3 w - - 0 1'), /king in check/);
  await assert.rejects(engine.analyze(`${fen}\ngo infinite`), /single-line/);
  await assert.rejects(engine.analyze(fen, { path: '/some/path\nquit' }), /single executable/);
  await assert.rejects(engine.analyze(fen, { movetime: 0 }), /movetime/);
  await assert.rejects(engine.analyze(fen, { movetime: 1.5 }), /movetime/);
  await assert.rejects(engine.analyze(fen, { position: { fen, moves: ['e2e5'] } }), /Illegal move/);
  await assert.rejects(engine.analyze(fen, { position: { fen, moves: ['e2e4\nquit'] } }), /Invalid UCI/);
  await assert.rejects(engine.analyze(fen, { position: { fen, moves: ['e2e4'] } }), /does not match/);
  assert.equal(calls.length, 0);
});

test('retains full legal move history in the UCI position command for repetition', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'cue-stockfish-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const log = join(directory, 'commands');
  const engine = fake(t, { env: { FAKE_STOCKFISH_LOG: log } });
  const chess = new Chess();
  const moves = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
  for (const move of moves) chess.move({ from: move.slice(0, 2), to: move.slice(2, 4) });
  await engine.analyze(chess.fen(), { movetime: 20, position: { fen, moves } });
  const commands = readFileSync(log, 'utf8').trim().split('\n');
  assert.deepEqual(commands.slice(0, 3), ['uci', 'ucinewgame', 'isready']);
  assert.ok(commands.includes(`position fen ${fen} moves ${moves.join(' ')}`));
  assert.equal(commands.at(-1), 'go movetime 20');
});

test('rejects concurrent searches and releases the busy slot after completion', async t => {
  const engine = fake(t, { env: { FAKE_SEARCH_DELAY: '80' } });
  const pending = engine.analyze(fen, { movetime: 20 });
  await assert.rejects(engine.analyze(fen), /busy/);
  assert.equal((await pending).bestmove, 'e2e4');
  assert.equal((await engine.analyze(fen, { movetime: 20 })).bestmove, 'e2e4');
});

test('process death rejects the active search and a subsequent search starts a fresh engine', async t => {
  const calls = [];
  const engine = fake(t, { calls, modes: ['crash', 'normal'] });
  await assert.rejects(engine.analyze(fen, { movetime: 20 }), /exited.*code 7.*fake search failure/);
  assert.equal((await engine.analyze(fen, { movetime: 20 })).bestmove, 'e2e4');
  assert.equal(calls.length, 2);
});

test('search timeout sends stop and isolates late bestmove output from the replacement process', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'cue-stockfish-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const log = join(directory, 'commands');
  const calls = [];
  const engine = fake(t, { calls, modes: ['timeout', 'normal'], env: { FAKE_STOCKFISH_LOG: log, FAKE_SEARCH_DELAY: '140' } });
  await assert.rejects(engine.analyze(fen, { movetime: 1 }), /timed out.*analyzing/);
  assert.equal((await engine.analyze(fen, { movetime: 20 })).bestmove, 'e2e4');
  assert.equal(calls.length, 2);
  const commands = readFileSync(log, 'utf8').trim().split('\n');
  assert.ok(commands.includes('stop'));
});

test('closing during initialization clears waiters and prevents future searches', async t => {
  const engine = fake(t, { mode: 'hang-start' });
  const pending = engine.analyze(fen, { movetime: 20 });
  engine.close();
  await assert.rejects(pending, /closed/);
  await assert.rejects(engine.analyze(fen), /closed/);
});

test('terminal positions expose no best move and preserve mate score', async t => {
  const engine = fake(t, { mode: 'terminal' });
  const mate = '7k/6Q1/6K1/8/8/8/8/8 b - - 0 1';
  assert.deepEqual(await engine.analyze(mate, { movetime: 20 }), { engine: 'Fake Fish 1.0', depth: 0, score: { type: 'mate', value: 0 }, bestmove: null });
});

test('settings executable override takes precedence over STOCKFISH_PATH and never invokes a shell', async t => {
  const calls = [];
  const engine = fake(t, { calls });
  await engine.analyze(fen, { path: '/path with spaces/Stockfish', movetime: 20 });
  assert.equal(calls[0].command, '/path with spaces/Stockfish');
  assert.equal(calls[0].options.shell, false);
});

test('missing native engine gives an actionable error and allows another attempt', async t => {
  let calls = 0;
  const engine = createStockfish({ env: { STOCKFISH_PATH: '/definitely-missing/cue-stockfish' }, spawnImpl(...args) { calls++; return spawn(...args); } });
  t.after(() => engine.close());
  await assert.rejects(engine.analyze(fen), /not found.*Install Stockfish/);
  await assert.rejects(engine.analyze(fen), /not found.*Install Stockfish/);
  assert.equal(calls, 2);
});
