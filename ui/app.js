import { STORAGE_KEY, KIND_LABELS, initialState, parseSession, exportSession, question, freshWorkspace, samples } from './state.js';
import { escape, markdown, emptyAnswer } from './render.js';
import { call, scan, mediaFromUrl, fileImage } from './bridge.js';
import { readAloud, stopSpeaking, isSpeaking } from './voice.js';

const $ = id => document.getElementById(id);
let state = initialState(), loadError;
try { const stored = localStorage.getItem(STORAGE_KEY); if (stored) state = parseSession(JSON.parse(stored)); }
catch { loadError = 'Your previous session could not be loaded. Import a saved export to restore it.'; }
let busy = false, captureBusy = false, connection = { hasKey: false, model: 'gemini-3.8-flash', canRemember: false }, noticeTimeout;
const attachments = new Map();
const workspace = () => state.workspaces[state.mode];
const current = () => workspace().items.find(q => q.id === workspace().selected) || workspace().items[0];
const images = () => attachments.get(current().id) || [];

function notify(message, error = false) {
  if (error) window.dispatchEvent(new Event("cue-reveal"));
  const box = $(error ? 'error' : 'notice'); box.textContent = message; box.hidden = false;
  if (!error) { clearTimeout(noticeTimeout); noticeTimeout = setTimeout(() => { box.hidden = true; }, 6500); }
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch { notify('Device storage is full or unavailable. Export this session to keep your changes.', true); }
}
function guarded(fn) {
  return async (...args) => { try { $('error').hidden = true; return await fn(...args); } catch (error) { notify(error.message || 'Something went wrong. Please retry.', true); } };
}
function blocked() {
  if (busy || captureBusy || recorder) { notify('Finish or cancel the current operation first.'); return true; } return false;
}
function setBusy(value, message = 'Reading your question…') {
  busy = value;
  if (value) window.dispatchEvent(new Event('cue-reveal'));
  $('busyPanel').hidden = !value; $('busyText').textContent = message;
  $('answerContent').setAttribute('aria-busy', String(value));
  updateControls();
}
function updateControls() {
  const locked = busy || captureBusy || Boolean(recorder);
  for (const id of ['scan', 'attach', 'review', 'answer', 'hint', 'addQuestion', 'sample', 'markReviewed', 'import', 'clearSession', 'useDraft', 'flag', 'settingsOpen', 'connection', 'sendFollowup', 'followup']) $(id).disabled = locked;
  for (const id of ['question', 'draft', 'kind', 'context', 'sessionName']) $(id).disabled = locked;
  $('record').disabled = busy || captureBusy;
  $('review').disabled ||= !current().draft.trim();
  $('copy').disabled = !current().answer;
  $('readAloud').disabled = !current().answer && !isSpeaking();
  $('sendFollowup').disabled ||= !current().answer;
  $('followup').disabled ||= !current().answer;
  $('useDraft').disabled ||= !current().answer;
  $('markReviewed').disabled ||= !current().answer && !current().draft;
  document.querySelectorAll('[data-mode],.queue-item').forEach(button => { button.disabled = locked; });
}
function renderQueue() {
  $('queue').innerHTML = workspace().items.map((q, i) => `<button class="queue-item ${q.id === current().id ? 'active' : ''}" data-id="${escape(q.id)}" aria-current="${q.id === current().id ? 'true' : 'false'}"><span class="q-top"><span>${state.mode === 'daily' ? 'TURN' : 'QUESTION'} ${String(i + 1).padStart(2, '0')}</span><span class="reviewed-mark">${q.flagged ? '⚑ ' : ''}${q.reviewed ? '✓' : ''}</span></span><span class="q-title">${escape(q.text.trim() || 'A fresh question')}</span><span class="q-type">${escape(KIND_LABELS[q.kind])}</span></button>`).join('');
  $('queueCount').textContent = workspace().items.length;
  $('progress').textContent = `${workspace().items.filter(q => q.reviewed).length} of ${workspace().items.length} reviewed`;
  $('queue').querySelectorAll('button').forEach(button => button.onclick = () => {
    if (blocked()) return; workspace().selected = button.dataset.id; save(); render(); $('question').focus();
  });
}
function renderAttachments() {
  $('attachments').innerHTML = images().map((image, i) => `<div class="attachment"><img src="${image.dataUrl}" alt="Attached screenshot ${i + 1}"><button data-index="${i}" aria-label="Remove attachment ${i + 1}">×</button><span>${escape(image.name)}</span></div>`).join('');
  $('attachments').querySelectorAll('button').forEach(button => button.onclick = () => { if (blocked()) return; images().splice(Number(button.dataset.index), 1); renderAttachments(); });
}
function render() {
  const q = current(), interview = state.mode === 'daily';
  document.querySelectorAll('[data-mode]').forEach(button => { button.classList.toggle('active', button.dataset.mode === state.mode); button.setAttribute('aria-pressed', String(button.dataset.mode === state.mode)); });
  $('breadcrumb').textContent = interview ? 'Daily' : 'Chess';
  $('pageTitle').textContent = interview ? 'Find your flow.' : 'A little clarity.';
  $('subtitle').textContent = interview ? 'Turn a difficult question into a clear, thoughtful conversation.' : 'Read the question. Understand the reasoning. Make it yours.';
  $('queueTitle').firstChild.textContent = interview ? 'Conversation ' : 'Questions ';
  $('sessionName').value = workspace().title; $('sessionLabel').textContent = workspace().title || 'Untitled session';
  $('context').value = state.context;
  $('questionNumber').textContent = `${interview ? 'TURN' : 'QUESTION'} ${String(workspace().items.indexOf(q) + 1).padStart(2, '0')}`;
  $('questionTitle').textContent = q.text ? (interview ? 'Let’s talk it through.' : 'The question, in focus.') : 'What’s on your mind?';
  $('question').value = q.text; $('kind').value = q.kind; $('draft').value = q.draft;
  $('wordCount').textContent = `${q.draft.trim() ? q.draft.trim().split(/\s+/).length : 0} words`;
  $('flag').setAttribute('aria-pressed', String(q.flagged)); $('flag').textContent = q.flagged ? '⚑ Flagged' : '⚑ Flag';
  $('markReviewed').textContent = q.reviewed ? 'Reviewed ✓' : 'Mark reviewed ✓';
  $('answerContent').innerHTML = q.answer ? markdown(q.answer) + q.followups.map(f => `<section class="followup-turn"><h3>${escape(f.question)}</h3>${markdown(f.answer)}</section>`).join('') : emptyAnswer();
  $('answerStatus').textContent = q.stale ? 'OUTDATED' : q.sample ? 'SAMPLE' : q.answer ? 'REVIEW' : 'READY';
  $('answerMeta').textContent = q.stale ? 'Question changed. Generate a fresh answer.' : q.sample ? 'Illustrative sample · no AI call' : q.usage ? `${q.usage.toLocaleString()} tokens · Check the answer.` : 'AI answers may need checking.';
  renderQueue(); renderAttachments(); updateConnection(); updateControls();
  window.dispatchEvent(new CustomEvent('cue-mode-change', { detail: { mode: state.mode } }));
}
function updateConnection() {
  $('connectionText').textContent = connection.hasKey ? 'Key configured' : 'Connect Gemini';
  $('connection').querySelector('.status-dot').classList.toggle('off', !connection.hasKey);
}
function payload(action, extra = {}) {
  const index = workspace().items.indexOf(current());
  return { mode: state.mode, action, kind: current().kind, question: current().text, draft: current().draft,
    context: state.context, language: state.preferences.language, codeLanguage: state.preferences.codeLanguage,
    images: images().map(({ mimeType, data }) => ({ mimeType, data })),
    history: state.mode === 'daily' ? workspace().items.slice(0, index).filter(q => !q.sample).map(q => ({ question: q.text, answer: q.answer })) : [], ...extra };
}
async function requireKey() {
  connection = await call('settings'); updateConnection();
  if (!connection.hasKey) { await openSettings(); throw new Error('Add your Gemini API key to continue. Your question and screenshot are ready.'); }
}
async function ask(action) {
  if (state.mode === 'chess') { window.dispatchEvent(new Event('cue-chess-toggle')); return; }
  if (busy) return;
  if (!current().text.trim() && !images().length) throw new Error('Add a question or scan your screen first.');
  if (action === 'review' && !current().draft.trim()) throw new Error('Write a draft to review first.');
  const target = current();
  setBusy(true, action === 'review' ? 'Checking your draft…' : action === 'hint' ? 'Finding a helpful hint…' : 'Working through your question…');
  try {
    await requireKey();
    const result = await call('generate', payload(action));
    target.answer = result.answer; target.followups = []; target.usage = result.usage; target.reviewed = false; target.sample = false; target.stale = false;
    save(); render(); notify('Response ready. Review the reasoning before using it.');
  } finally { setBusy(false); }
}
function addItems(items) {
  if (workspace().items.length + items.length > 100) throw new Error('A workspace supports 100 questions. Export and clear it before adding more.');
  const q = current();
  if (!q.text.trim() && !q.draft && !q.answer) { workspace().items = workspace().items.filter(item => item.id !== q.id); attachments.delete(q.id); }
  workspace().items.push(...items); workspace().selected = items[0].id;
}
async function processCapture(capture) {
  const media = mediaFromUrl(capture.dataUrl, capture.name);
  if (current().text || current().answer || current().draft) addItems([question()]);
  attachments.set(current().id, [media]); render();
  setBusy(true, 'Detecting questions and answer choices…');
  let detected = [];
  const interview = state.mode === 'daily';
  try {
    await requireKey();
    if (interview) {
      current().text = 'Help me with what is visible in this screenshot. Give a useful direct response in the format that fits the task. If my intent is unclear, briefly describe what you see and ask what I want help with.'; save(); render();
    } else {
    const result = await call('generate', payload('extract', { question: 'Extract every readable assessment question and its choices from this screenshot.' }));
    if (!result.questions.length) throw new Error('No readable question was detected. Try a larger view or attach a clearer screenshot.');
    detected = result.questions.map(q => question(q.text, q.kind));
    addItems(detected); detected.forEach(q => attachments.set(q.id, [media]));
    save(); render(); notify(`${detected.length} question${detected.length === 1 ? '' : 's'} detected. Check the extracted wording against the screenshot.`);
    }
  } finally { setBusy(false); }
  if (interview || (detected.length && state.preferences.autoAnswer)) await ask('answer');
}
async function scanNow() {
  if (blocked()) return;
  if (state.mode === 'chess') { window.dispatchEvent(new Event('cue-chess-toggle')); return; }
  captureBusy = true; updateControls();
  try { const result = await scan(); captureBusy = false; await processCapture(result); }
  finally { captureBusy = false; updateControls(); }
}

async function openSettings() {
  window.dispatchEvent(new Event('cue-reveal'));
  connection = await call('settings');
  $('model').value = connection.model; $('apiKey').value = '';
  $('keyStatus').textContent = connection.hasKey ? 'A key is configured. Leave the field blank to keep it.' : 'No key configured. Get one from Google AI Studio.';
  $('rememberKey').disabled = !connection.canRemember;
  $('rememberKey').checked = connection.canRemember && localStorage.getItem('cue.daily.remember') === 'true';
  if (!connection.canRemember) $('keyStatus').textContent += ' Keys are held in memory in this environment.';
  $('language').value = state.preferences.language; $('codeLanguage').value = state.preferences.codeLanguage; $('autoAnswer').checked = state.preferences.autoAnswer;
  $('voiceProvider').value = connection.voiceProvider || 'groq'; $('transcriptionModel').value = connection.transcriptionModel || 'whisper-large-v3-turbo';
  $('groqKey').value = ''; $('groqStatus').textContent = connection.hasGroqKey ? 'A Groq key is configured.' : 'Add a Groq key for FreeFlow-based dictation.'; $('vocabulary').value = connection.vocabulary || '';
  $('settingsError').hidden = true; $('settingsDialog').showModal();
}
$('settingsForm').onsubmit = async event => {
  event.preventDefault();
  const submit = event.submitter || $('settingsForm').querySelector('button[type="submit"]'); submit.disabled = true;
  try {
    connection = await call('configure', { key: $('apiKey').value, model: $('model').value, remember: $('rememberKey').checked,
      groqKey: $('groqKey').value, voiceProvider: $('voiceProvider').value, transcriptionModel: $('transcriptionModel').value, vocabulary: $('vocabulary').value });
    state.preferences = { language: $('language').value, codeLanguage: $('codeLanguage').value, autoAnswer: $('autoAnswer').checked };
    localStorage.setItem('cue.daily.remember', String($('rememberKey').checked));
    save(); $('apiKey').value = ''; $('settingsDialog').close(); updateConnection(); notify('Settings saved.');
  } catch (error) { $('settingsError').textContent = error.message; $('settingsError').hidden = false; }
  finally { submit.disabled = false; }
};
$('removeKey').onclick = guarded(async () => {
  connection = await call('configure', { clearKey: true, model: $('model').value });
  $('apiKey').value = ''; $('groqKey').value = ''; $('rememberKey').checked = false; localStorage.removeItem('cue.daily.remember');
  $('keyStatus').textContent = 'Keys removed from Cue.'; $('groqStatus').textContent = 'No Groq key configured.'; updateConnection();
});
$('settingsDialog').addEventListener('close', () => { $('apiKey').value = ''; $('groqKey').value = ''; });
document.querySelectorAll('[data-close]').forEach(button => button.onclick = () => $(button.dataset.close).close());
$('settingsOpen').onclick = guarded(openSettings); $('connection').onclick = guarded(openSettings);

document.querySelectorAll('[data-mode]').forEach(button => button.onclick = () => { if (blocked()) return; state.mode = button.dataset.mode; save(); render(); });
$('sessionName').oninput = () => { workspace().title = $('sessionName').value; $('sessionLabel').textContent = workspace().title || 'Untitled session'; save(); };
$('context').oninput = () => { state.context = $('context').value; save(); };
function invalidate(questionChanged = false) {
  current().reviewed = false; $('markReviewed').textContent = 'Mark reviewed ✓';
  if (questionChanged && current().answer) { current().stale = true; $('answerStatus').textContent = 'OUTDATED'; $('answerMeta').textContent = 'Question changed. Generate a fresh answer.'; }
}
$('question').oninput = () => { current().text = $('question').value; invalidate(true); save(); renderQueue(); };
$('kind').onchange = () => { current().kind = $('kind').value; invalidate(true); save(); renderQueue(); };
$('draft').oninput = () => { current().draft = $('draft').value; invalidate(); $('wordCount').textContent = `${current().draft.trim() ? current().draft.trim().split(/\s+/).length : 0} words`; save(); renderQueue(); updateControls(); };
$('flag').onclick = () => { current().flagged = !current().flagged; save(); render(); };
$('addQuestion').onclick = guarded(() => { addItems([question()]); save(); render(); $('question').focus(); });
$('sample').onclick = guarded(() => { addItems(samples(state.mode)); workspace().title ||= 'Daily · sample'; save(); render(); notify('Sample content loaded. The displayed sample answer did not use AI.'); });
$('answer').onclick = guarded(() => ask('answer')); $('review').onclick = guarded(() => ask('review')); $('hint').onclick = guarded(() => ask('hint'));
$('scan').onclick = guarded(scanNow);
$('cancel').onclick = guarded(async () => { await call('cancel'); });
$('useDraft').onclick = () => { current().draft = current().answer; current().reviewed = false; save(); render(); $('draft').focus(); };
$('markReviewed').onclick = () => { current().reviewed = !current().reviewed; save(); render(); };
$('copy').onclick = guarded(async () => { await navigator.clipboard.writeText(current().answer); notify('Answer copied.'); });
$('readAloud').onclick = guarded(async () => {
  if (isSpeaking()) { await stopSpeaking(); $('readAloud').textContent = 'Read aloud'; $('readAloud').setAttribute('aria-pressed', 'false'); return; }
  const spoken = $('answerContent').innerText;
  await readAloud(spoken, state.preferences.language, active => { $('readAloud').textContent = active ? 'Stop reading' : 'Read aloud'; $('readAloud').setAttribute('aria-pressed', String(active)); });
});
$('followupForm').onsubmit = guarded(async event => {
  event.preventDefault(); if (blocked()) return;
  const followup = $('followup').value.trim(); if (!followup || !current().answer) return;
  const target = current(); setBusy(true, 'Thinking it through…');
  try {
    await requireKey();
    const result = await call('generate', payload('followup', { question: `Original question: ${target.text}\n\nFollow-up: ${followup}`, draft: '',
      history: [{ question: target.text, answer: target.answer }, ...target.followups] }));
    target.followups.push({ question: followup, answer: result.answer }); target.followups = target.followups.slice(-20); target.usage += result.usage || 0;
    $('followup').value = ''; save(); render(); $('answerContent').scrollTop = $('answerContent').scrollHeight;
  } finally { setBusy(false); }
});
$('pin').onclick = guarded(async () => {
  if (!window.desktop) return notify('Pin window is available in the desktop app.');
  const pinned = await window.desktop.pin($('pin').getAttribute('aria-pressed') !== 'true');
  $('pin').setAttribute('aria-pressed', String(pinned)); $('pin').textContent = pinned ? 'Window pinned' : 'Pin window';
});

async function addImages(files) {
  if (blocked()) return;
  if (images().length + files.length > 4) throw new Error('Attach up to four images to a question.');
  const added = [];
  for (const file of files) added.push(await fileImage(file));
  attachments.set(current().id, [...images(), ...added]); invalidate(true); save(); renderAttachments(); notify('Image attached. Choose Get answer to analyze it.');
}
$('attach').onclick = () => $('imageInput').click();
$('imageInput').onchange = guarded(async event => { const files = [...event.target.files]; event.target.value = ''; await addImages(files); });
document.addEventListener('paste', guarded(async event => {
  if ($('settingsDialog').open) return;
  const files = [...(event.clipboardData?.files || [])].filter(file => file.type.startsWith('image/'));
  if (files.length) { event.preventDefault(); await addImages(files); }
}));
window.desktop?.onScan(guarded(async data => { if (data.shortcut) return scanNow(); if (state.mode === 'chess' || blocked()) return; if (data.error) throw new Error(data.error); await processCapture(data.capture); }));
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !$('settingsDialog').open) { event.preventDefault(); if (!blocked()) guarded(() => ask('answer'))(); }
  if (!window.desktop && (event.metaKey || event.ctrlKey) && event.shiftKey && event.code === 'Space') { event.preventDefault(); guarded(scanNow)(); }
});

$('export').onclick = guarded(() => {
  const blob = new Blob([exportSession(state)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = `cue-daily-session-${new Date().toISOString().slice(0, 10)}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000); notify('Session exported. Images, audio, and API keys are excluded.');
});
$('import').onclick = () => $('sessionInput').click();
$('sessionInput').onchange = guarded(async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  if (file.size > 4000000) throw new Error('Session exports must be under 4 MB.');
  const imported = parseSession(JSON.parse(await file.text()));
  // Import appends rather than silently replacing the user's current work.
  for (const mode of ['daily', 'chess']) {
    const existing = state.workspaces[mode].items.filter(q => q.text || q.answer || q.draft);
    if (existing.length + imported.workspaces[mode].items.length > 100) throw new Error('Import would exceed 100 questions. Export and clear a workspace first.');
  }
  for (const mode of ['daily', 'chess']) {
    const w = state.workspaces[mode]; w.items = [...w.items.filter(q => q.text || q.answer || q.draft), ...imported.workspaces[mode].items];
    w.selected = imported.workspaces[mode].selected; w.title ||= imported.workspaces[mode].title;
  }
  if (!state.context) state.context = imported.context;
  state.mode = imported.mode; save(); render(); notify('Imported questions were added to your workspaces.');
});
$('clearSession').onclick = () => $('confirmDialog').showModal();
$('confirmNo').onclick = () => $('confirmDialog').close();
$('confirmYes').onclick = () => {
  workspace().items.forEach(q => attachments.delete(q.id)); state.workspaces[state.mode] = freshWorkspace();
  save(); render(); $('confirmDialog').close(); notify('Workspace cleared.');
};

let recorder = null, recordingStream, recordChunks = [], recordStarted = 0, recordTick, recordLimit;
async function record() {
  if (recorder) { recorder.stop(); return; }
  if (busy || captureBusy) return;
  setBusy(true, 'Opening the microphone…');
  try {
  connection = await call('settings');
  if (connection.voiceProvider === 'groq' ? !connection.hasGroqKey : !connection.hasKey) {
    await openSettings(); throw new Error(connection.voiceProvider === 'groq' ? 'Add a Groq key for FreeFlow-based dictation, or choose Gemini transcription.' : 'Add a Gemini key for transcription.');
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('Microphone recording is unavailable in this environment.');
  recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
  recorder = new MediaRecorder(recordingStream, mimeType ? { mimeType } : undefined);
  recordChunks = []; const recording = recorder;
  recording.ondataavailable = event => { if (event.data.size) recordChunks.push(event.data); };
  recording.onerror = () => { notify('Recording failed. Check microphone permissions.', true); stopTracks(); };
  recording.onstop = guarded(async () => {
    const blob = new Blob(recordChunks, { type: recording.mimeType }); stopTracks();
    if (blob.size < 100) throw new Error('No audio was recorded. Try again.');
    if (blob.size > 8000000) throw new Error('The recording is too large. Record a shorter question.');
    setBusy(true, 'Transcribing your recording…');
    try {
      const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
      const result = await call('generate', payload('transcribe', { images: [], question: 'Transcribe this recording.', audio: { mimeType: recording.mimeType.split(';')[0], data: dataUrl.split(',')[1] } }));
      current().text = [current().text, result.answer].filter(Boolean).join('\n\n'); current().reviewed = false; save(); render(); notify('Transcript added. Check it, then get an answer.');
    } finally { setBusy(false); }
  });
  recordStarted = Date.now(); recorder.start();
  $('record').textContent = '■ Stop recording'; $('record').setAttribute('aria-pressed', 'true'); updateControls();
  recordTick = setInterval(() => { $('recordTime').textContent = `${Math.floor((Date.now() - recordStarted) / 1000)}s / 90s`; }, 500);
  recordLimit = setTimeout(() => recorder?.stop(), 90000);
  } finally { setBusy(false); }
}
function stopTracks() {
  recordingStream?.getTracks().forEach(track => track.stop()); recorder = null;
  clearInterval(recordTick); clearTimeout(recordLimit); $('recordTime').textContent = '';
  $('record').textContent = '● Record question'; $('record').setAttribute('aria-pressed', 'false'); updateControls();
}
$('record').onclick = guarded(record);
window.addEventListener('beforeunload', () => recordingStream?.getTracks().forEach(track => track.stop()));

let remaining = 30 * 60, timerEnd = 0;
$('timer').onclick = () => {
  if (timerEnd) { remaining = Math.max(0, Math.ceil((timerEnd - Date.now()) / 1000)); timerEnd = 0; }
  else { if (remaining === 0) remaining = 30 * 60; timerEnd = Date.now() + remaining * 1000; }
  $('timer').setAttribute('aria-pressed', String(Boolean(timerEnd)));
};
setInterval(() => {
  if (timerEnd) { remaining = Math.max(0, Math.ceil((timerEnd - Date.now()) / 1000)); if (!remaining) { timerEnd = 0; $('timer').setAttribute('aria-pressed', 'false'); notify('Your 30-minute practice timer is complete.'); } }
  $('timerText').textContent = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
}, 500);

if (!window.desktop) { $('pin').hidden = true; $('runtimeLabel').textContent = 'Browser edition · Screen capture opens your browser picker'; }
$('sessionMenu').onclick = () => { const expanded = document.querySelector('.sidebar').classList.toggle('expanded'); $('sessionMenu').setAttribute('aria-expanded', String(expanded)); };
if (!navigator.platform.includes('Mac')) $('scan').querySelector('kbd').textContent = 'Ctrl ⇧ Space';
render(); if (loadError) notify(loadError, true);
guarded(async () => { connection = await call('settings'); updateConnection(); })();
