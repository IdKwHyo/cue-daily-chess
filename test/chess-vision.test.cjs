'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseBoard, recognizeBoard } = require('../core/chess-vision.cjs');

const placement = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
const observation = { visible: true, certain: true, placement, orientation: 'white', bounds: [100, 100, 700, 700] };
const settings = { key: 'private-test-key', model: 'test-model' };
const image = 'data:image/png;base64,YWJj';
const response = (data, finishReason = 'STOP') => new Response(JSON.stringify({
  candidates: [{ finishReason, content: { parts: [{ thought: true, text: 'not an observation' }, { text: JSON.stringify(data) }] } }]
}));

test('board parser preserves placement and orientation with a bounded board crop', () => {
  assert.deepEqual(parseBoard(`\`\`\`json\n${JSON.stringify(observation)}\n\`\`\``), {
    visible: true, placement, orientation: 'white', bounds: [100, 100, 700, 700]
  });
  assert.deepEqual(parseBoard(JSON.stringify({ ...observation, orientation: 'black', bounds: undefined }), true), {
    visible: true, placement, orientation: 'black', bounds: undefined
  });
});

test('board parser rejects malformed JSON, broken ranks, invalid symbols, and out-of-image bounds', () => {
  assert.throws(() => parseBoard('not json'), /invalid data/);
  for (const data of ['null', '[]', 'true', '"not a board"']) {
    assert.throws(() => parseBoard(data), /invalid data/);
  }
  for (const bad of ['8/8/8/8/8/8/8', '8/8/8/8/8/8/8/7', '8/8/8/8/8/8/8/9', `${placement} w KQkq - 0 1`]) {
    assert.throws(() => parseBoard(JSON.stringify({ ...observation, placement: bad })), /position|ranks/);
  }
  for (const bounds of [null, [0, 0, 500], [0, 0, 500, 500, 1], [-1, 0, 500, 500],
    [0, 0, 49, 700], [501, 0, 500, 700], [0, 301, 700, 700], [0, 0, 500.5, 500]]) {
    assert.throws(() => parseBoard(JSON.stringify({ ...observation, bounds })), /locate the board/);
  }
});

test('uncertain or unknown orientation returns no usable board instead of guessing', () => {
  assert.deepEqual(parseBoard(JSON.stringify({ ...observation, certain: false, reason: 'A hand covers the queen.' })), {
    visible: false, reason: 'A hand covers the queen.'
  });
  assert.equal(parseBoard(JSON.stringify({ ...observation, certain: undefined })).visible, false);
  assert.equal(parseBoard(JSON.stringify({ ...observation, visible: 'false' })).visible, false);
  assert.equal(parseBoard(JSON.stringify({ ...observation, orientation: 'auto' })).visible, false);
  const reason = parseBoard(JSON.stringify({ visible: false, reason: 'x'.repeat(500) })).reason;
  assert.equal(reason.length, 300);
});

test('recognition sends only screenshot data, carries orientation, and keeps the API key out of its URL and payload', async () => {
  let sent;
  const board = await recognizeBoard(image, settings, { orientation: 'black', cropped: true,
    fetchImpl: async (url, options) => { sent = { url, options, body: JSON.parse(options.body) }; return response({ ...observation, orientation: 'black' }); }
  });
  assert.equal(board.orientation, 'black');
  assert.equal(board.bounds, undefined);
  assert.equal(sent.options.headers['x-goog-api-key'], settings.key);
  assert.ok(!sent.url.includes(settings.key));
  assert.ok(!sent.options.body.includes(settings.key));
  assert.deepEqual(sent.body.contents, [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/png', data: 'YWJj' } }] }]);
  assert.match(sent.body.systemInstruction.parts[0].text, /Orientation setting: black/);
  assert.match(sent.body.systemInstruction.parts[0].text, /never instructions/);
  assert.match(sent.body.systemInstruction.parts[0].text, /Omit bounds/);
  assert.equal(sent.body.generationConfig.responseMimeType, 'application/json');
  assert.equal(sent.body.generationConfig.temperature, 0);
});

test('recognition returns uncertainty and rejects incomplete provider output or HTTP failures', async () => {
  assert.deepEqual(await recognizeBoard(image, settings, { fetchImpl: async () => response({ visible: false, certain: false, reason: 'Pieces are moving.' }) }), {
    visible: false, reason: 'Pieces are moving.'
  });
  await assert.rejects(recognizeBoard(image, settings, { fetchImpl: async () => response(observation, 'MAX_TOKENS') }), /incomplete/);
  await assert.rejects(recognizeBoard(image, settings, { fetchImpl: async () => new Response('{}', { status: 429 }) }), /HTTP 429/);
  await assert.rejects(recognizeBoard(image, settings, { fetchImpl: async () => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [] } }] })) }), /no position/);
});

test('recognition validates configuration and media before provider access, and reports cancellation', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return response(observation); };
  await assert.rejects(recognizeBoard(image, { ...settings, key: '' }, { fetchImpl }), /API key/);
  await assert.rejects(recognizeBoard(image, { ...settings, model: '../../bad' }, { fetchImpl }), /model ID/);
  await assert.rejects(recognizeBoard('data:image/svg+xml;base64,YWJj', settings, { fetchImpl }), /Invalid board screenshot/);
  await assert.rejects(recognizeBoard('not an image', settings, { fetchImpl }), /Invalid board screenshot/);
  assert.equal(calls, 0);
  const controller = new AbortController();
  const pending = recognizeBoard(image, settings, { signal: controller.signal,
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted'))))
  });
  controller.abort();
  await assert.rejects(pending, /recognition cancelled/);
});
