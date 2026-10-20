import { describe, expect, test } from 'bun:test';
import { WAITLIST_DISCORD_INVITE_URL } from '@maelstrom-co/platform-infra/waitlist-contract';
import { buildWaitlistInvitationEmail } from './waitlist-invitation-email';

describe('waitlist invitation email', () => {
  test('sends confirmed subscribers to the same Discord community as the website', () => {
    const message = buildWaitlistInvitationEmail();

    expect(message.subject).toBe('Join the Maelstrom community');
    expect(message.text).toContain(WAITLIST_DISCORD_INVITE_URL);
    expect(message.html).toContain(`href="${WAITLIST_DISCORD_INVITE_URL}"`);
    expect(message.html).toContain('>Join Discord</a>');
  });

  test('uses the Cloudflare-authorized waitlist sender', () => {
    expect(buildWaitlistInvitationEmail().from).toEqual({
      email: 'waitlist@notifications.maelstrom-ai.co',
      name: 'Maelstrom',
    });
  });
});
