const { createInterface } = require('node:readline');
const { appendFileSync } = require('node:fs');
const mode = process.env.FAKE_STOCKFISH_MODE || 'normal';
const delay = Number(process.env.FAKE_SEARCH_DELAY || 20);
function fragmented(text) {
  const cut = Math.max(1, Math.floor(text.length / 3));
  process.stdout.write(text.slice(0, cut));
  setTimeout(() => process.stdout.write(text.slice(cut, cut * 2)), 2);
  setTimeout(() => process.stdout.write(text.slice(cut * 2)), 4);
}
createInterface({ input: process.stdin }).on('line', command => {
  if (process.env.FAKE_STOCKFISH_LOG) appendFileSync(process.env.FAKE_STOCKFISH_LOG, `${command}\n`);
  if (command === 'uci') {
    if (mode !== 'hang-start') fragmented('id name Fake Fish 1.0\r\nuciok\r\n');
  } else if (command === 'isready') fragmented('readyok\n');
  else if (command.startsWith('go ')) {
    if (mode === 'crash') {
      process.stderr.write('fake search failure\n');
      process.exitCode = 7;
      process.stdin.destroy();
      return;
    }
    if (mode === 'timeout') { process.stdout.write('info depth 1 score cp 1 pv e2e4\n'); return; }
    if (mode === 'terminal') { fragmented('info depth 0 score mate 0\nbestmove (none)\n'); return; }
    setTimeout(() => fragmented('info depth 12 score cp 38 pv e2e4 e7e5\ninfo depth 13 multipv 2 score cp 2 pv d2d4 d7d5\ninfo depth 14 score cp 50 lowerbound pv e2e4 e7e5\nbestmove e2e4 ponder e7e5\n'), delay);
  } else if (command === 'stop' && mode === 'timeout') {
    // Deliberately send a stale answer while the next process may be searching.
    setTimeout(() => process.stdout.write('bestmove d2d4\n'), 80);
  } else if (command === 'quit') {
    if (mode === 'timeout') setTimeout(() => process.exit(0), 120);
    else process.exit(0);
  }
});
