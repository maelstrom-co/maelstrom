import type { BrowserContext, Route, WebSocketRoute } from '@playwright/test';
import { expect, it, vi } from 'vitest';
import { guardE2ENetwork } from '../../e2e/network-guard';

it('denies external HTTP and WebSocket traffic without connecting, but permits loopback', async () => {
  let http: Parameters<BrowserContext['route']>[1] | undefined;
  let websocket: Parameters<BrowserContext['routeWebSocket']>[1] | undefined;
  const blocked = await guardE2ENetwork({
    async route(_url, handler) {
      http = handler;
      return { async dispose() {}, async [Symbol.asyncDispose]() {} };
    },
    async routeWebSocket(_url, handler) {
      websocket = handler;
    },
  });
  if (!http || !websocket) throw new Error('Network guard not installed');
  for (const [url, external] of [
    ['https://api.openai.com/v1/chat/completions', true],
    ['https://api.anthropic.com/v1/messages', true],
    ['https://generativelanguage.googleapis.com/v1beta/models', true],
    ['https://unknown-provider.invalid/endpoint', true],
    ['http://127.0.0.1:4173/', false],
    ['http://localhost:4173/', false],
    ['http://[::1]:4173/', false],
  ] as const) {
    const abort = vi.fn();
    const proceed = vi.fn();
    const route = {
      request: () => ({ url: () => url }),
      abort,
      continue: proceed,
    } as unknown as Route;
    await http(route, route.request());
    expect(abort).toHaveBeenCalledTimes(Number(external));
    expect(proceed).toHaveBeenCalledTimes(Number(!external));
  }
  for (const [url, external] of [
    ['wss://api.openai.com/v1/realtime', true],
    ['wss://unknown-provider.invalid/realtime', true],
    ['ws://127.0.0.1:4173/ws', false],
    ['ws://localhost:4173/ws', false],
  ] as const) {
    const close = vi.fn();
    const connectToServer = vi.fn();
    await websocket({
      url: () => url,
      close,
      connectToServer,
    } as unknown as WebSocketRoute);
    expect(close).toHaveBeenCalledTimes(Number(external));
    expect(connectToServer).toHaveBeenCalledTimes(Number(!external));
  }
  expect(blocked).toHaveLength(6);
  expect(blocked).not.toContain('http://127.0.0.1:4173');
});
