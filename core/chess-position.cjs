'use strict';
const { Chess, DEFAULT_POSITION, validateFen } = require('chess.js');
const START_FEN = DEFAULT_POSITION;
const MAX_TRANSITIONS = 12000;
const fullFen = chess => chess.fen({ forceEnpassantSquare: true });
const placementOf = fen => fen.split(' ')[0];
const moveInput = move => ({ from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion } : {}) });
const uciOf = move => `${move.from}${move.to}${move.promotion || ''}`;

function validatePlacement(placement) {
  if (typeof placement !== 'string' || placement.length > 71 || !/^[pnbrqkPNBRQK1-8/]+$/.test(placement)) {
    throw new Error('Invalid board placement. Read all 64 squares before analyzing.');
  }
  // The temporary metadata is used only for structural validation; it never initializes game state.
  const validation = validateFen(`${placement} w - - 0 1`);
  if (!validation.ok) throw new Error(validation.error);
  const pieces = placement.replace(/[^a-z]/gi, '');
  if (pieces.length > 32) throw new Error('Invalid board placement: more than 32 pieces.');
  for (const white of [true, false]) {
    const own = pieces.split('').filter(piece => (piece === piece.toUpperCase()) === white).join('').toLowerCase();
    const count = piece => [...own].filter(value => value === piece).length;
    const pawns = count('p');
    const promotions = Math.max(0, count('q') - 1) + Math.max(0, count('r') - 2) + Math.max(0, count('b') - 2) + Math.max(0, count('n') - 2);
    if (pawns > 8 || promotions > 8 - pawns) throw new Error('Invalid board placement: impossible pawn or promoted piece count.');
  }
  return placement;
}

function loadConfirmedFen(fen) {
  if (typeof fen !== 'string' || fen.length > 200) throw new Error('Import a complete full FEN with all six fields.');
  const fields = fen.trim().split(/\s+/);
  if (fields.length !== 6) throw new Error('Import a complete full FEN with all six fields.');
  validatePlacement(fields[0]);
  const validation = validateFen(fields.join(' '));
  if (!validation.ok) throw new Error(validation.error);
  if (!/^(?:-|K?Q?k?q?)$/.test(fields[2]) || !fields[2]) throw new Error('Invalid FEN castling rights.');
  if (!/^\d+$/.test(fields[4]) || Number(fields[4]) > 32767 || !/^\d+$/.test(fields[5]) || Number(fields[5]) > 50000) {
    throw new Error('Invalid FEN move counters.');
  }
  const chess = new Chess(fields.join(' '));
  const rights = { K: ['e1', 'h1', 'w'], Q: ['e1', 'a1', 'w'], k: ['e8', 'h8', 'b'], q: ['e8', 'a8', 'b'] };
  for (const right of fields[2].replace('-', '')) {
    const [kingSquare, rookSquare, color] = rights[right];
    if (chess.get(kingSquare)?.type !== 'k' || chess.get(kingSquare)?.color !== color ||
        chess.get(rookSquare)?.type !== 'r' || chess.get(rookSquare)?.color !== color) {
      throw new Error('Invalid FEN castling rights: the king and rook must be on their original squares.');
    }
  }
  const otherColor = chess.turn() === 'w' ? 'b' : 'w';
  const otherKing = chess.findPiece({ type: 'k', color: otherColor })[0];
  if (chess.isAttacked(otherKing, chess.turn())) throw new Error('Invalid FEN: the king of the side not to move is attacked.');
  if (fields[3] !== '-') {
    const file = fields[3][0];
    const pawnSquare = `${file}${chess.turn() === 'w' ? '5' : '4'}`;
    const originSquare = `${file}${chess.turn() === 'w' ? '7' : '2'}`;
    const pawn = chess.get(pawnSquare);
    if (chess.get(fields[3]) || chess.get(originSquare) || pawn?.type !== 'p' || pawn.color !== otherColor) {
      throw new Error('Invalid FEN en passant state: the last double pawn move does not match the board.');
    }
  }
  return { chess, fen: fields.join(' ') };
}

function createTracker(initialFen = START_FEN) {
  const initial = loadConfirmedFen(initialFen);
  let chess = initial.chess;
  let baseFen = initial.fen;
  let moves = [];
  const position = () => ({ fen: baseFen, moves: [...moves] });
  const result = changed => ({ changed, fen: fullFen(chess), position: position(), gameOver: chess.isGameOver() });
  return {
    fen: () => fullFen(chess),
    position,
    reset(fen = START_FEN) {
      const next = loadConfirmedFen(fen);
      chess = next.chess;
      baseFen = next.fen;
      moves = [];
      return result(true);
    },
    observe(placement) {
      validatePlacement(placement);
      if (placement === placementOf(fullFen(chess))) return result(false);
      const search = new Chess(fullFen(chess));
      const matches = new Map();
      let inspected = 0;
      function inspect(path) {
        if (++inspected > MAX_TRANSITIONS) throw new Error('The board has too many possible transitions. Import a full FEN to reset the position.');
        const candidateFen = fullFen(search);
        if (placementOf(candidateFen) === placement) matches.set(candidateFen, path);
      }
      for (const first of search.moves({ verbose: true })) {
        search.move(moveInput(first));
        inspect([uciOf(first)]);
        for (const second of search.moves({ verbose: true })) {
          search.move(moveInput(second));
          inspect([uciOf(first), uciOf(second)]);
          search.undo();
        }
        search.undo();
      }
      if (!matches.size) throw new Error('Could not match the board within two legal moves. If moves were missed or the game started mid-position, import a full FEN to reset.');
      if (matches.size > 1) throw new Error('The board matches more than one legal position. Import a full FEN to confirm whose turn and special move rights.');
      for (const uci of matches.values().next().value) {
        chess.move(uci);
        moves.push(uci);
      }
      return result(true);
    }
  };
}

function describeMove(fen, uci) {
  const { chess } = loadConfirmedFen(fen);
  if (uci === '0000' || uci === '(none)') {
    if (chess.isCheckmate()) return 'Checkmate';
    if (chess.isStalemate()) return 'Stalemate';
    if (chess.isInsufficientMaterial()) return 'Draw — insufficient material';
    if (chess.isDrawByFiftyMoves()) return 'Draw — fifty-move rule';
    throw new Error('The engine returned no move while legal moves are available.');
  }
  if (typeof uci !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) throw new Error('Invalid engine move.');
  let move;
  try { move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci[4] ? { promotion: uci[4] } : {}) }); }
  catch { throw new Error('The engine move is not legal for the confirmed position.'); }
  const names = { p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King' };
  const labels = [];
  if (move.isKingsideCastle()) labels.push('Castle kingside');
  if (move.isQueensideCastle()) labels.push('Castle queenside');
  labels.push(`${names[move.piece]} ${move.from} → ${move.to}`);
  if (move.isCapture() || move.isEnPassant()) labels.push(`captures ${names[move.captured].toLowerCase()}${move.isEnPassant() ? ' en passant' : ''}`);
  if (move.isPromotion()) labels.push(`promotes to ${names[move.promotion].toLowerCase()}`);
  if (chess.isCheckmate()) labels.push('Checkmate');
  else if (chess.isCheck()) labels.push('Check');
  return labels.join(' · ');
}

module.exports = { createTracker, describeMove, START_FEN };
