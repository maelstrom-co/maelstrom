// The `_` prefix keeps this file out of Astro's router: every non-underscore
// file under src/pages/ becomes a route, which turned this test into a
// prerendered `/api/waitlist.test` endpoint and failed the build on its
// top-level `bun:test` import. The underscore lets it stay colocated with the
// route it covers without shipping as an endpoint. `bun test` still picks it up.
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { hashWaitlistToken, isWaitlistToken } from '../../lib/waitlist-token';

let preparedSql = '';
let subscriber: {
  status: 'pending' | 'confirmed' | 'unsubscribed';
  should_send: 0 | 1;
} | null = {
  status: 'pending',
  should_send: 1,
};
let previous: {
  status: 'pending' | 'confirmed' | 'unsubscribed';
  confirmation_token_hash: string | null;
  confirmation_expires_at: string | null;
  confirmation_sent_at: string | null;
  unsubscribed_at: string | null;
  updated_at: string;
} | null = null;
let confirmation: { email: string } | null = { email: 'user@example.com' };
const first = mock(async () =>
  preparedSql.includes('SELECT status, confirmation_token_hash')
    ? previous
    : preparedSql.includes("SET status = 'confirmed'")
      ? confirmation
      : subscriber,
);
const run = mock(async () => ({ success: true }));
const bind = mock(() => ({ first, run }));
const prepare = mock((sql: string) => {
  preparedSql = sql;
  return { bind };
});
const send = mock(async () => ({ messageId: 'message-1' }));
const siteverify = mock(
  async (_input: RequestInfo | URL, _init?: RequestInit) =>
    Response.json({
      success: true,
      action: 'turnstile-spin-v1',
      hostname: 'maelstrom-ai.co',
    }),
);
globalThis.fetch = siteverify as typeof fetch;

// Registered before the dynamic import below so the route's top-level
// `cloudflare:workers` import resolves to these stubs.
mock.module('cloudflare:workers', () => ({
  env: {
    WAITLIST_DB: { prepare },
    EMAIL: { send },
    TURNSTILE_SECRET_KEY: 'turnstile-secret',
  },
}));

// Dynamic import is required here: mock.module must run before the module loads,
// and static imports are hoisted above it.
const { POST } = await import('./waitlist');
const { POST: CONFIRM } = await import('./waitlist/confirm');

const callPost = (body: string) =>
  POST({
    request: new Request('https://example.com/api/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }),
  } as unknown as Parameters<typeof POST>[0]);
const signupBody = (email = 'user@example.com') =>
  JSON.stringify({ email, turnstileToken: 'turnstile-token' });
const callConfirm = (token: string) =>
  CONFIRM({
    request: new Request('https://maelstrom-ai.co/api/waitlist/confirm', {
      method: 'POST',
      body: new URLSearchParams({ token }),
    }),
  } as Parameters<typeof CONFIRM>[0]);

beforeEach(() => {
  preparedSql = '';
  subscriber = { status: 'pending', should_send: 1 };
  previous = null;
  confirmation = { email: 'user@example.com' };
  first.mockClear();
  bind.mockClear();
  run.mockClear();
  prepare.mockClear();
  send.mockReset();
  send.mockResolvedValue({ messageId: 'message-1' });
  siteverify.mockReset();
  siteverify.mockResolvedValue(
    Response.json({
      success: true,
      action: 'turnstile-spin-v1',
      hostname: 'maelstrom-ai.co',
    }),
  );
});

describe('POST /api/waitlist', () => {
  it('400s on a malformed JSON body', async () => {
    const res = await callPost('not json{');
    expect(res.status).toBe(400);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('400s on an invalid email without writing to D1', async () => {
    const res = await callPost(signupBody('nope'));
    expect(res.status).toBe(400);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('stores a pending subscriber and sends a confirmation email', async () => {
    const res = await callPost(signupBody());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(bind).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        from: {
          email: 'waitlist@notifications.maelstrom-ai.co',
          name: 'Maelstrom',
        },
      }),
    );
    expect(send.mock.calls[0]?.[0].text).toContain(
      'https://maelstrom-ai.co/waitlist/confirm/?token=',
    );
    expect(send.mock.calls[0]?.[0].html).toContain('>Confirm my email</a>');
    const emailedToken = send.mock.calls[0]?.[0].text.match(
      /[?&]token=([A-Za-z0-9_-]{43})/,
    )?.[1];
    expect(isWaitlistToken(emailedToken)).toBe(true);
    expect(await hashWaitlistToken(emailedToken ?? '')).toBe(
      bind.mock.calls[1]?.[1],
    );
  });

  it('does not resend confirmation to an already confirmed subscriber', async () => {
    subscriber = { status: 'confirmed', should_send: 0 };
    const res = await callPost(signupBody());
    expect(res.status).toBe(200);
    expect(send).not.toHaveBeenCalled();
  });

  it('does not resend confirmation during the per-address cooldown', async () => {
    subscriber = { status: 'pending', should_send: 0 };
    const res = await callPost(signupBody());
    expect(res.status).toBe(200);
    expect(send).not.toHaveBeenCalled();
  });

  it('413s before parsing a body larger than the signup contract', async () => {
    const res = await callPost(
      JSON.stringify({
        email: `${'a'.repeat(4096)}@example.com`,
        turnstileToken: 'turnstile-token',
      }),
    );
    expect(res.status).toBe(413);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('500s with a generic message when D1 fails', async () => {
    first.mockRejectedValueOnce(new Error('query contained private detail'));
    const res = await callPost(signupBody());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: 'Could not start your signup. Please try again.',
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('500s when Cloudflare cannot send the confirmation', async () => {
    send.mockRejectedValueOnce(new Error('delivery unavailable'));
    const res = await callPost(signupBody());
    expect(res.status).toBe(500);
    expect(run).toHaveBeenCalledTimes(1);
    expect(preparedSql).toContain('DELETE FROM waitlist_subscribers');
  });

  it('restores the last delivered token when a resend fails', async () => {
    previous = {
      status: 'pending',
      confirmation_token_hash: 'previous-hash',
      confirmation_expires_at: '2026-08-22T00:00:00.000Z',
      confirmation_sent_at: '2026-08-20T00:00:00.000Z',
      unsubscribed_at: null,
      updated_at: '2026-08-20T00:00:00.000Z',
    };
    send.mockRejectedValueOnce(new Error('delivery unavailable'));
    const res = await callPost(signupBody());
    expect(res.status).toBe(500);
    expect(run).toHaveBeenCalledTimes(1);
    expect(preparedSql).toContain('SET status = ?');
  });

  it('rejects a failed Turnstile challenge before writing or sending', async () => {
    siteverify.mockResolvedValueOnce(
      Response.json({
        success: false,
        action: 'turnstile-spin-v1',
        hostname: 'maelstrom-ai.co',
      }),
    );
    const res = await callPost(signupBody());
    expect(res.status).toBe(400);
    expect(prepare).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('fails closed when bounded Turnstile verification is aborted', async () => {
    siteverify.mockImplementationOnce(async (_input, init) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      throw new DOMException('Timed out', 'TimeoutError');
    });
    const res = await callPost(signupBody());
    expect(res.status).toBe(503);
    expect(prepare).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});

describe('POST /api/waitlist/confirm', () => {
  it('rejects a malformed token without querying D1', async () => {
    const res = await callConfirm('not-a-token');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(
      'https://maelstrom-ai.co/waitlist/invalid/',
    );
    expect(prepare).not.toHaveBeenCalled();
  });

  it('confirms a pending subscriber with a live token', async () => {
    const res = await callConfirm('a'.repeat(43));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(
      'https://maelstrom-ai.co/waitlist/confirmed/',
    );
    expect(preparedSql).toContain("SET status = 'confirmed'");
    expect(bind).toHaveBeenCalledTimes(1);
  });

  it('shows an invalid result for an expired or already-used token', async () => {
    confirmation = null;
    const res = await callConfirm('a'.repeat(43));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(
      'https://maelstrom-ai.co/waitlist/invalid/',
    );
  });

  it('503s without leaking D1 failure details', async () => {
    first.mockRejectedValueOnce(new Error('private database detail'));
    const res = await callConfirm('a'.repeat(43));
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain('private database detail');
  });

  it('413s before parsing an oversized confirmation body', async () => {
    const res = await CONFIRM({
      request: new Request('https://maelstrom-ai.co/api/waitlist/confirm', {
        method: 'POST',
        body: new URLSearchParams({ token: 'a'.repeat(600) }),
      }),
    } as Parameters<typeof CONFIRM>[0]);
    expect(res.status).toBe(413);
    expect(prepare).not.toHaveBeenCalled();
  });
});
