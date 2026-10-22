import { describe, expect, test } from 'bun:test';
import { DISCORD_INVITE_URL } from '../data/discord-invite';
import { GET } from './discord';

describe('community entry', () => {
  test('lets invite rotation take effect without a cached permanent redirect', () => {
    const response = GET();

    expect(response.status).toBe(302);
    expect(response.headers.get('Location') === DISCORD_INVITE_URL).toBe(true);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex');
  });
});
