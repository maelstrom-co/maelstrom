export const prerender = false;

import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { readLimitedBody } from '../../../lib/read-limited-body';
import { safeErrorMetadata } from '../../../lib/safe-error-metadata';
import {
  hashWaitlistToken,
  isWaitlistToken,
} from '../../../lib/waitlist-token';

const redirect = (request: Request, status: 'confirmed' | 'invalid') => {
  const target = new URL(`/waitlist/${status}/`, request.url);
  return Response.redirect(target, 303);
};

const MAX_CONFIRMATION_BODY_BYTES = 512;

export const POST: APIRoute = async ({ request }) => {
  const body = await readLimitedBody(request, MAX_CONFIRMATION_BODY_BYTES);
  if (!body.ok) {
    return body.tooLarge
      ? new Response('Request body is too large.', { status: 413 })
      : redirect(request, 'invalid');
  }
  const token = new URLSearchParams(body.text).get('token');
  if (!isWaitlistToken(token)) return redirect(request, 'invalid');

  const database = env.WAITLIST_DB;
  if (!database) {
    return new Response('Waitlist confirmation is temporarily unavailable.', {
      status: 503,
    });
  }

  try {
    const tokenHash = await hashWaitlistToken(token);
    const now = new Date().toISOString();
    const confirmed = await database
      .prepare(
        `UPDATE waitlist_subscribers
        SET status = 'confirmed',
            confirmation_token_hash = NULL,
            confirmation_expires_at = NULL,
            confirmed_at = ?,
            updated_at = ?
        WHERE confirmation_token_hash = ?
          AND status = 'pending'
          AND confirmation_expires_at > ?
        RETURNING email`,
      )
      .bind(now, now, tokenHash, now)
      .first<{ email: string }>();

    return redirect(request, confirmed ? 'confirmed' : 'invalid');
  } catch (err) {
    console.error('[waitlist] confirmation failed:', safeErrorMetadata(err));
    return new Response('Waitlist confirmation is temporarily unavailable.', {
      status: 503,
    });
  }
};
