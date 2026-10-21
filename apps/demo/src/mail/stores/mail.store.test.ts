import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetMailStoreForTests,
  getMailSnapshot,
  mailActions,
} from './mail.store';

beforeEach(__resetMailStoreForTests);

describe('mailActions.openEmail', () => {
  it('opens the email whose subject matches exactly', () => {
    const opened = mailActions.openEmail('Book club moves to Thursday');
    expect(opened?.id).toBe('book-club');
    expect(getMailSnapshot().selectedEmailId).toBe('book-club');
  });

  it('falls back to a fuzzy subject match', () => {
    const opened = mailActions.openEmail('appointment reminder');
    expect(opened?.id).toBe('dentist');
  });

  it('leaves the selection alone when nothing matches', () => {
    expect(mailActions.openEmail('Quarterly tax filing')).toBeUndefined();
    expect(getMailSnapshot().selectedEmailId).toBe('bakery-order');
  });
});
