export const prerender = false;

import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { Effect } from 'effect';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import { WaitlistDeliveryStore } from '../../../lib/waitlist-delivery-store';
import { runOrErrorResponse } from '../../../server/run-or-error';
import {
  TurnstileVerifier,
  type TurnstileVerifierError,
} from '../../../server/turnstile-verifier';
import { makeRepository } from '../../../server/waitlist-repository';
import {
  decodeWaitlistResendRequest,
  requireResendTurnstileToken,
} from '../../../server/waitlist-resend-request';
import { WaitlistResendWorkflow } from '../../../server/waitlist-resend-workflow';

export const POST: APIRoute = async ({ request, locals }) => {
  const decoded = await runOrErrorResponse(
    decodeWaitlistResendRequest(request),
    (error) => {
      switch (error._tag) {
        case 'UnsupportedMediaType':
          return jsonResponse({ error: 'Unsupported media type' }, 415);
        case 'BodyTooLarge':
          return jsonResponse({ error: 'Request body is too large' }, 413);
        case 'InvalidBody':
          return jsonResponse({ error: 'Invalid request body' }, 400);
        case 'InvalidEmail':
          return jsonResponse({ error: error.error }, 400);
      }
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
  const turnstileSecret = env.TURNSTILE_SECRET_KEY;
  if (!database || !turnstileSecret) {
    return jsonResponse(
      { error: 'Waitlist resend is temporarily unavailable.' },
      503,
    );
  }

  const token = await runOrErrorResponse(
    requireResendTurnstileToken(decoded.turnstileToken),
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

  const emailService = env.EMAIL;
  if (!emailService) return acceptedResponse();

  const workflowLayer = WaitlistResendWorkflow.layer({
    repository: makeRepository(new WaitlistDeliveryStore(database)),
    emailService,
    nowIso: () => new Date().toISOString(),
  });
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
  const headers = new Headers({ 'Content-Type': 'application/json' });
  headers.set('Cache-Control', 'no-store');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Robots-Tag', 'noindex');
  return new Response(JSON.stringify(value), { status, headers });
}
