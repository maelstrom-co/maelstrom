import type { APIRoute } from 'astro';
import { DISCORD_INVITE_URL } from '../data/discord-invite';

export const prerender = false;

export const GET = (() =>
  new Response(null, {
    status: 302,
    headers: {
      Location: DISCORD_INVITE_URL,
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  })) satisfies APIRoute;
