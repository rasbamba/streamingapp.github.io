const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('server has required API routes', () => {
  const serverCode = fs.readFileSync('./server.js', 'utf8');
  assert.ok(serverCode.includes("app.post('/api/sessions'"));
  assert.ok(serverCode.includes("app.post('/api/sessions/:sessionId/start'"));
  assert.ok(serverCode.includes("app.post('/api/sessions/:sessionId/stop'"));
});

test('frontend references socket.io', () => {
  const html = fs.readFileSync('./public/index.html', 'utf8');
  assert.ok(html.includes('/socket.io/socket.io.js'));
});
