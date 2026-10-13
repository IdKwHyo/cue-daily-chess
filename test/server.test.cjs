const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../server.cjs');
test('loopback gateway requires same-origin host and session token, and serves only UI files', async () => {
  const server = await startServer({ port: 0 });
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const home = await fetch(url); assert.equal(home.status, 200); assert.ok(home.headers.get('content-security-policy').includes("object-src 'none'"));
    const boot = await (await fetch(url + '/api/bootstrap')).json();
    assert.equal((await fetch(url + '/api/bootstrap', { headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await fetch(url + '/core/service.cjs')).status, 404);
    assert.equal((await fetch(url + '/api/call', { method: 'POST', body: '{}' })).status, 403);
    const result = await fetch(url + '/api/call', { method: 'POST', headers: { 'x-cue-token': boot.token }, body: JSON.stringify({ action: 'settings' }) });
    assert.equal(result.status, 200); assert.equal((await result.json()).key, undefined);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
