export const prerender = false;

import { env } from 'cloudflare:workers';
import type { APIRoute, AstroCookies } from 'astro';
import { Effect, Layer } from 'effect';
import { decodeConfirmRequest } from '../../../server/confirm-request';
import { ConfirmWorkflow } from '../../../server/confirm-workflow';
import { runOrErrorResponse } from '../../../server/run-or-error';
import { WaitlistRepository } from '../../../server/waitlist-repository';
import {
  confirmRedirect,
  privateResponse,
  toConfirmDecodeResponse,
  toConfirmFailureResponse,
} from '../../../server/waitlist-responses';

const ACCESS_RECEIPT_TTL_SECONDS = 60 * 60;
const ACCESS_RECEIPT_COOKIE = 'waitlist_receipt';

export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const decoded = await runOrErrorResponse(
    decodeConfirmRequest(request),
    (error) => toConfirmDecodeResponse(error, request),
  );
  if (decoded instanceof Response) return decoded;

  const database = env.WAITLIST_DB;
  if (!database) {
    return privateResponse(
      'Waitlist confirmation is temporarily unavailable.',
      { status: 503 },
    );
  }

  const workflowLayer = ConfirmWorkflow.layer({
    emailService: env.EMAIL,
    nowIso: () => new Date().toISOString(),
  }).pipe(Layer.provide(WaitlistRepository.layer(database)));

  const begun = await runOrErrorResponse(
    Effect.gen(function* () {
      const workflow = yield* ConfirmWorkflow;
      return yield* workflow.begin({ token: decoded.token });
    }).pipe(Effect.provide(workflowLayer)),
    toConfirmFailureResponse,
  );
  if (begun instanceof Response) return begun;
  if (begun.kind === 'invalid') return confirmRedirect(request, 'invalid');

  issueAccessReceiptCookie(cookies, begun.receipt);

  const delivery = Effect.runPromise(
    Effect.gen(function* () {
      const workflow = yield* ConfirmWorkflow;
      yield* workflow.deliver({ email: begun.email });
    }).pipe(Effect.provide(workflowLayer)),
  );
  if (locals?.cfContext) {
    locals.cfContext.waitUntil(delivery);
  } else {
    await delivery;
  }

  return confirmRedirect(request, 'confirmed');
};

function issueAccessReceiptCookie(
  cookies: AstroCookies,
  receipt: string,
): void {
  cookies.set(ACCESS_RECEIPT_COOKIE, receipt, {
    path: '/waitlist/confirmed',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: ACCESS_RECEIPT_TTL_SECONDS,
  });
}
