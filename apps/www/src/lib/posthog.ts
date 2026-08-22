type WaitlistPostHogEvent =
  | 'waitlist_submission_accepted'
  | 'waitlist_confirmation_page_viewed'
  | 'waitlist_discord_invite_clicked';

export function captureWaitlistEvent(
  event: WaitlistPostHogEvent,
  properties?: Record<string, string>,
): void {
  const { posthog } = window as typeof window & {
    posthog?: {
      capture?: (event: string, properties?: Record<string, string>) => void;
    };
  };
  posthog?.capture?.(event, properties);
}
