export const prerender = false;

import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { Resend } from 'resend';
import { validateWaitlistEmail } from '../../lib/waitlist';

export const POST: APIRoute = async ({ request }) => {
  const resend = new Resend(env.RESEND_API_KEY);
  const SEGMENT_ID = env.RESEND_SEGMENT_ID;
  let body: { email?: unknown };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const validation = validateWaitlistEmail(body);
  if (!validation.ok) {
    return new Response(JSON.stringify({ error: validation.error }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const email = validation.email;

  try {
    const { error } = await resend.contacts.create({ email });

    if (error) {
      console.error('[waitlist] Resend contacts.create failed:', error);
      return new Response(
        JSON.stringify({
          error: 'Could not add you to the waitlist. Please try again.',
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    if (SEGMENT_ID) {
      // Contact creation is the source of truth; segment membership is
      // best-effort, so a failed segment add must not fail the signup.
      try {
        await resend.contacts.segments.add({ email, segmentId: SEGMENT_ID });
      } catch (segmentErr) {
        console.error(
          `[waitlist] Failed to add ${email} to segment:`,
          segmentErr,
        );
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[waitlist] Unhandled error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
