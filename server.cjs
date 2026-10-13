const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { createService } = require('./core/service.cjs');
function startServer({ port = 4318, service = createService() } = {}) {
  const token = randomBytes(32).toString('hex');
  const allowed = new Set(['index.html', 'styles.css', 'theme.css', 'app.js', 'render.js', 'state.js', 'bridge.js', 'voice.js', 'overlay.js', 'overlay.css', 'chess.js', 'chess.css']);
  const server = http.createServer(async (req, res) => {
    const host = `127.0.0.1:${server.address().port}`;
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    if (req.headers.host !== host || (req.headers.origin && req.headers.origin !== `http://${host}`)) return json(403, { error: 'Untrusted origin.' });
    try {
      if (req.method === 'GET' && req.url === '/api/bootstrap') return json(200, { token });
      if (req.method === 'POST' && req.url === '/api/call') {
        if (req.headers['x-cue-token'] !== token) return json(403, { error: 'Invalid session.' });
        let body = '', size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 15500000) { json(413, { error: 'Request is too large.' }); return; } body += chunk; }
        const { action, payload } = JSON.parse(body);
        return json(200, await service.call(action, payload));
      }
      const file = req.url === '/' ? 'index.html' : req.url.slice(1);
      if (req.method !== 'GET' || !allowed.has(file)) return json(404, { error: 'Not found.' });
      res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
      res.end(await fs.readFile(path.join(__dirname, 'ui', file)));
    } catch (error) { if (!res.headersSent) json(400, { error: error.message }); else res.end(); }
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}
if (require.main === module) startServer().then(s => console.log(`Cue Daily: http://127.0.0.1:${s.address().port}`));
module.exports = { startServer };
