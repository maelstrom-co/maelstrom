export const prerender = false;

import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { Effect, Layer } from 'effect';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import { runOrErrorResponse } from '../../../server/run-or-error';
import {
  decodeSignupRequest,
  requireTurnstileToken,
} from '../../../server/signup-request';
import {
  TurnstileVerifier,
  type TurnstileVerifierError,
} from '../../../server/turnstile-verifier';
import { WaitlistRepository } from '../../../server/waitlist-repository';
import { WaitlistResendWorkflow } from '../../../server/waitlist-resend-workflow';
import {
  privateResponse,
  toSignupDecodeResponse,
} from '../../../server/waitlist-responses';

export const POST: APIRoute = async ({ request, locals }) => {
  const decoded = await runOrErrorResponse(
    decodeSignupRequest(request),
    (error) => {
      const mapped = toSignupDecodeResponse(error);
      return privateResponse(mapped.body, {
        status: mapped.status,
        headers: mapped.headers,
      });
    },
  );
  if (decoded instanceof Response) return decoded;

  const origin = request.headers.get('Origin');
  if (
    origin === null ||
    origin === 'null' ||
    origin !== new URL(request.url).origin
  ) {
    return jsonResponse({ error: 'Request origin is not allowed.' }, 403);
  }

  const database = env.WAITLIST_DB;
  const emailService = env.EMAIL;
  const turnstileSecret = env.TURNSTILE_SECRET_KEY;
  if (!database || !emailService || !turnstileSecret) {
    return jsonResponse(
      { error: 'Waitlist resend is temporarily unavailable.' },
      503,
    );
  }

  const token = await runOrErrorResponse(
    requireTurnstileToken(decoded.turnstileToken),
    () => jsonResponse({ error: 'Security check failed.' }, 400),
  );
  if (token instanceof Response) return token;

  const verifier = await Effect.runPromise(
    TurnstileVerifier.make({ secret: turnstileSecret }).pipe(
      Effect.provide(FetchHttpClient.layer),
    ),
  );
  const verified = await runOrErrorResponse(
    verifier.verify(token, request.headers.get('CF-Connecting-IP')),
    turnstileFailureResponse,
  );
  if (verified instanceof Response) return verified;

  const workflowLayer = WaitlistResendWorkflow.layer({
    emailService,
    nowIso: () => new Date().toISOString(),
  }).pipe(Layer.provide(WaitlistRepository.layer(database)));
  const begun = await runOrErrorResponse(
    Effect.gen(function* () {
      const workflow = yield* WaitlistResendWorkflow;
      return yield* workflow.begin(decoded.email);
    }).pipe(Effect.provide(workflowLayer)),
    () => {
      console.error({
        message: 'waitlist resend failed',
        category: 'resend_store_failed',
      });
      return acceptedResponse();
    },
  );
  if (begun instanceof Response) return begun;

  if (begun.kind === 'claimed') {
    const delivery = Effect.runPromise(
      Effect.gen(function* () {
        const workflow = yield* WaitlistResendWorkflow;
        yield* workflow.deliver(begun);
      }).pipe(Effect.provide(workflowLayer)),
    );
    if (locals?.cfContext) {
      locals.cfContext.waitUntil(delivery);
    } else {
      await delivery;
    }
  }
  return acceptedResponse();
};

function turnstileFailureResponse(error: TurnstileVerifierError): Response {
  return error._tag === 'TurnstileRejected'
    ? jsonResponse({ error: 'Security check failed. Please try again.' }, 400)
    : jsonResponse(
        { error: 'Waitlist resend is temporarily unavailable.' },
        503,
      );
}

function acceptedResponse(): Response {
  return jsonResponse({ success: true }, 202);
}

function jsonResponse(value: unknown, status: number): Response {
  return privateResponse(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
