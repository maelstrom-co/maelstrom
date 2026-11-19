import { resolve } from 'node:path';

import { LocalWorkspaceHost } from './http-host';

const port = Number(process.env.AGUI_PORT ?? 4310);
const origin = process.env.AGUI_ORIGIN ?? `http://127.0.0.1:${port}`;
const host = new LocalWorkspaceHost(origin);
const root = resolve(import.meta.dirname, '../../dist/client');

Bun.serve({
  hostname: '127.0.0.1',
  port,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return host.fetch(request);
    const path = resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (path !== root && !path.startsWith(`${root}/`))
      return new Response('Not found', { status: 404 });
    const file = Bun.file(path);
    return new Response(
      (await file.exists()) && path !== root
        ? file
        : Bun.file(resolve(root, 'index.html')),
      {
        headers: {
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-store',
          'Content-Security-Policy':
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://tiles.openfreemap.org; connect-src 'self' https://tiles.openfreemap.org https://api.open-meteo.com https://geocoding-api.open-meteo.com https://router.project-osrm.org; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
        },
      },
    );
  },
});
console.log(`AG-UI workspace: ${origin}`);
