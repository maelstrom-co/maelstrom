// The `_` prefix keeps this file out of Astro's router: every non-underscore
// file under src/pages/ becomes a route, which turned this test into a
// prerendered `/api/waitlist.test` endpoint and failed the build on its
// top-level `bun:test` import. The underscore lets it stay colocated with the
// route it covers without shipping as an endpoint. `bun test` still picks it up.
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from 'bun:test';
import { hashWaitlistToken, isWaitlistToken } from '../../lib/waitlist-token';
import { toSignupFailureResponse } from '../../server/signup-failure-response';
import { DeliveryStateConflict } from '../../server/waitlist-repository';

let preparedSqls: string[] = [];
let deliveryAttempt: { id: string } | null = { id: 'attempt-id' };
let confirmation: { email: string } | null = { email: 'user@example.com' };
let waitUntilTasks: Promise<unknown>[] = [];
const first = mock(async () => deliveryAttempt);
const run = mock(async () => ({ success: true }));
const bind = mock(() => ({ first, run }));
const prepare = mock((sql: string) => {
  preparedSqls.push(sql);
  return { bind };
});
const batch = mock(async () => [
  { results: [], success: true },
  { results: confirmation ? [confirmation] : [], success: true },
]);
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
    WAITLIST_DB: { batch, prepare },
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
    locals: {
      cfContext: {
        waitUntil: (task: Promise<unknown>) => waitUntilTasks.push(task),
      },
    },
  } as unknown as Parameters<typeof POST>[0]);
const signupBody = (email = 'user@example.com') =>
  JSON.stringify({ email, turnstileToken: 'turnstile-token' });
const callConfirm = async (token: string) => {
  const setCookies: Array<{
    name: string;
    value: string;
    options?: Record<string, unknown>;
  }> = [];
  const response = await CONFIRM({
    request: new Request('https://maelstrom-ai.co/api/waitlist/confirm', {
      method: 'POST',
      body: new URLSearchParams({ token }),
    }),
    cookies: {
      get: () => undefined,
      set: (name: string, value: string, options?: Record<string, unknown>) => {
        setCookies.push({ name, value, options });
      },
    },
    locals: {
      cfContext: {
        waitUntil: (task: Promise<unknown>) => waitUntilTasks.push(task),
      },
    },
  } as unknown as Parameters<typeof CONFIRM>[0]);
  return { response, setCookies };
};
const expectPrivateConfirmationResponse = (response: Response) => {
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(response.headers.get('x-robots-tag')).toBe('noindex');
};

beforeEach(() => {
  preparedSqls = [];
  preparedSqls = [];
  deliveryAttempt = { id: 'attempt-id' };
  confirmation = { email: 'user@example.com' };
  waitUntilTasks = [];
  first.mockClear();
  bind.mockClear();
  run.mockClear();
  prepare.mockClear();
  batch.mockReset();
  batch.mockResolvedValue([
    { results: [], success: true },
    { results: confirmation ? [confirmation] : [], success: true },
  ]);
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

afterEach(async () => {
  await Promise.allSettled(waitUntilTasks);
});

describe('POST /api/waitlist', () => {
  it('400s on a malformed JSON body', async () => {
    const res = await callPost('not json{');
    expect(res.status).toBe(400);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('415s on an unsupported signup media type before external work', async () => {
    const res = await POST({
      request: new Request('https://example.com/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: signupBody(),
      }),
    } as unknown as Parameters<typeof POST>[0]);

    expect(res.status).toBe(415);
    expect(siteverify).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('415s unsupported signup media types before syntax and size checks', async () => {
    for (const body of ['not json{', 'x'.repeat(5000)]) {
      const res = await POST({
        request: new Request('https://example.com/api/waitlist', {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body,
        }),
      } as unknown as Parameters<typeof POST>[0]);
      expect(res.status).toBe(415);
    }
  });

  it('accepts a case-insensitive JSON media type with parameters', async () => {
    const res = await POST({
      request: new Request('https://example.com/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'Application/JSON; Charset=UTF-8' },
        body: signupBody(),
      }),
    } as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(202);
  });

  it('400s on an invalid email without writing to D1', async () => {
    const res = await callPost(signupBody('nope'));
    expect(res.status).toBe(400);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('stores a pending subscriber and sends a confirmation email', async () => {
    const res = await callPost(signupBody());
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ success: true });
    expect(prepare).toHaveBeenCalledTimes(3);
    expect(bind).toHaveBeenCalledTimes(3);
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
      'https://maelstrom-ai.co/waitlist/confirm/#token=v1.',
    );
    expect(send.mock.calls[0]?.[0].text).not.toContain('?token=');
    expect(send.mock.calls[0]?.[0].html).toContain('>Confirm my email</a>');
    const emailedToken = send.mock.calls[0]?.[0].text.match(
      /#token=(v1\.[A-Za-z0-9_-]{43})/,
    )?.[1];
    expect(isWaitlistToken(emailedToken)).toBe(true);
    expect(await hashWaitlistToken(emailedToken ?? '')).toBe(
      bind.mock.calls[1]?.[1],
    );
  });

  it('persists the delivery claim before calling Email Service', async () => {
    const claim = Promise.withResolvers<{ id: string }>();
    first.mockImplementationOnce(() => claim.promise);

    const response = callPost(signupBody());
    await Bun.sleep(0);

    expect(first).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();

    claim.resolve({ id: 'attempt-id' });
    expect((await response).status).toBe(202);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('responds after the durable claim without awaiting Email Service', async () => {
    const delivery = Promise.withResolvers<{ messageId: string }>();
    send.mockImplementationOnce(() => delivery.promise);
    let response: Response | undefined;

    void callPost(signupBody()).then((value) => {
      response = value;
    });
    await Bun.sleep(0);

    expect(response?.status).toBe(202);
    expect(waitUntilTasks).toHaveLength(1);
    let deliverySettled = false;
    void waitUntilTasks[0]?.then(() => {
      deliverySettled = true;
    });
    await Bun.sleep(0);
    expect(deliverySettled).toBe(false);
    delivery.resolve({ messageId: 'message-1' });
    await Promise.all(waitUntilTasks);
    expect(deliverySettled).toBe(true);
  });

  it('accepts an unclaimed address state without sending', async () => {
    deliveryAttempt = null;
    const res = await callPost(signupBody());
    expect(res.status).toBe(202);
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
    const errorLog = spyOn(console, 'error').mockImplementation(() => {});
    first.mockRejectedValueOnce(
      Object.assign(new Error('query contained private detail'), {
        name: 'user@example.com',
        code: `v1.${'a'.repeat(43)}`,
      }),
    );
    try {
      const res = await callPost(signupBody());
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        error: 'Could not start your signup. Please try again.',
      });
      expect(send).not.toHaveBeenCalled();
      expect(errorLog).toHaveBeenCalledWith({
        message: 'waitlist signup failed',
        category: 'signup_store_failed',
      });
      expect(JSON.stringify(errorLog.mock.calls)).not.toContain(
        'user@example.com',
      );
    } finally {
      errorLog.mockRestore();
    }
  });

  it('keeps an ambiguous Email Service result generic and confirmable', async () => {
    send.mockRejectedValueOnce(new Error('delivery unavailable'));
    const res = await callPost(signupBody());
    await Promise.all(waitUntilTasks);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ success: true });
    expect(run).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(2);
    expect(bind.mock.calls.at(-1)?.[0]).toBe('unknown');
  });

  it('records a definite provider rejection without treating delivery as ambiguous', async () => {
    send.mockRejectedValueOnce(
      Object.assign(new Error('recipient suppressed'), {
        code: 'E_RECIPIENT_SUPPRESSED',
      }),
    );
    const res = await callPost(signupBody());
    await Promise.all(waitUntilTasks);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ success: true });
    expect(run).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(2);
    expect(bind.mock.calls.at(-1)?.[0]).toBe('rejected');
    expect(bind.mock.calls.at(-1)?.[3]).toBe('E_RECIPIENT_SUPPRESSED');
  });

  it('cools down temporary Email Service limits without exposing address state', async () => {
    const errorLog = spyOn(console, 'error').mockImplementation(() => {});
    batch.mockResolvedValueOnce([
      { results: [{ state: 'retryable' }], success: true },
      { results: [], success: true },
    ]);
    send.mockRejectedValueOnce(
      Object.assign(new Error('provider rate limit'), {
        code: 'E_RATE_LIMIT_EXCEEDED',
      }),
    );

    try {
      const res = await callPost(signupBody());
      await Promise.all(waitUntilTasks);

      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ success: true });
      expect(batch).toHaveBeenCalledTimes(1);
      expect(
        bind.mock.calls.some((call) => call.includes('E_RATE_LIMIT_EXCEEDED')),
      ).toBe(true);
      expect(errorLog).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'waitlist email attempt failed',
          category: 'email_send_retryable',
          providerCode: 'E_RATE_LIMIT_EXCEEDED',
        }),
      );
    } finally {
      errorLog.mockRestore();
    }
  });

  it('separates accepted-email state failures from provider failures', async () => {
    const errorLog = spyOn(console, 'error').mockImplementation(() => {});
    first.mockResolvedValueOnce(deliveryAttempt);
    first.mockRejectedValueOnce(new Error('D1 transition unavailable'));
    try {
      const res = await callPost(signupBody());
      await Promise.all(waitUntilTasks);
      expect(res.status).toBe(202);
      expect(errorLog).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'waitlist delivery state update failed',
          category: 'delivery_state_update_failed',
        }),
      );
      expect(JSON.stringify(errorLog.mock.calls)).not.toContain(
        'waitlist email attempt failed',
      );
    } finally {
      errorLog.mockRestore();
    }
  });

  it('rejects a failed Turnstile challenge before writing or sending', async () => {
    const errorLog = spyOn(console, 'error').mockImplementation(() => {});
    siteverify.mockResolvedValueOnce(
      Response.json({
        success: false,
        'error-codes': ['timeout-or-duplicate', 'untrusted-code'],
        action: 'turnstile-spin-v1',
        hostname: 'maelstrom-ai.co',
      }),
    );
    try {
      const res = await callPost(signupBody());
      expect(res.status).toBe(400);
      expect(prepare).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
      expect(errorLog).toHaveBeenCalledWith({
        message: 'waitlist Turnstile verification failed',
        category: 'challenge_rejected',
        providerCodes: ['timeout-or-duplicate'],
      });
      expect(JSON.stringify(errorLog.mock.calls)).not.toContain(
        'turnstile-token',
      );
    } finally {
      errorLog.mockRestore();
    }
  });

  for (const result of [
    {
      success: true,
      action: 'wrong-action',
      hostname: 'maelstrom-ai.co',
    },
    {
      success: true,
      action: 'turnstile-spin-v1',
      hostname: 'attacker.example',
    },
  ]) {
    it('rejects successful Turnstile responses outside the waitlist contract', async () => {
      siteverify.mockResolvedValueOnce(Response.json(result));

      const res = await callPost(signupBody());

      expect(res.status).toBe(400);
      expect(prepare).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    });
  }

  for (const providerCode of ['invalid-input-secret', 'internal-error']) {
    it(`503s when Turnstile reports provider failure ${providerCode}`, async () => {
      siteverify.mockResolvedValueOnce(
        Response.json({ success: false, 'error-codes': [providerCode] }),
      );

      const res = await callPost(signupBody());

      expect(res.status).toBe(503);
      expect(prepare).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    });
  }

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
  it('415s unsupported confirmation media types before parsing', async () => {
    const res = await CONFIRM({
      request: new Request('https://maelstrom-ai.co/api/waitlist/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: `token=v1.${'a'.repeat(43)}`,
      }),
    } as Parameters<typeof CONFIRM>[0]);

    expect(res.status).toBe(415);
    expectPrivateConfirmationResponse(res);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('rejects a malformed token without querying D1', async () => {
    const { response: res, setCookies } = await callConfirm('not-a-token');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(
      'https://maelstrom-ai.co/waitlist/invalid/',
    );
    expectPrivateConfirmationResponse(res);
    expect(setCookies).toHaveLength(0);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('confirms a pending subscriber with a live token', async () => {
    const { response: res, setCookies } = await callConfirm(
      `v1.${'a'.repeat(43)}`,
    );
    await Promise.all(waitUntilTasks);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(
      'https://maelstrom-ai.co/waitlist/confirmed/',
    );
    expectPrivateConfirmationResponse(res);
    expect(preparedSqls).toContainEqual(
      expect.stringContaining("SET status = 'confirmed'"),
    );
    // The receipt must commit inside the confirmation batch: a separate write
    // would strand a confirmed visitor without page access if it failed.
    expect(batch).toHaveBeenCalledTimes(1);
    const batchedStatements = batch.mock.calls[0]?.[0] as unknown[];
    expect(batchedStatements).toHaveLength(3);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: 'Join the Maelstrom beta community',
        text: expect.stringContaining('https://discord.gg/XAjJqrF2u3'),
        html: expect.stringContaining('https://discord.gg/XAjJqrF2u3'),
      }),
    );

    // The receipt is the only way back onto the gated page, so its cookie
    // must be unreadable to scripts and confined to the result path.
    expect(setCookies).toHaveLength(1);
    const [receipt] = setCookies;
    expect(receipt?.name).toBe('waitlist_receipt');
    expect(receipt?.value).toMatch(/^v1\.[A-Za-z0-9_-]{43}$/);
    expect(receipt?.options).toMatchObject({
      path: '/waitlist/confirmed',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 3600,
    });
  });

  it('keeps confirmation successful when invitation email delivery fails', async () => {
    const errorLog = spyOn(console, 'error').mockImplementation(() => {});
    send.mockRejectedValueOnce(new Error('private provider detail'));
    try {
      const { response: res, setCookies } = await callConfirm(
        `v1.${'a'.repeat(43)}`,
      );
      await Promise.all(waitUntilTasks);

      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe(
        'https://maelstrom-ai.co/waitlist/confirmed/',
      );
      // The gate is independent of email delivery: a confirmed visitor can
      // always reach the community through the page itself.
      expect(setCookies).toHaveLength(1);
      expect(errorLog).toHaveBeenCalledWith({
        message: 'waitlist invitation email failed',
        category: 'invitation_email_failed',
      });
      expect(JSON.stringify(errorLog.mock.calls)).not.toContain(
        'private provider detail',
      );
    } finally {
      errorLog.mockRestore();
    }
  });

  it('shows an invalid result for an expired or already-used token', async () => {
    confirmation = null;
    batch.mockResolvedValueOnce([
      { results: [], success: true },
      { results: [], success: true },
    ]);
    const { response: res, setCookies } = await callConfirm(
      `v1.${'a'.repeat(43)}`,
    );
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(
      'https://maelstrom-ai.co/waitlist/invalid/',
    );
    expect(send).not.toHaveBeenCalled();
    expect(setCookies).toHaveLength(0);
  });

  it('503s without leaking D1 failure details', async () => {
    const errorLog = spyOn(console, 'error').mockImplementation(() => {});
    batch.mockRejectedValueOnce(
      Object.assign(new Error('private database detail'), {
        name: 'user@example.com',
        code: `v1.${'a'.repeat(43)}`,
      }),
    );
    try {
      const { response: res } = await callConfirm(`v1.${'a'.repeat(43)}`);
      expect(res.status).toBe(503);
      expectPrivateConfirmationResponse(res);
      expect(await res.text()).not.toContain('private database detail');
      expect(errorLog).toHaveBeenCalledWith({
        message: 'waitlist confirmation failed',
        category: 'confirmation_store_failed',
      });
      expect(JSON.stringify(errorLog.mock.calls)).not.toContain(
        'user@example.com',
      );
    } finally {
      errorLog.mockRestore();
    }
  });

  it('413s before parsing an oversized confirmation body', async () => {
    const res = await CONFIRM({
      request: new Request('https://maelstrom-ai.co/api/waitlist/confirm', {
        method: 'POST',
        body: new URLSearchParams({ token: 'a'.repeat(600) }),
      }),
    } as Parameters<typeof CONFIRM>[0]);
    expect(res.status).toBe(413);
    expectPrivateConfirmationResponse(res);
    expect(prepare).not.toHaveBeenCalled();
  });
});

describe('signup failure mapping', () => {
  it('treats a delivery-state conflict as an outage, not a security rejection', async () => {
    const errorLog = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = toSignupFailureResponse(new DeliveryStateConflict({}));
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        error: 'Could not start your signup. Please try again.',
      });
    } finally {
      errorLog.mockRestore();
    }
  });
});
