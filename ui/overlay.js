const $ = id => document.getElementById(id);
const shell = document.createElement('div'); shell.className = 'overlay-shell';
shell.innerHTML = `<header class="control-bar" aria-label="Cue controls"><span class="cue-wordmark" title="Drag to move Cue">cue<span>•</span></span><div class="bar-modes"></div><div class="bar-actions"></div><button id="toggleCue" aria-expanded="false" aria-controls="cuePopup" title="Show answer">Cue ↓</button><button id="overlaySettings" aria-label="Settings" title="Settings">⚙</button><button id="quitCue" aria-label="Quit Cue" title="Quit Cue">×</button></header><main id="cuePopup" class="cue-popup" hidden><div class="popup-heading"><div><span class="eyebrow">A LITTLE CLARITY</span><h1>Your next thought.</h1></div><button id="dismissCue" class="icon-button" aria-label="Collapse answer">−</button></div><div class="popup-notices"></div><div class="popup-answer"></div><details class="question-details"><summary>Question & detected questions</summary><div class="popup-questions"></div></details></main>`;
document.body.prepend(shell);
const old = document.querySelector('.app-shell');
const move = (selector, target) => { const node = document.querySelector(selector); if (node) shell.querySelector(target).append(node); };
move('.mode-nav', '.bar-modes'); move('#scan', '.bar-actions'); move('#record', '.bar-actions');
move('#notice', '.popup-notices'); move('#error', '.popup-notices'); move('.answer-panel', '.popup-answer');
move('.queue-panel', '.popup-questions'); move('.question-panel', '.popup-questions');
// Ancillary session actions and tailoring are available in the settings sheet.
const session = document.createElement('details'); session.className = 'session-settings'; session.innerHTML = '<summary>Context & saved sessions</summary>';
session.append(document.querySelector('.side-context'));
for (const id of ['export','import','clearSession']) { $(id).type = 'button'; session.append($(id)); }
$('settingsForm').insertBefore(session, document.querySelector('.dialog-actions'));
const diagnostics = document.createElement('p'); diagnostics.className = 'small muted';
diagnostics.textContent = 'Capture protection is enabled on desktop. macOS ScreenCaptureKit can still capture Cue; verify in your sharing app. Linux does not support this protection.';
const logButton = document.createElement('button'); logButton.type = 'button'; logButton.className = 'secondary'; logButton.textContent = 'Open capture diagnostics';
logButton.onclick = async () => { try { await window.desktop.openCaptureLog(); } catch (error) { diagnostics.textContent = error.message; } };
if (window.desktop) $('settingsForm').insertBefore(logButton, document.querySelector('.dialog-actions'));
$('settingsForm').insertBefore(diagnostics, document.querySelector('.dialog-actions'));
old.hidden = true;
let expanded = false;
function resize() {
  const dialog = document.querySelector('dialog[open]');
  const height = dialog ? 760 : expanded ? 700 : 84;
  window.desktop?.resizeOverlay?.(height).catch(console.error);
}
function reveal(value = true) {
  expanded = value; $('cuePopup').hidden = !value;
  if (value) $('cuePopup').scrollTop = 0;
  $('toggleCue').setAttribute('aria-expanded', String(value)); $('toggleCue').textContent = value ? 'Cue ↑' : 'Cue ↓'; resize();
}
window.addEventListener('cue-reveal', () => reveal());
$('toggleCue').onclick = () => reveal(!expanded);
$('dismissCue').onclick = () => { reveal(false); $('toggleCue').focus(); };
$('overlaySettings').onclick = () => $('settingsOpen').click();
$('quitCue').onclick = () => window.desktop?.quit ? window.desktop.quit() : reveal(false);
for (const dialog of document.querySelectorAll('dialog')) {
  new MutationObserver(resize).observe(dialog, { attributes: true, attributeFilter: ['open'] });
}
if (!window.desktop) { document.body.classList.add('browser-preview'); $('quitCue').hidden = true; }
await import('./chess.js');
await import('./app.js');
resize();
