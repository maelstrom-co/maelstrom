import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import { once } from 'node:events';
import { forwardPort, checkPort } from './forward.mjs';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}
const close = server => new Promise(resolve => server.close(resolve));

test('forwards bytes in both directions and closes active connections', { timeout: 5000 }, async () => {
  const echo = net.createServer(socket => socket.pipe(socket));
  const targetPort = await listen(echo);
  const forward = await forwardPort({ host: '127.0.0.1', targetPort, listenPort: 0 });
  const socket = net.connect(forward.port, '127.0.0.1');
  try {
    await once(socket, 'connect');
    const received = once(socket, 'data');
    socket.write('round-trip');
    assert.equal((await received)[0].toString(), 'round-trip');
    const ended = once(socket, 'close');
    await forward.close();
    await ended;
    await forward.close(); // Idempotent.
  } finally {
    socket.destroy(); await forward.close(); await close(echo);
  }
});

test('preserves HTTP Host and Origin without rewriting them', { timeout: 5000 }, async () => {
  const upstream = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ host: req.headers.host, origin: req.headers.origin }));
  });
  const targetPort = await listen(upstream);
  const forward = await forwardPort({ host: '127.0.0.1', targetPort, listenPort: 0 });
  try {
    await checkPort('127.0.0.1', targetPort);
    const result = await new Promise((resolve, reject) => {
      http.get({ host:'127.0.0.1', port: forward.port, path:'/', headers: {
        Host:'localhost:3000', Origin:'http://localhost:3000', Connection:'close',
      } }, res => {
        let text = '';
        res.on('data', b => { text += b; });
        res.on('end', () => resolve(JSON.parse(text)));
      }).on('error', reject);
    });
    assert.deepEqual(result, { host:'localhost:3000', origin:'http://localhost:3000' });
  } finally { await forward.close(); await close(upstream); }
});

test('reports unavailable upstream ports without a silent fallback', { timeout: 5000 }, async () => {
  const server = net.createServer();
  const port = await listen(server);
  await close(server);
  await assert.rejects(checkPort('127.0.0.1', port), /Cannot reach/);
});
