type WebsiteEvent =
  | 'get_started_clicked'
  | 'setup_copied'
  | 'playground_opened'
  | 'community_discord_invite_clicked'
  | 'waitlist_submission_accepted'
  | 'waitlist_confirmation_page_viewed'
  | 'waitlist_discord_invite_clicked';

export function captureWebsiteEvent(
  event: WebsiteEvent,
  properties?: Record<string, string>,
): void {
  const { posthog } = window as typeof window & {
    posthog?: {
      capture?: (
        event: string,
        properties?: Record<string, string>,
        options?: { transport: 'sendBeacon'; send_instantly: boolean },
      ) => void;
    };
  };
  try {
    posthog?.capture?.(event, properties, {
      transport: 'sendBeacon',
      send_instantly: true,
    });
  } catch {
    console.warn('[website_analytics_failed]', event);
  }
}
