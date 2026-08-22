import { describe, expect, test } from 'bun:test';
import { Effect, Layer } from 'effect';
import * as Duration from 'effect/Duration';
import * as HttpModule from 'effect/unstable/http/HttpClient';
import type { HttpClientRequest } from 'effect/unstable/http/HttpClientRequest';
import * as HttpClientResponse from 'effect/unstable/http/HttpClientResponse';
import {
  TurnstileVerifier,
  type TurnstileVerifierError,
} from './turnstile-verifier';

const SECRET = 'secret-sentinel-DO-NOT-LEAK';
const TOKEN = 'token-sentinel-also-secret';

interface RecordedRequest {
  url: string;
  body: unknown;
}

/** Decodes the JSON body the client would put on the wire. */
const wireBody = (request: HttpClientRequest.HttpClientRequest): unknown =>
  JSON.parse(new TextDecoder().decode(request.body?.body as Uint8Array));

/**
 * Builds an HttpClient whose single request runner is the provided effectful
 * responder, recording every request for assertions.
 */
const clientLayerWith = (
  respond: (
    request: HttpClientRequest.HttpClientRequest,
  ) => Effect.Effect<Response, { readonly _tag: string }>,
): Layer.Layer<HttpModule.HttpClient, never, never> & {
  requests: Array<RecordedRequest>;
} => {
  const requests: Array<RecordedRequest> = [];
  const client = HttpModule.make((request) =>
    Effect.map(
      respond(request),
      (response): HttpClientResponse.HttpClientResponse =>
        HttpClientResponse.fromWeb(request, response),
    ),
  );
  return Object.assign(Layer.succeed(HttpModule.HttpClient, client), {
    requests,
  });
};

const siteverifyResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const successPayload = {
  success: true,
  action: 'turnstile-spin-v1',
  hostname: 'maelstrom-ai.co',
};

/** Captures console.error so tests can assert exactly what gets logged. */
const captureConsoleErrors = () => {
  const entries: Array<unknown> = [];
  const original = console.error;
  console.error = (value: unknown) => {
    entries.push(value);
  };
  return {
    entries,
    restore: () => {
      console.error = original;
    },
  };
};

/** Verifier wired over a stubbed transport, ready to provide to programs. */
const verifierOver = (
  clientLayer: ReturnType<typeof clientLayerWith>,
  options: { readonly timeout?: Duration.DurationInput } = {},
): Layer.Layer<TurnstileVerifier, never, never> =>
  TurnstileVerifier.layer({ secret: SECRET, ...options }).pipe(
    Layer.provide(clientLayer),
  );

const verifyProgram = (layer: Layer.Layer<TurnstileVerifier, never, never>) =>
  Effect.gen(function* () {
    const verifier = yield* TurnstileVerifier;
    return yield* verifier.verify(TOKEN, null);
  }).pipe(Effect.provide(layer));

const verifyFailure = async (
  layer: Layer.Layer<TurnstileVerifier, never, never>,
): Promise<TurnstileVerifierError> =>
  Effect.runPromise(Effect.flip(verifyProgram(layer)));

describe('turnstile verifier', () => {
  test('sends secret and token to siteverify exactly once', async () => {
    let sent: RecordedRequest | undefined;
    const layer = clientLayerWith((request) => {
      sent = {
        url: request.url,
        body: wireBody(request),
      };
      return Effect.succeed(siteverifyResponse(successPayload));
    });
    await Effect.runPromise(verifyProgram(verifierOver(layer)));
    expect(sent).toEqual({
      url: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      body: { secret: SECRET, response: TOKEN },
    });
  });

  test('forwards the connecting IP when present', async () => {
    let body: unknown;
    const layer = clientLayerWith((request) => {
      body = wireBody(request);
      return Effect.succeed(siteverifyResponse(successPayload));
    });
    const program = Effect.gen(function* () {
      const verifier = yield* TurnstileVerifier;
      return yield* verifier.verify(TOKEN, '203.0.113.9');
    }).pipe(Effect.provide(verifierOver(layer)));
    await Effect.runPromise(program);
    expect(body).toEqual({
      secret: SECRET,
      response: TOKEN,
      remoteip: '203.0.113.9',
    });
  });

  test('classifies a rejected challenge without retrying', async () => {
    let calls = 0;
    const layer = clientLayerWith(() => {
      calls += 1;
      return Effect.succeed(
        siteverifyResponse({
          success: false,
          'error-codes': ['invalid-input-response'],
        }),
      );
    });
    const failure = await verifyFailure(verifierOver(layer));
    // A duplicate challenge can flip to invalid, so a second attempt is
    // never safe — the provider must see exactly one request.
    expect(calls).toBe(1);
    expect(failure._tag).toBe('TurnstileRejected');
    if (failure._tag !== 'TurnstileRejected') return;
    expect(failure.reason).toBe('challenge_rejected');
    expect(failure.providerCodes).toEqual(['invalid-input-response']);
  });

  test('classifies allowlisted provider outage codes as unavailability', async () => {
    const layer = clientLayerWith(() =>
      Effect.succeed(
        siteverifyResponse({
          success: false,
          'error-codes': ['internal-error'],
        }),
      ),
    );
    const failure = await verifyFailure(verifierOver(layer));
    expect(failure._tag).toBe('TurnstileUnavailable');
    if (failure._tag !== 'TurnstileUnavailable') return;
    expect(failure.category).toBe('provider_unavailable');
  });

  test('classifies non-200 responses as provider outage', async () => {
    const layer = clientLayerWith(() =>
      Effect.succeed(new Response('boom', { status: 503 })),
    );
    const failure = await verifyFailure(verifierOver(layer));
    expect(failure._tag).toBe('TurnstileUnavailable');
    if (failure._tag !== 'TurnstileUnavailable') return;
    expect(failure.category).toBe('provider_http');
  });

  test('classifies malformed JSON bodies as provider outage', async () => {
    const layer = clientLayerWith(() =>
      Effect.succeed(new Response('<html>', { status: 200 })),
    );
    const failure = await verifyFailure(verifierOver(layer));
    expect(failure._tag).toBe('TurnstileUnavailable');
    if (failure._tag !== 'TurnstileUnavailable') return;
    expect(failure.category).toBe('provider_response');
  });

  test('rejects a solved challenge for another action', async () => {
    const layer = clientLayerWith(() =>
      Effect.succeed(
        siteverifyResponse({ ...successPayload, action: 'other-action' }),
      ),
    );
    const failure = await verifyFailure(verifierOver(layer));
    expect(failure._tag).toBe('TurnstileRejected');
    if (failure._tag !== 'TurnstileRejected') return;
    expect(failure.reason).toBe('action_mismatch');
  });

  test('rejects a solved challenge from a foreign hostname', async () => {
    const layer = clientLayerWith(() =>
      Effect.succeed(
        siteverifyResponse({ ...successPayload, hostname: 'evil.example' }),
      ),
    );
    const failure = await verifyFailure(verifierOver(layer));
    expect(failure._tag).toBe('TurnstileRejected');
    if (failure._tag !== 'TurnstileRejected') return;
    expect(failure.reason).toBe('hostname_mismatch');
  });

  test('maps transport failures to unavailability and logs the incident', async () => {
    const logged = captureConsoleErrors();
    const layer = clientLayerWith(() =>
      Effect.fail({ _tag: 'HttpClientError' }),
    );
    const failure = await verifyFailure(verifierOver(layer));
    logged.restore();
    expect(failure._tag).toBe('TurnstileUnavailable');
    if (failure._tag !== 'TurnstileUnavailable') return;
    expect(failure.category).toBe('request_failed');
    // Connectivity incidents must stay visible in operational logs even
    // though the caller only sees a 503.
    expect(logged.entries).toEqual([
      {
        message: 'waitlist Turnstile verification failed',
        category: 'request_failed',
        providerCodes: [],
      },
    ]);
  });

  test('maps a timeout to unavailability and logs the incident', async () => {
    const logged = captureConsoleErrors();
    const slowLayer = clientLayerWith(() =>
      Effect.map(Effect.sleep(Duration.seconds(30)), () => new Response('{}')),
    );
    const program = verifyProgram(
      verifierOver(slowLayer, { timeout: '5 millis' }),
    );
    const failure = await Effect.runPromise(Effect.flip(program));
    logged.restore();
    expect(failure._tag).toBe('TurnstileUnavailable');
    if (failure._tag !== 'TurnstileUnavailable') return;
    expect(failure.category).toBe('request_timeout');
    expect(logged.entries).toEqual([
      {
        message: 'waitlist Turnstile verification failed',
        category: 'request_timeout',
        providerCodes: [],
      },
    ]);
  });

  test('never leaks the secret or token through typed errors', async () => {
    const layer = clientLayerWith(() =>
      Effect.succeed(
        siteverifyResponse({ success: false, 'error-codes': ['bad-request'] }),
      ),
    );
    const failure = await verifyFailure(verifierOver(layer));
    const serialized = JSON.stringify(failure);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain(TOKEN);
  });

  test('logs only categories and allowlisted provider codes', async () => {
    const logged: Array<unknown> = [];
    const original = console.error;
    console.error = (value: unknown) => {
      logged.push(value);
    };
    try {
      const layer = clientLayerWith(() =>
        Effect.succeed(
          siteverifyResponse({
            success: false,
            'error-codes': ['internal-error', 'totally-unknown-provider-code'],
          }),
        ),
      );
      await verifyFailure(verifierOver(layer));
    } finally {
      console.error = original;
    }
    // Persisted logs retain everything they receive, so the raw provider
    // payload and the challenge token must never reach a log line.
    expect(logged).toHaveLength(1);
    expect(logged[0]).toEqual({
      message: 'waitlist Turnstile verification failed',
      category: 'provider_unavailable',
      providerCodes: ['internal-error'],
    });
    expect(JSON.stringify(logged)).not.toContain(SECRET);
    expect(JSON.stringify(logged)).not.toContain(TOKEN);
  });
});
