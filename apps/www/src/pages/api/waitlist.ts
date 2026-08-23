export const prerender = false;

import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { Effect } from 'effect';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import { WaitlistDeliveryStore } from '../../lib/waitlist-delivery-store';
import { runOrErrorResponse } from '../../server/run-or-error';
import {
  decodeSignupRequest,
  requireTurnstileToken,
} from '../../server/signup-request';
import { SignupWorkflow } from '../../server/signup-workflow';
import { TurnstileVerifier } from '../../server/turnstile-verifier';
import { makeRepository } from '../../server/waitlist-repository';
import {
  toSignupDecodeResponse,
  toSignupFailureResponse,
} from '../../server/waitlist-responses';

export const POST: APIRoute = async ({ request, locals }) => {
  const decoded = await runOrErrorResponse(
    decodeSignupRequest(request),
    toSignupDecodeResponse,
  );
  if (decoded instanceof Response) return decoded;
  const { email } = decoded;

  const database = env.WAITLIST_DB;
  const emailService = env.EMAIL;
  const turnstileSecret = env.TURNSTILE_SECRET_KEY;
  if (!database || !emailService || !turnstileSecret) {
    return new Response(
      JSON.stringify({ error: 'Waitlist signup is temporarily unavailable.' }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  const tokenResult = await runOrErrorResponse(
    requireTurnstileToken(decoded.turnstileToken),
    () => jsonResponse({ error: 'Security check failed.' }, 400),
  );
  if (tokenResult instanceof Response) return tokenResult;
  const turnstileToken = tokenResult;

  const workflowLayer = SignupWorkflow.layer({
    verifier: await Effect.runPromise(
      TurnstileVerifier.make({ secret: turnstileSecret }).pipe(
        Effect.provide(FetchHttpClient.layer),
      ),
    ),
    repository: makeRepository(new WaitlistDeliveryStore(database)),
    emailService,
    nowIso: () => new Date().toISOString(),
  });

  const begun = await runOrErrorResponse(
    Effect.gen(function* () {
      const workflow = yield* SignupWorkflow;
      return yield* workflow.begin({
        email,
        turnstileToken,
        remoteIp: request.headers.get('CF-Connecting-IP'),
      });
    }).pipe(Effect.provide(workflowLayer)),
    toSignupFailureResponse,
  );
  if (begun instanceof Response) return begun;

  if (begun.kind === 'claimed') {
    const delivery = Effect.runPromise(
      Effect.gen(function* () {
        const workflow = yield* SignupWorkflow;
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

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function acceptedResponse(): Response {
  return jsonResponse({ success: true }, 202);
}
