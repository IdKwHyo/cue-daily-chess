import { markdown } from './render.js';

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
document.querySelector('.answer-panel').insertBefore(chessTools, $('followupForm'));

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

function showMessage(message) {
  const empty = document.createElement('div');
  empty.className = 'empty-answer chess-message';
  const heading = document.createElement('h3');
  heading.textContent = snapshot.status === 'error' ? 'Check your chess setup.' : snapshot.status === 'thinking' ? 'Considering the next move.' : snapshot.status === 'reading' ? 'Reading the board.' : 'Your next move.';
  const paragraph = document.createElement('p');
  paragraph.textContent = message;
  empty.append(heading, paragraph);
  $('answerContent').replaceChildren(empty);
}

function renderChess() {
  if (mode !== 'chess') return;
  const labels = { watching: 'WATCHING', reading: 'READING', thinking: 'THINKING', ready: 'MOVE READY', waiting: 'WAITING', error: 'CHECK SETUP', paused: 'PAUSED' };
  const changing = snapshot.status === 'reading' || snapshot.status === 'thinking';
  visibleAnswer = answerValid && ['ready', 'watching', 'paused'].includes(snapshot.status) ? String(snapshot.answer || '') : '';
  $('answerContent').setAttribute('aria-busy', String(changing));
  if (visibleAnswer) $('answerContent').innerHTML = markdown(visibleAnswer);
  else showMessage(snapshot.message || 'Keep your board visible, then choose Watch board.');
  $('answerStatus').textContent = labels[snapshot.status] || 'CHESS';
  $('answerMeta').textContent = snapshot.message || 'Stockfish evaluates locally.';
  $('busyPanel').hidden = true;
  copyButton.disabled = !visibleAnswer;
  $('scan').disabled = Boolean(operation);
  $('scan').setAttribute('aria-pressed', String(Boolean(snapshot.running)));
  $('scan').dataset.chessShort = snapshot.running ? 'Pause' : 'Watch';
  setScanLabel(operation === 'start' ? 'Starting…' : operation === 'stop' ? 'Pausing…' : snapshot.running ? 'Pause' : 'Watch board');
  $('saveChessSetup').disabled = Boolean(operation) || !desktopAvailable();
  populateSetup();
}

function receive(next, reveal = true) {
  if (!next || typeof next !== 'object') return;
  if (['reading', 'thinking', 'waiting', 'error'].includes(next.status)) answerValid = false;
  else if (next.status === 'ready' && next.answer) answerValid = true;
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
  } else {
    $('answerStatus').removeAttribute('role');
    $('answerStatus').removeAttribute('aria-live');
    visibleAnswer = '';
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
