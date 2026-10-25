import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleAguiRequest } from './agui-handler';

afterEach(() => vi.unstubAllEnvs());
function request(body: unknown, origin = 'http://localhost') {
  return new Request('http://localhost/api/experimental-agui', {
    method: 'POST',
    headers: { origin },
    body: JSON.stringify(body),
  });
}
describe('local experimental transport', () => {
  it('does not borrow the normal server key for an experimental live session', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-server-key-must-not-be-used');
    expect(
      (
        await handleAguiRequest(
          request({ sessionId: crypto.randomUUID(), mode: 'live' }),
        )
      ).status,
    ).toBe(400);
  });
  it('refuses cross-origin requests before session creation', async () => {
    expect(
      (
        await handleAguiRequest(
          request(
            { sessionId: crypto.randomUUID(), mode: 'fixture' },
            'https://other.test',
          ),
        )
      ).status,
    ).toBe(403);
  });
  it('keeps the experimental endpoint out of hosted mode', async () => {
    vi.stubEnv('VITE_HOSTED', '1');
    expect(
      (
        await handleAguiRequest(
          request({ sessionId: crypto.randomUUID(), mode: 'fixture' }),
        )
      ).status,
    ).toBe(404);
  });
  it('refuses continuation after the session is deleted', async () => {
    const response = await handleAguiRequest(
      request({ sessionId: crypto.randomUUID(), mode: 'fixture' }),
    );
    const body = (await response.json()) as { token: string };
    const headers = {
      origin: 'http://localhost',
      authorization: `Bearer ${body.token}`,
    };
    expect(
      (
        await handleAguiRequest(
          new Request('http://localhost/api/experimental-agui', {
            method: 'DELETE',
            headers,
          }),
        )
      ).status,
    ).toBe(204);
    expect(
      (
        await handleAguiRequest(
          new Request('http://localhost/api/experimental-agui', {
            method: 'POST',
            headers,
            body: '{}',
          }),
        )
      ).status,
    ).toBe(410);
  });
});
