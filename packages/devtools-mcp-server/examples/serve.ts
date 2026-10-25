import { join } from 'node:path';

const built = await Bun.build({
  entrypoints: [join(import.meta.dirname, 'browser.ts')],
  target: 'browser',
  conditions: ['@maelstrom-co/source', 'development', 'browser'],
  define: { 'process.env.NODE_ENV': JSON.stringify('development') },
});
if (!built.success)
  throw new Error('Unable to build the local browser fixture.');
const script = await built.outputs[0].text();
const html = await Bun.file(join(import.meta.dirname, 'index.html')).text();
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 4321,
  fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/browser.js')
      return new Response(script, {
        headers: { 'Content-Type': 'text/javascript' },
      });
    return new Response(path === '/' ? html : 'Not found', {
      status: path === '/' ? 200 : 404,
      headers: { 'Content-Type': 'text/html' },
    });
  },
});
console.log('Local MCP fixture: http://127.0.0.1:4321');
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    server.stop(true);
  });
