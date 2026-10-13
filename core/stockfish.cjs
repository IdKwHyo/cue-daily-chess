const { spawn } = require('node:child_process');
const { Chess } = require('chess.js');

const HANDSHAKE_TIMEOUT = 5000;
const SEARCH_GRACE = 3000;
const MOVE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

function readFen(value, label = 'FEN') {
  if (typeof value !== 'string' || value.length > 256 || /[\r\n\0]/.test(value)) {
    throw new Error(`${label} must be a valid single-line chess position.`);
  }
  try {
    const chess = new Chess(value);
    const previousKing = chess.board().flat().find(piece => piece?.type === 'k' && piece.color !== chess.turn());
    if (previousKing && chess.isAttacked(previousKing.square, chess.turn())) {
      throw new Error('The side that just moved cannot leave its king in check.');
    }
    return chess;
  } catch (error) {
    throw new Error(`Invalid ${label}: ${error.message}`);
  }
}

function preparePosition(fen, position) {
  const chess = readFen(fen);
  const currentFen = chess.fen();
  if (position === undefined) return { chess, command: `position fen ${currentFen}` };
  if (!position || typeof position !== 'object' || !Array.isArray(position.moves) || position.moves.length > 2000) {
    throw new Error('Stockfish position history must contain an initial FEN and a moves array.');
  }
  const replay = readFen(position.fen, 'initial FEN');
  const initialFen = replay.fen();
  for (const move of position.moves) {
    if (typeof move !== 'string' || !MOVE.test(move)) throw new Error('Invalid UCI move in position history.');
    try {
      replay.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] });
    } catch {
      throw new Error(`Illegal move ${move} in position history.`);
    }
  }
  if (replay.fen() !== currentFen) throw new Error('Position history does not match the current FEN.');
  return { chess, command: `position fen ${initialFen}${position.moves.length ? ` moves ${position.moves.join(' ')}` : ''}` };
}

function enginePath(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096 || /[\r\n\0]/.test(value)) {
    throw new Error('Stockfish path must be a single executable path without line breaks.');
  }
  return value.trim();
}

function parseInfo(line, result) {
  if (!line.startsWith('info ')) return;
  const multipv = line.match(/\bmultipv (\d+)\b/);
  if (multipv && Number(multipv[1]) !== 1) return;
  const depth = line.match(/\bdepth (\d+)\b/);
  const score = line.match(/\bscore (cp|mate) (-?\d+)\b/);
  const pv = line.match(/\bpv (.+)$/);
  if (depth) result.depth = Number(depth[1]);
  // A bound is not an exact evaluation. Keep the last exact score, if available.
  if (score && !/\b(?:lowerbound|upperbound)\b/.test(line)) {
    result.score = { type: score[1], value: Number(score[2]) };
  }
  if (pv) {
    const moves = pv[1].trim().split(/\s+/);
    if (moves.every(move => MOVE.test(move))) result.pv = moves;
  }
}

function createStockfish({ spawnImpl = spawn, env = process.env } = {}) {
  const childEnv = { ...process.env, ...env };
  const sessions = new Set();
  let current = null;
  let busy = false;
  let closed = false;

  function rawWrite(session, command) {
    if (!session.child.stdin || session.child.stdin.destroyed || !session.child.stdin.writable) {
      throw new Error('Stockfish input pipe is unavailable.');
    }
    session.child.stdin.write(`${command}\n`, error => {
      if (error && session.active) retire(session, new Error(`Stockfish input failed: ${error.message}`));
    });
  }

  function retire(session, error, { stop = false, immediate = false } = {}) {
    if (!session.active && !immediate) return;
    if (stop && session.active) {
      try { rawWrite(session, 'stop'); } catch { /* The engine may have already exited. */ }
    }
    session.active = false;
    session.buffer = '';
    if (current === session) current = null;
    for (const waiter of [...session.waiters]) waiter.reject(error);
    if (session.killTimer) clearTimeout(session.killTimer);
    session.killTimer = null;
    if (session.exited) return;
    try { rawWrite(session, 'quit'); } catch { /* Always attempt termination below. */ }
    if (immediate) {
      try { session.child.kill(); } catch { /* Already exited. */ }
    } else {
      session.killTimer = setTimeout(() => {
        session.killTimer = null;
        try { session.child.kill(); } catch { /* Already exited. */ }
      }, 150);
      session.killTimer.unref?.();
    }
  }

  function send(session, command) {
    if (!session.active || closed) throw new Error('Stockfish is unavailable.');
    try {
      rawWrite(session, command);
    } catch (error) {
      retire(session, error);
      throw error;
    }
  }

  function waitFor(session, match, timeout, description, { searching = false } = {}) {
    const promise = new Promise((resolve, reject) => {
      if (!session.active) return reject(new Error('Stockfish is unavailable.'));
      let timer;
      const waiter = {
        line(line) {
          try {
            const found = match(line);
            if (found !== undefined) finish(resolve, found);
          } catch (error) { finish(reject, error); }
        },
        reject(error) { finish(reject, error); }
      };
      function finish(callback, value) {
        if (!session.waiters.delete(waiter)) return;
        clearTimeout(timer);
        callback(value);
      }
      session.waiters.add(waiter);
      timer = setTimeout(() => {
        retire(session, new Error(`Stockfish timed out ${description}.`), { stop: searching });
      }, timeout);
    });
    // send() can fail before its caller reaches await. The caller still receives
    // the failure, while an already registered waiter can safely be rejected.
    promise.catch(() => {});
    return promise;
  }

  function start(command) {
    let child;
    try {
      child = spawnImpl(command, [], { env: childEnv, stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true });
    } catch (error) {
      const failure = new Error(`Could not start Stockfish: ${error.message}`);
      failure.code = error.code;
      throw failure;
    }
    const session = { child, command, engine: '', active: true, exited: false, buffer: '', stderr: '', waiters: new Set(), killTimer: null };
    sessions.add(session);
    current = session;
    child.stdout?.setEncoding?.('utf8');
    child.stderr?.setEncoding?.('utf8');
    child.stdout?.on('data', data => {
      if (!session.active) return;
      session.buffer += String(data);
      if (session.buffer.length > 131072) {
        retire(session, new Error('Stockfish sent an oversized response.'));
        return;
      }
      let newline;
      while (session.active && (newline = session.buffer.indexOf('\n')) !== -1) {
        const line = session.buffer.slice(0, newline).trim();
        session.buffer = session.buffer.slice(newline + 1);
        if (line.startsWith('id name ')) session.engine = line.slice(8).trim();
        for (const waiter of [...session.waiters]) waiter.line(line);
      }
    });
    child.stderr?.on('data', data => { session.stderr = (session.stderr + String(data)).slice(-2000); });
    child.stdin?.on('error', error => {
      if (session.active) retire(session, new Error(`Stockfish input failed: ${error.message}`));
    });
    child.on('error', error => {
      const failure = new Error(`Could not start Stockfish: ${error.message}`);
      failure.code = error.code;
      retire(session, failure);
    });
    child.on('exit', () => {
      session.exited = true;
      if (session.killTimer) clearTimeout(session.killTimer);
      session.killTimer = null;
    });
    child.on('close', (code, signal) => {
      session.exited = true;
      if (session.active) {
        const detail = session.stderr.replace(/[\x00-\x1f\x7f]/g, ' ').trim();
        retire(session, new Error(`Stockfish exited ${signal ? `(${signal})` : `(code ${code})`}${detail ? `: ${detail}` : '.'}`));
      }
      if (session.killTimer) clearTimeout(session.killTimer);
      session.killTimer = null;
      sessions.delete(session);
    });
    return session;
  }

  async function initialize(command) {
    const session = start(command);
    try {
      const initialized = waitFor(session, line => line === 'uciok' ? true : undefined, HANDSHAKE_TIMEOUT, 'during UCI initialization');
      send(session, 'uci');
      await initialized;
      const ready = waitFor(session, line => line === 'readyok' ? true : undefined, HANDSHAKE_TIMEOUT, 'while waiting for engine readiness');
      send(session, 'ucinewgame');
      send(session, 'isready');
      await ready;
      return session;
    } catch (error) {
      retire(session, error);
      throw error;
    }
  }

  async function getEngine(path) {
    let candidates;
    if (path !== undefined) candidates = [enginePath(path)];
    else if (childEnv.STOCKFISH_PATH) candidates = [enginePath(childEnv.STOCKFISH_PATH)];
    else candidates = process.platform === 'darwin' ? ['stockfish', '/opt/homebrew/bin/stockfish', '/usr/local/bin/stockfish'] : ['stockfish'];
    if (current?.active && !current.exited && candidates.includes(current.command)) return current;
    if (current) retire(current, new Error('Stockfish executable changed.'));
    for (const command of candidates) {
      try { return await initialize(command); }
      catch (error) {
        if (closed || error.code !== 'ENOENT') throw error;
      }
    }
    throw new Error('Stockfish was not found. Install Stockfish and set its executable path or STOCKFISH_PATH.');
  }

  return {
    async analyze(fen, options = {}) {
      if (closed) throw new Error('Stockfish has been closed.');
      if (busy) throw new Error('Stockfish is busy with the current position.');
      if (!options || typeof options !== 'object') throw new Error('Invalid Stockfish search options.');
      const movetime = options.movetime ?? 1000;
      if (!Number.isInteger(movetime) || movetime < 1 || movetime > 30000) throw new Error('Stockfish movetime must be an integer between 1 and 30000 milliseconds.');
      const position = preparePosition(fen, options.position);
      // Validate configured paths before spawning or sending any engine commands.
      if (options.path !== undefined) enginePath(options.path);
      busy = true;
      let session;
      try {
        session = await getEngine(options.path);
        const result = { engine: session.engine || 'Stockfish' };
        const complete = waitFor(session, line => {
          parseInfo(line, result);
          if (!line.startsWith('bestmove ')) return undefined;
          const response = line.match(/^bestmove (\S+)(?: ponder (\S+))?$/);
          if (!response) throw new Error('Stockfish returned an invalid bestmove response.');
          const move = response[1];
          if (move === '(none)' || move === '0000') {
            if (position.chess.moves().length) throw new Error('Stockfish returned no move for a playable position.');
            result.bestmove = null;
          } else {
            if (!MOVE.test(move)) throw new Error('Stockfish returned an invalid move.');
            try { position.chess.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] }); }
            catch { throw new Error('Stockfish returned an illegal move for this position.'); }
            result.bestmove = move;
          }
          if (response[2] && MOVE.test(response[2])) result.ponder = response[2];
          return result;
        }, movetime + SEARCH_GRACE, 'while analyzing the position', { searching: true });
        send(session, position.command);
        send(session, `go movetime ${movetime}`);
        return await complete;
      } catch (error) {
        if (session) retire(session, error, { stop: true });
        throw error;
      } finally { busy = false; }
    },
    close() {
      closed = true;
      for (const session of sessions) retire(session, new Error('Stockfish has been closed.'), { stop: true, immediate: true });
      current = null;
    }
  };
}

module.exports = { createStockfish };
