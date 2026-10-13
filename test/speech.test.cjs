const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { transcribe, parseTranscript } = require('../core/speech.cjs');
const { createService } = require('../core/service.cjs');
const { createSpeaker } = require('../desktop/speaker.cjs');
const audio = { mode: 'interview', action: 'transcribe', audio: { mimeType: 'audio/webm', data: 'YWJj' } };
test('FreeFlow-derived filter suppresses stock silence phrases only with corroborating metadata', () => {
  assert.equal(parseTranscript({ text: 'Thank you!', segments: [{ no_speech_prob: 0.8 }] }), '');
  assert.equal(parseTranscript({ text: 'Thank you!' }), 'Thank you!');
  assert.equal(parseTranscript({ text: 'Thank you!', segments: [{ no_speech_prob: 0.01 }] }), 'Thank you!');
  assert.equal(parseTranscript({ text: 'Check the API.', segments: [{ no_speech_prob: 0.8 }] }), 'Check the API.');
  assert.throws(() => parseTranscript({ data: 'garbage' }), /invalid response/);
});
test('Whisper request uses multipart upload, vocabulary, and multilingual recognition', async () => {
  let request;
  const result = await transcribe(audio, { groqKey: 'test-secret', transcriptionModel: 'whisper-large-v3-turbo', vocabulary: 'SageMaker, Karndanai' }, {
    fetchImpl: async (url, options) => { request = { url, options }; return new Response(JSON.stringify({ text: 'สวัสดี SageMaker', segments: [{ no_speech_prob: 0.01 }] })); }
  });
  assert.equal(result.answer, 'สวัสดี SageMaker');
  assert.equal(request.url, 'https://api.groq.com/openai/v1/audio/transcriptions');
  assert.equal(request.options.headers.Authorization, 'Bearer test-secret');
  assert.equal(request.options.body.get('response_format'), 'verbose_json');
  assert.equal(request.options.body.get('prompt'), 'SageMaker, Karndanai');
  assert.equal(request.options.body.get('language'), null);
  assert.equal(request.options.body.get('file').type, 'audio/webm');
});
test('Groq error and silence never become fabricated transcripts', async () => {
  const settings = { groqKey: 'test', transcriptionModel: 'whisper-large-v3' };
  await assert.rejects(transcribe(audio, settings, { fetchImpl: async () => new Response('{}', { status: 429 }) }), /quota/);
  await assert.rejects(transcribe(audio, settings, { fetchImpl: async () => new Response(JSON.stringify({ text: 'You', segments: [{ no_speech_prob: 0.7 }] })) }), /No clear speech/);
});
test('service routes transcription through Groq without requiring a Gemini key and keeps both secrets private', async () => {
  let destination;
  const service = createService({ initial: { groqKey: 'private-groq' }, fetchImpl: async url => { destination = url; return new Response(JSON.stringify({ text: 'My question' })); } });
  const result = await service.call('generate', audio); assert.equal(result.answer, 'My question');
  assert.ok(destination.startsWith('https://api.groq.com/'));
  const status = await service.call('settings'); assert.equal(status.hasGroqKey, true); assert.equal(status.groqKey, undefined);
});
test('native TTS sends arbitrary text over stdin without a shell and can stop playback', async () => {
  let invoked, written, child;
  const speaker = createSpeaker({ spawnImpl: (exe, args, options) => {
    invoked = { exe, args, options }; child = new EventEmitter(); child.stdin = new EventEmitter(); child.stdin.end = text => { written = text; };
    child.kill = () => queueMicrotask(() => child.emit('exit', null, 'SIGTERM')); return child;
  } });
  const text = 'Literal text: $(do-not-execute) --voice fake';
  const reading = speaker.speak(text); assert.equal(written, text); assert.deepEqual(invoked.args, []); assert.equal(invoked.options.shell, undefined);
  speaker.stop(); assert.deepEqual(await reading, { finished: false });
});
