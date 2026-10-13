// Transcription flow and conservative silence filtering adapted from FreeFlow.
// Copyright (c) 2026 Zach Latta. MIT license: ../licenses/FreeFlow-LICENSE.txt
const { normalizeRequest } = require('./assistant.cjs');
const silencePhrases = new Set(['thank you', 'thank you for watching', 'thank you very much', 'thank you so much', 'thanks for watching', 'please subscribe', 'like and subscribe', 'subtitles by', 'subtitles by the amara.org community', 'you']);
function parseTranscript(data) {
  if (!data || typeof data.text !== 'string') throw new Error('The transcription provider returned an invalid response.');
  const normalized = data.text.toLowerCase().replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, '');
  const noSpeech = data.segments?.[0]?.no_speech_prob;
  if (silencePhrases.has(normalized) && typeof noSpeech === 'number' && noSpeech >= 0.1) return '';
  return data.text.trim();
}
async function transcribe(raw, settings, { fetchImpl = fetch, signal } = {}) {
  const request = normalizeRequest({ ...raw, action: 'transcribe', question: 'Transcribe the audio.' });
  const audio = request.attachments.find(a => a.mimeType.startsWith('audio/'));
  if (!audio) throw new Error('Record a question first.');
  if (!settings.groqKey) throw new Error('Add your Groq API key in Settings for FreeFlow-based dictation.');
  if (!['whisper-large-v3', 'whisper-large-v3-turbo'].includes(settings.transcriptionModel)) throw new Error('Choose a supported Whisper model.');
  const form = new FormData();
  const ext = audio.mimeType.split('/')[1] === 'mpeg' ? 'mp3' : audio.mimeType.split('/')[1];
  form.set('file', new Blob([Buffer.from(audio.data, 'base64')], { type: audio.mimeType }), `question.${ext}`);
  form.set('model', settings.transcriptionModel); form.set('response_format', 'verbose_json'); form.set('temperature', '0');
  // Do not force the output language onto recognition: preserve multilingual speech.
  if (settings.vocabulary) form.set('prompt', settings.vocabulary.slice(0, 800));
  const timeout = AbortSignal.timeout(60000);
  let response;
  try { response = await fetchImpl('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${settings.groqKey}` }, body: form,
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout
  }); } catch {
    if (signal?.aborted) throw new Error('Request cancelled.');
    throw new Error(timeout.aborted ? 'Transcription timed out. Try a shorter recording.' : 'Could not reach Groq. Check your connection.');
  }
  if (!response.ok) {
    const message = { 401: 'Groq rejected the API key.', 403: 'Your Groq key lacks transcription access.', 413: 'Recording too large.', 429: 'Groq rate or quota limit reached. Retry later.' };
    throw new Error(message[response.status] || `Transcription failed (HTTP ${response.status}).`);
  }
  const answer = parseTranscript(await response.json());
  if (!answer) throw new Error('No clear speech detected. Try recording again.');
  return { answer, usage: 0, provider: 'groq-whisper' };
}
module.exports = { transcribe, parseTranscript };
