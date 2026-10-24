import { Host } from './host.js';
import { FixtureStore } from './workspace.js';

const bundle = await Bun.build({
  entrypoints: [new URL('./browser.tsx', import.meta.url).pathname],
  target: 'browser',
  conditions: ['@maelstrom-co/source'],
});
if (!bundle.success)
  throw new AggregateError(bundle.logs, 'Browser build failed');
const store = new FixtureStore(() => crypto.randomUUID());
const host = new Host(store);
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: Number(process.env.PORT ?? 4318),
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/run') return host.handle(request);
    if (path === '/record' && request.method === 'POST') {
      if (store.creates)
        return new Response('Already created', { status: 409 });
      store.create();
      return Response.json(store.read());
    }
    if (path === '/app.js')
      return new Response(bundle.outputs[0], {
        headers: { 'content-type': 'text/javascript' },
      });
    if (path === '/')
      return new Response(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>AG-UI workspace proof</title><style>
      body{margin:0;padding:32px;background:#111827;color:#e5e7eb;font:18px system-ui}button{font:inherit;padding:12px 18px}section{box-sizing:border-box;background:#1f2937;padding:24px;border:1px solid #4b5563;height:100%}#chart{width:960px;height:640px;margin-top:24px}pre{white-space:pre-wrap;font-size:14px}
      </style></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`,
        { headers: { 'content-type': 'text/html' } },
      );
    return new Response('Not found', { status: 404 });
  },
});
console.log(`Browser experiment: ${server.url} (one goal per server session)`);
