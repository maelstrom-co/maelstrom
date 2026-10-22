import { describe, expect, test } from 'bun:test';
import { COMMUNITY_DISCORD_URL } from '@maelstrom-co/platform-infra/community-contract';
import { buildWaitlistInvitationEmail } from './waitlist-invitation-email';

describe('waitlist invitation email', () => {
  test('sends confirmed subscribers to the same Discord community as the website', () => {
    const message = buildWaitlistInvitationEmail();

    expect(message.subject).toBe('Join the Maelstrom community');
    expect(message.text).toContain(COMMUNITY_DISCORD_URL);
    expect(message.html).toContain(`href="${COMMUNITY_DISCORD_URL}"`);
    expect(message.html).toContain('>Join Discord</a>');
  });

  test('uses the Cloudflare-authorized waitlist sender', () => {
    expect(buildWaitlistInvitationEmail().from).toEqual({
      email: 'waitlist@notifications.maelstrom-ai.co',
      name: 'Maelstrom',
    });
  });
});
