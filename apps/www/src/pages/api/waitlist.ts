export const prerender = false;

import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { readLimitedBody } from '../../lib/read-limited-body';
import { safeErrorMetadata } from '../../lib/safe-error-metadata';
import { validateWaitlistEmail } from '../../lib/waitlist';
import {
  createWaitlistToken,
  hashWaitlistToken,
} from '../../lib/waitlist-token';

const CONFIRMATION_TTL_MS = 24 * 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 10 * 60 * 1000;
const MAX_BODY_BYTES = 4096;
const TURNSTILE_ACTION = 'turnstile-spin-v1';
const TURNSTILE_HOSTNAMES = new Set(['maelstrom-ai.co', 'www.maelstrom-ai.co']);
const FROM = {
  email: 'waitlist@notifications.maelstrom-ai.co',
  name: 'Maelstrom',
};

function confirmationMessage(token: string) {
  const url = `https://maelstrom-ai.co/waitlist/confirm/?token=${token}`;
  return {
    from: FROM,
    subject: 'Confirm your Maelstrom waitlist signup',
    text: `Confirm your Maelstrom private beta signup: ${url}\n\nThis link expires in 24 hours. If you did not request this, you can ignore this email.`,
    html: `<p>Confirm your Maelstrom private beta signup:</p><p><a href="${url}">Confirm my email</a></p><p>This link expires in 24 hours. If you did not request this, you can ignore this email.</p>`,
  };
}

export const POST: APIRoute = async ({ request }) => {
  const body = await readJsonBody(request);
  if (!body.ok) {
    return new Response(JSON.stringify({ error: body.error }), {
      status: body.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const validation = validateWaitlistEmail(body.value);
  if (!validation.ok) {
    return new Response(JSON.stringify({ error: validation.error }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const email = validation.email;
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

  const turnstileToken = readTurnstileToken(body.value);
  if (!turnstileToken) {
    return new Response(JSON.stringify({ error: 'Security check failed.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const turnstile = await verifyTurnstile(
    turnstileToken,
    turnstileSecret,
    request.headers.get('CF-Connecting-IP'),
  );
  if (!turnstile.ok) {
    return new Response(
      JSON.stringify({
        error: turnstile.unavailable
          ? 'Waitlist signup is temporarily unavailable.'
          : 'Security check failed. Please try again.',
      }),
      {
        status: turnstile.unavailable ? 503 : 400,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  const token = createWaitlistToken();
  const tokenHash = await hashWaitlistToken(token);
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + CONFIRMATION_TTL_MS).toISOString();
  const cooldown = new Date(now.getTime() - RESEND_COOLDOWN_MS).toISOString();

  try {
    const previous = await database
      .prepare(
        `SELECT status, confirmation_token_hash, confirmation_expires_at,
                confirmation_sent_at, unsubscribed_at, updated_at
          FROM waitlist_subscribers
          WHERE email = ?`,
      )
      .bind(email)
      .first<PreviousSubscriber>();

    const subscriber = await database
      .prepare(
        `INSERT INTO waitlist_subscribers (
        email, status, confirmation_token_hash, confirmation_expires_at,
        confirmation_sent_at, updated_at
      ) VALUES (?, 'pending', ?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET
        status = CASE
          WHEN waitlist_subscribers.status = 'confirmed' THEN 'confirmed'
          WHEN waitlist_subscribers.confirmation_sent_at > ?
            THEN waitlist_subscribers.status
          ELSE 'pending'
        END,
        confirmation_token_hash = CASE
          WHEN waitlist_subscribers.status = 'confirmed'
            THEN waitlist_subscribers.confirmation_token_hash
          WHEN waitlist_subscribers.confirmation_sent_at > ?
            THEN waitlist_subscribers.confirmation_token_hash
          ELSE excluded.confirmation_token_hash
        END,
        confirmation_expires_at = CASE
          WHEN waitlist_subscribers.status = 'confirmed'
            THEN waitlist_subscribers.confirmation_expires_at
          WHEN waitlist_subscribers.confirmation_sent_at > ?
            THEN waitlist_subscribers.confirmation_expires_at
          ELSE excluded.confirmation_expires_at
        END,
        confirmation_sent_at = CASE
          WHEN waitlist_subscribers.status = 'confirmed'
            THEN waitlist_subscribers.confirmation_sent_at
          WHEN waitlist_subscribers.confirmation_sent_at > ?
            THEN waitlist_subscribers.confirmation_sent_at
          ELSE excluded.confirmation_sent_at
        END,
        unsubscribed_at = CASE
          WHEN waitlist_subscribers.status = 'confirmed'
            THEN waitlist_subscribers.unsubscribed_at
          ELSE NULL
        END,
        updated_at = excluded.updated_at
      RETURNING status, confirmation_token_hash = ? AS should_send`,
      )
      .bind(
        email,
        tokenHash,
        expiresAt,
        nowIso,
        nowIso,
        cooldown,
        cooldown,
        cooldown,
        cooldown,
        tokenHash,
      )
      .first<{
        status: 'pending' | 'confirmed' | 'unsubscribed';
        should_send: 0 | 1;
      }>();

    if (!subscriber) throw new Error('D1 returned no subscriber');

    if (subscriber.status === 'pending' && subscriber.should_send === 1) {
      try {
        await emailService.send({
          ...confirmationMessage(token),
          to: email,
        });
      } catch (error) {
        await restorePreviousSubscriber(database, email, tokenHash, previous);
        throw error;
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[waitlist] signup failed:', safeErrorMetadata(err));
    return new Response(
      JSON.stringify({
        error: 'Could not start your signup. Please try again.',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
};

async function readJsonBody(
  request: Request,
): Promise<
  { ok: true; value: unknown } | { ok: false; status: 400 | 413; error: string }
> {
  const body = await readLimitedBody(request, MAX_BODY_BYTES);
  if (!body.ok) {
    return body.tooLarge
      ? { ok: false, status: 413, error: 'Request body is too large' }
      : { ok: false, status: 400, error: 'Invalid request body' };
  }

  try {
    return { ok: true, value: JSON.parse(body.text) };
  } catch {
    return { ok: false, status: 400, error: 'Invalid request body' };
  }
}

interface PreviousSubscriber {
  status: 'pending' | 'confirmed' | 'unsubscribed';
  confirmation_token_hash: string | null;
  confirmation_expires_at: string | null;
  confirmation_sent_at: string | null;
  unsubscribed_at: string | null;
  updated_at: string;
}

async function restorePreviousSubscriber(
  database: D1Database,
  email: string,
  failedTokenHash: string,
  previous: PreviousSubscriber | null,
): Promise<void> {
  const statement = previous
    ? database
        .prepare(
          `UPDATE waitlist_subscribers
            SET status = ?, confirmation_token_hash = ?,
                confirmation_expires_at = ?, confirmation_sent_at = ?,
                unsubscribed_at = ?, updated_at = ?
            WHERE email = ? AND confirmation_token_hash = ?`,
        )
        .bind(
          previous.status,
          previous.confirmation_token_hash,
          previous.confirmation_expires_at,
          previous.confirmation_sent_at,
          previous.unsubscribed_at,
          previous.updated_at,
          email,
          failedTokenHash,
        )
    : database
        .prepare(
          `DELETE FROM waitlist_subscribers
            WHERE email = ? AND confirmation_token_hash = ?`,
        )
        .bind(email, failedTokenHash);
  await statement.run().catch(() => undefined);
}

function readTurnstileToken(body: unknown): string | null {
  if (
    typeof body !== 'object' ||
    body === null ||
    !('turnstileToken' in body)
  ) {
    return null;
  }
  const token = Reflect.get(body, 'turnstileToken');
  return typeof token === 'string' && token.length <= 2048 ? token : null;
}

async function verifyTurnstile(
  token: string,
  secret: string,
  remoteIp: string | null,
): Promise<{ ok: true } | { ok: false; unavailable: boolean }> {
  try {
    const response = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret,
          response: token,
          ...(remoteIp ? { remoteip: remoteIp } : {}),
        }),
      },
    );
    if (!response.ok) return { ok: false, unavailable: true };

    const result: unknown = await response.json();
    const success = readProperty(result, 'success');
    const action = readProperty(result, 'action');
    const hostname = readProperty(result, 'hostname');
    return success === true &&
      action === TURNSTILE_ACTION &&
      typeof hostname === 'string' &&
      TURNSTILE_HOSTNAMES.has(hostname)
      ? { ok: true }
      : { ok: false, unavailable: false };
  } catch (error) {
    console.error(
      '[waitlist] Turnstile verification failed:',
      safeErrorMetadata(error),
    );
    return { ok: false, unavailable: true };
  }
}

function readProperty(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null && key in value
    ? Reflect.get(value, key)
    : undefined;
}
