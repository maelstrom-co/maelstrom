import { describe, expect, it } from 'vitest';
import { mailVessels } from './maelstrom';

describe('mail Maelstrom instance', () => {
  it('registers exactly the ten mail vessels', () => {
    expect(mailVessels.map((entry) => entry.vessel.id)).toEqual([
      'inbox',
      'message',
      'text-size',
      'notifications',
      'theme',
      'privacy',
      'blocked-senders',
      'signature',
      'vacation-reply',
      'storage',
    ]);
  });

  it('marks every vessel except the inbox and message as a setting', () => {
    const settings = mailVessels
      .map((entry) => entry.vessel)
      .filter((definition) => definition.description.startsWith('Setting.'))
      .map((definition) => definition.id);
    expect(settings).toHaveLength(8);
    expect(settings).not.toContain('inbox');
    expect(settings).not.toContain('message');
  });
});
