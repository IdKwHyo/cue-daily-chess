import { markdown, escape } from './render.js';

const $ = id => document.getElementById(id);
const defaults = { path: '', interval: 4000, orientation: 'auto', initialFen: 'start' };
const desktopAvailable = () => typeof window.desktop?.chess === 'function';
let mode = 'daily';
let snapshot = { running: false, status: 'paused', message: 'Keep your board visible, then choose Watch board.', settings: defaults };
let operation = null;
let queue = Promise.resolve();
let settingsEdited = false;
let visibleAnswer = '';
let answerValid = false;
let eventRevision = 0;
const HISTORY_KEY = 'cue.daily.chess.history.v1';
let history = [];
try {
  const saved = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  if (Array.isArray(saved)) history = saved.slice(-400).filter(entry => typeof entry?.answer === 'string' && typeof entry?.fen === 'string').map(entry => ({ answer: entry.answer.slice(0, 2000), fen: entry.fen.slice(0, 200) }));
} catch { /* A damaged history must not prevent opening the overlay. */ }
let renderedHistory = '';
function saveHistory() {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); }
  catch { copyStatus.textContent = 'History stays in this window; device storage is unavailable.'; }
}

const stylesheetUrl = new URL('./chess.css', import.meta.url).href;
if (![...document.querySelectorAll('link[rel="stylesheet"]')].some(link => link.href === stylesheetUrl)) {
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = stylesheetUrl;
  document.head.append(stylesheet);
}

const setup = document.createElement('fieldset');
setup.id = 'chessSetup';
setup.className = 'chess-setup';
setup.hidden = true;
setup.innerHTML = `<legend>Chess setup</legend>
  <p class="small muted">Keep the board visible. Recognition sends changed board crops to your configured Gemini model.</p>
  <label for="stockfishPath">Stockfish executable path</label>
  <input id="stockfishPath" autocomplete="off" spellcheck="false" maxlength="1024" placeholder="Leave blank to find Stockfish automatically">
  <p class="small muted">Stockfish evaluates positions locally. On macOS, install it with Homebrew or choose the downloaded executable.</p>
  <div class="settings-row">
    <div><label for="boardOrientation">Board orientation</label><select id="boardOrientation"><option value="auto">Detect automatically</option><option value="white">White at the bottom</option><option value="black">Black at the bottom</option></select></div>
    <div><label for="chessInterval">Check screen every</label><select id="chessInterval"><option value="2000">2 seconds</option><option value="4000">4 seconds</option><option value="8000">8 seconds</option></select></div>
  </div>
  <label for="chessInitialFen">Starting position (FEN)</label>
  <input id="chessInitialFen" autocomplete="off" spellcheck="false" maxlength="200" value="start" aria-describedby="chessFenHelp">
  <p id="chessFenHelp" class="small muted">Use “start” for a new game. For an existing game, paste its full FEN so turn, castling and en passant are known.</p>
  <button id="saveChessSetup" type="button" class="secondary">Save chess setup</button>
  <p id="chessSettingsStatus" class="small muted" role="status" aria-live="polite" hidden></p>`;
$('settingsForm').insertBefore(setup, $('settingsForm').querySelector('.dialog-actions'));

const chessTools = document.createElement('div');
chessTools.className = 'chess-answer-tools';
chessTools.hidden = true;
const copyButton = document.createElement('button');
copyButton.id = 'copyChessMove';
copyButton.type = 'button';
copyButton.className = 'text-button';
copyButton.textContent = 'Copy move';
copyButton.disabled = true;
const copyStatus = document.createElement('span');
copyStatus.className = 'small muted';
copyStatus.setAttribute('role', 'status');
copyStatus.setAttribute('aria-live', 'polite');
chessTools.append(copyButton, copyStatus);
const loadFenButton = document.createElement('button');
loadFenButton.id = 'loadChessFen'; loadFenButton.type = 'button'; loadFenButton.className = 'text-button'; loadFenButton.textContent = 'Load FEN';
const newGameButton = document.createElement('button');
newGameButton.id = 'newChessGame'; newGameButton.type = 'button'; newGameButton.className = 'text-button'; newGameButton.textContent = 'New game';
const clearHistoryButton = document.createElement('button');
clearHistoryButton.id = 'clearChessHistory'; clearHistoryButton.type = 'button'; clearHistoryButton.className = 'text-button'; clearHistoryButton.textContent = 'Clear history';
chessTools.prepend(loadFenButton, newGameButton);
chessTools.append(clearHistoryButton);
document.querySelector('.answer-panel').insertBefore(chessTools, $('followupForm'));

const fenDialog = document.createElement('dialog');
fenDialog.id = 'chessFenDialog'; fenDialog.setAttribute('aria-labelledby', 'fenDialogTitle');
fenDialog.innerHTML = `<form id="chessFenForm"><h2 id="fenDialogTitle">Load a chess position</h2>
  <label for="chessFenText">Full FEN</label><textarea id="chessFenText" rows="4" maxlength="200" spellcheck="false" required aria-describedby="fenImportHelp" placeholder="Paste all six FEN fields here"></textarea>
  <p id="fenImportHelp" class="small muted">Paste the FEN from your chess app’s export or analysis page, or choose a .fen / .txt file. Include turn, castling, en passant and both move counters.</p>
  <label for="chessFenFile">Or import a FEN file</label><input id="chessFenFile" type="file" accept=".fen,.txt,text/plain">
  <p id="fenImportError" class="error" role="alert" hidden></p>
  <div class="dialog-actions"><button id="cancelChessFen" type="button" class="secondary">Cancel</button><button id="applyChessFen" type="submit" class="primary">Load position</button></div></form>`;
document.body.append(fenDialog);
new MutationObserver(() => window.dispatchEvent(new Event('cue-resize'))).observe(fenDialog, { attributes: true, attributeFilter: ['open'] });

function readSetup() {
  return {
    path: $('stockfishPath').value.trim(),
    interval: Number($('chessInterval').value),
    orientation: $('boardOrientation').value,
    initialFen: $('chessInitialFen').value.trim() || 'start'
  };
}

function populateSetup() {
  if (settingsEdited) return;
  const settings = { ...defaults, ...snapshot.settings };
  $('stockfishPath').value = settings.path || '';
  $('boardOrientation').value = settings.orientation;
  $('chessInterval').value = String(settings.interval);
  $('chessInitialFen').value = settings.initialFen || 'start';
}

function setScanLabel(text) {
  const button = $('scan');
  let label = button.querySelector('.cue-scan-label');
  if (!label) {
    for (const node of [...button.childNodes]) if (node.nodeType === Node.TEXT_NODE) node.remove();
    label = document.createElement('span');
    label.className = 'cue-scan-label';
    button.insertBefore(label, button.querySelector('kbd'));
  }
  label.textContent = text;
  button.setAttribute('aria-label', text);
}

function renderHistory() {
  const content = $('answerContent');
  const html = history.length ? history.map((entry, index) => {
    const current = Boolean(visibleAnswer) && index === history.length - 1 && entry.answer === visibleAnswer;
    const move = entry.fen.split(' ')[5];
    const label = `${current ? 'Current suggestion' : 'Earlier suggestion'}${move ? ` · move ${move}` : ''}`;
    return `<section class="chess-history-turn${current ? ' current' : ''}"><p class="chess-turn-label">${escape(label)}</p>${markdown(entry.answer)}</section>`;
  }).join('') : '<div class="empty-answer chess-message"><h3>Your next move.</h3><p>Choose Watch board for a new game, or Load FEN to join a game in progress.</p></div>';
  // Status changes must not steal the scroll position from someone reading older moves.
  if (html !== renderedHistory || content.dataset.historyMode !== 'chess') {
    const atBottom = content.scrollHeight - content.scrollTop - content.clientHeight < 48;
    const scrollTop = content.scrollTop;
    content.innerHTML = html; content.dataset.historyMode = 'chess'; renderedHistory = html;
    content.scrollTop = atBottom ? content.scrollHeight : scrollTop;
  }
}

function renderChess() {
  if (mode !== 'chess') return;
  const labels = { watching: 'WATCHING', reading: 'READING', thinking: 'THINKING', ready: 'MOVE READY', waiting: 'WAITING', error: 'CHECK SETUP', paused: 'PAUSED' };
  const changing = snapshot.status === 'reading' || snapshot.status === 'thinking';
  visibleAnswer = answerValid && ['ready', 'watching', 'paused'].includes(snapshot.status) ? String(snapshot.answer || '') : '';
  $('answerContent').setAttribute('aria-busy', String(changing));
  renderHistory();
  $('answerStatus').textContent = labels[snapshot.status] || 'CHESS';
  $('answerMeta').textContent = snapshot.message || 'Stockfish evaluates locally.';
  $('busyPanel').hidden = true;
  copyButton.disabled = !visibleAnswer;
  $('scan').disabled = Boolean(operation);
  $('scan').setAttribute('aria-pressed', String(Boolean(snapshot.running)));
  $('scan').dataset.chessShort = snapshot.running ? 'Pause' : 'Watch';
  setScanLabel(operation === 'start' ? 'Starting…' : operation === 'stop' ? 'Pausing…' : snapshot.running ? 'Pause' : 'Watch board');
  $('saveChessSetup').disabled = Boolean(operation) || !desktopAvailable();
  loadFenButton.disabled = newGameButton.disabled = Boolean(operation) || !desktopAvailable();
  clearHistoryButton.disabled = !history.length;
  populateSetup();
}

function receive(next, reveal = true) {
  if (!next || typeof next !== 'object') return;
  if (['reading', 'thinking', 'waiting', 'error'].includes(next.status)) answerValid = false;
  else if (next.status === 'ready' && next.answer) {
    answerValid = true;
    const entry = { answer: String(next.answer), fen: String(next.fen || '') };
    const previous = history.at(-1);
    if (previous?.fen !== entry.fen || previous?.answer !== entry.answer) { history.push(entry); history = history.slice(-400); saveHistory(); }
  }
  snapshot = { ...snapshot, ...next, settings: { ...defaults, ...snapshot.settings, ...next.settings } };
  if (mode !== 'chess') return;
  copyStatus.textContent = '';
  renderChess();
  if (reveal && (next.answer || ['waiting', 'error'].includes(next.status))) window.dispatchEvent(new Event('cue-reveal'));
}

function enqueue(action, payload) {
  const request = queue.then(async () => {
    if (!desktopAvailable()) throw new Error('Automatic chess recognition requires the desktop app. Open Cue Daily on your laptop.');
    return window.desktop.chess(action, payload);
  });
  queue = request.catch(() => {});
  return request;
}

async function toggleWatch() {
  if (mode !== 'chess' || operation) return;
  const action = snapshot.running ? 'stop' : 'start';
  operation = action;
  const revision = eventRevision;
  renderChess();
  try {
    const result = await enqueue(action);
    // A mode switch queues stop after this action. Its response belongs to Daily.
    if (mode === 'chess' && revision === eventRevision) receive(result);
  } catch (error) {
    if (mode === 'chess') receive({ running: false, status: 'error', message: error.message, answer: '' });
  } finally {
    operation = null;
    renderChess();
  }
}

window.addEventListener('cue-chess-toggle', toggleWatch);
window.addEventListener('cue-mode-change', event => {
  const previous = mode;
  mode = event.detail?.mode === 'chess' ? 'chess' : 'daily';
  document.body.dataset.cueMode = mode;
  const chess = mode === 'chess';
  for (const node of [ $('record'), document.querySelector('.question-details'), document.querySelector('.answer-tools'), $('followupForm'), $('markReviewed') ]) if (node) node.hidden = chess;
  setup.hidden = !chess;
  chessTools.hidden = !chess;
  if (chess) {
    $('answerStatus').setAttribute('role', 'status');
    $('answerStatus').setAttribute('aria-live', 'polite');
    if (!desktopAvailable()) snapshot = { ...snapshot, running: false, status: 'error', message: 'Automatic chess recognition requires the desktop app. Open Cue Daily on your laptop.', answer: '' };
    renderChess();
    if (previous !== 'chess') window.dispatchEvent(new Event('cue-reveal'));
  } else {
    $('answerStatus').removeAttribute('role');
    $('answerStatus').removeAttribute('aria-live');
    visibleAnswer = '';
    delete $('answerContent').dataset.historyMode;
    $('scan').removeAttribute('aria-pressed');
    $('answerContent').setAttribute('aria-busy', 'false');
    setScanLabel('Scan screen');
    if (previous === 'chess') {
      snapshot = { ...snapshot, running: false, status: 'paused', message: 'Watching paused. Return to Chess to continue.' };
      if (desktopAvailable()) enqueue('stop').then(next => {
        // Preserve the pause without writing chess output into the Daily answer.
        if (mode === 'daily') snapshot = { ...snapshot, ...next, running: false };
      }).catch(() => {});
    }
  }
});

loadFenButton.onclick = () => {
  $('fenImportError').hidden = true; $('chessFenText').value = ''; $('chessFenFile').value = '';
  fenDialog.showModal(); $('chessFenText').focus();
};
$('cancelChessFen').onclick = () => fenDialog.close();
fenDialog.addEventListener('close', () => loadFenButton.focus());
$('chessFenFile').onchange = async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 4096) throw new Error('Choose a small FEN text file (up to 4 KB).');
    const fen = (await file.text()).trim();
    if (fen.length > 200) throw new Error('The file must contain one full FEN position.');
    $('chessFenText').value = fen; $('fenImportError').hidden = true;
  } catch (error) { $('fenImportError').textContent = error.message; $('fenImportError').hidden = false; }
};
async function loadPosition(fen) {
  if (operation) return;
  const wasRunning = snapshot.running;
  operation = 'configure'; renderChess();
  try {
    receive(await enqueue('configure', { initialFen: fen }), false);
    answerValid = false; settingsEdited = false; renderChess();
    if (wasRunning && mode === 'chess') { const revision = eventRevision; const result = await enqueue('start'); if (mode === 'chess' && revision === eventRevision) receive(result, false); }
  } finally { operation = null; renderChess(); }
}
$('chessFenForm').onsubmit = async event => {
  event.preventDefault(); $('applyChessFen').disabled = true;
  try { await loadPosition($('chessFenText').value.trim()); fenDialog.close(); }
  catch (error) { $('fenImportError').textContent = error.message; $('fenImportError').hidden = false; }
  finally { $('applyChessFen').disabled = false; }
};
newGameButton.onclick = async () => {
  try { await loadPosition('start'); }
  catch (error) { receive({ status: 'error', message: error.message, answer: '' }); }
};
clearHistoryButton.onclick = () => {
  history = []; answerValid = false; saveHistory();
  snapshot = { ...snapshot, answer: '', status: snapshot.running ? 'watching' : 'paused', message: snapshot.running ? 'History cleared. Watching for the next board change.' : 'History cleared. Choose Watch board to continue.' };
  renderChess();
};

setup.addEventListener('input', () => { settingsEdited = true; $('chessSettingsStatus').hidden = true; });
setup.addEventListener('change', () => { settingsEdited = true; $('chessSettingsStatus').hidden = true; });
$('saveChessSetup').addEventListener('click', async () => {
  if (operation || mode !== 'chess') return;
  operation = 'configure';
  const status = $('chessSettingsStatus');
  status.hidden = false;
  status.textContent = 'Saving chess setup…';
  renderChess();
  try {
    const result = await enqueue('configure', readSetup());
    settingsEdited = false;
    answerValid = false;
    receive(result, false);
    status.textContent = 'Chess setup saved.';
  } catch (error) { status.textContent = error.message || 'Chess setup could not be saved.'; }
  finally { operation = null; renderChess(); }
});

copyButton.addEventListener('click', async () => {
  if (mode !== 'chess' || !visibleAnswer) return;
  try {
    await navigator.clipboard.writeText(visibleAnswer);
    if (mode === 'chess') copyStatus.textContent = 'Copied.';
  } catch { if (mode === 'chess') copyStatus.textContent = 'Select the move text to copy it.'; }
});

const unsubscribe = window.desktop?.onChess?.(next => {
  if (mode === 'chess') { eventRevision++; receive(next); }
});
window.addEventListener('beforeunload', () => unsubscribe?.());
if (desktopAvailable()) enqueue('status').then(next => receive(next, false)).catch(error => {
  receive({ running: false, status: 'error', message: error.message, answer: '' }, false);
});
