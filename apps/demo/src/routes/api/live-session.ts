import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/live-session')({
  server: {
    handlers: {
      // Only the authenticated, loopback-bound Vite middleware can spend a local key.
      POST: () =>
        Response.json(
          { error: 'Local Live exchange is unavailable in this host' },
          {
            status: 403,
            headers: {
              'Cache-Control': 'no-store',
              'X-Maelstrom-Live-Access': 'denied',
            },
          },
        ),
    },
  },
});
