import type { PostHog } from 'posthog-js';

let analytics: Promise<PostHog> | undefined;

export function captureCommunityInviteClick(): void {
  if (window.location.hostname !== 'demo.maelstrom-ai.co') return;

  // Load the SDK only for visitors who use the invitation, not the demo's initial bundle.
  analytics ??= import('posthog-js').then(({ PostHog }) =>
    new PostHog().init('phc_PizPfZN84s2LtKVrjT1KIejIxKRkOe22m3kaAFgVUdZ', {
      api_host: 'https://us.i.posthog.com',
      person_profiles: 'never',
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      capture_performance: false,
      capture_exceptions: false,
      disable_session_recording: true,
      disable_surveys: true,
      advanced_disable_flags: true,
    }),
  );
  void analytics
    .then((client) =>
      client.capture(
        'community_discord_invite_clicked',
        { source: 'demo_header' },
        { transport: 'sendBeacon', send_instantly: true },
      ),
    )
    .catch(() => {
      console.warn({
        message: 'community invitation click tracking unavailable',
      });
      analytics = undefined;
    });
}
