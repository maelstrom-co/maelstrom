export const prerender = false;

import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { readLimitedBody } from '../../../lib/read-limited-body';
import { WaitlistDeliveryStore } from '../../../lib/waitlist-delivery-store';
import { buildWaitlistInvitationEmail } from '../../../lib/waitlist-invitation-email';
import {
  hashWaitlistToken,
  isWaitlistToken,
} from '../../../lib/waitlist-token';

const redirect = (request: Request, status: 'confirmed' | 'invalid') => {
  const target = new URL(`/waitlist/${status}/`, request.url);
  return privateResponse(null, {
    status: 303,
    headers: { Location: target.href },
  });
};

const MAX_CONFIRMATION_BODY_BYTES = 512;

export const POST: APIRoute = async ({ request, locals }) => {
  const mediaType = request.headers
    .get('Content-Type')
    ?.split(';', 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== 'application/x-www-form-urlencoded') {
    return privateResponse('Unsupported media type.', { status: 415 });
  }

  const body = await readLimitedBody(request, MAX_CONFIRMATION_BODY_BYTES);
  if (!body.ok) {
    return body.tooLarge
      ? privateResponse('Request body is too large.', { status: 413 })
      : redirect(request, 'invalid');
  }
  const token = new URLSearchParams(body.text).get('token');
  if (!isWaitlistToken(token)) return redirect(request, 'invalid');

  const database = env.WAITLIST_DB;
  if (!database) {
    return privateResponse(
      'Waitlist confirmation is temporarily unavailable.',
      {
        status: 503,
      },
    );
  }

  try {
    const tokenHash = await hashWaitlistToken(token);
    const now = new Date().toISOString();
    const confirmation = await new WaitlistDeliveryStore(database).confirmToken(
      tokenHash,
      now,
    );

    if (!confirmation) return redirect(request, 'invalid');

    const emailService = env.EMAIL;
    if (emailService) {
      const delivery = deliverInvitationEmail(emailService, confirmation.email);
      if (locals?.cfContext) {
        locals.cfContext.waitUntil(delivery);
      } else {
        await delivery;
      }
    } else {
      logInvitationEmailFailure('invitation_email_unavailable');
    }

    return redirect(request, 'confirmed');
  } catch {
    console.error({
      message: 'waitlist confirmation failed',
      category: 'confirmation_store_failed',
    });
    return privateResponse(
      'Waitlist confirmation is temporarily unavailable.',
      {
        status: 503,
      },
    );
  }
};

async function deliverInvitationEmail(
  emailService: SendEmail,
  email: string,
): Promise<void> {
  try {
    const result = await emailService.send({
      ...buildWaitlistInvitationEmail(),
      to: email,
    });
    if (!result.messageId) logInvitationEmailFailure('invitation_email_failed');
  } catch {
    logInvitationEmailFailure('invitation_email_failed');
  }
}

function logInvitationEmailFailure(category: string): void {
  console.error({
    message: 'waitlist invitation email failed',
    category,
  });
}

function privateResponse(body: BodyInit | null, init: ResponseInit): Response {
  const headers = new Headers(init.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Robots-Tag', 'noindex');
  return new Response(body, { ...init, headers });
}
