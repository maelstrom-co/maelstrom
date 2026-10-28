import type { BrowserContext } from '@playwright/test';

/** Rejects unmocked external traffic, returning blocked origins for the test assertion. */
export async function guardE2ENetwork(
  context: Pick<BrowserContext, 'route' | 'routeWebSocket'>,
): Promise<string[]> {
  const blocked: string[] = [];
  const local = (url: string) =>
    ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
  await context.route('**/*', async (route) => {
    if (local(route.request().url())) return route.continue();
    blocked.push(new URL(route.request().url()).origin);
    await route.abort('blockedbyclient');
  });
  await context.routeWebSocket(/.*/, (socket) => {
    if (local(socket.url())) {
      socket.connectToServer();
      return;
    }
    blocked.push(new URL(socket.url()).origin);
    socket.close();
  });
  return blocked;
}
