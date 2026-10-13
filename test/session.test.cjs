const { test } = require('node:test');
const assert = require('node:assert/strict');
test('session export strips untrusted properties, keys and image bytes while preserving work', async () => {
  const { initialState, exportSession, parseSession } = await import('../ui/state.js');
  const state = initialState(); state.key = 'secret'; state.workspaces.daily.items[0].images = ['private screenshot'];
  state.workspaces.daily.items[0].text = 'A real question';
  const output = exportSession(state);
  assert.ok(!output.includes('secret')); assert.ok(!output.includes('private screenshot'));
  assert.equal(parseSession(JSON.parse(output)).workspaces.daily.items[0].text, 'A real question');
  assert.throws(() => parseSession({ version: 2 }), /not a Cue Daily/);
});
test('Markdown renders code safely instead of executing HTML or script payloads', async () => {
  const { markdown } = await import('../ui/render.js');
  const html = markdown('## Title\n<img src=x onerror=alert(1)>\n```html\n<script>alert(1)</script>\n```\n**Bold**');
  assert.ok(!html.includes('<img')); assert.ok(!html.includes('<script>')); assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('<strong>Bold</strong>'));
});
