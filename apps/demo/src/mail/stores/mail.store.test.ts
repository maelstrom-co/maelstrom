import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetMailStoreForTests,
  emailInReader,
  getMailSnapshot,
  mailActions,
} from './mail.store';

beforeEach(__resetMailStoreForTests);

describe('mailActions.showEmailInReader', () => {
  it('opens the email whose subject matches exactly', () => {
    const opened = mailActions.showEmailInReader(
      'message-main',
      'Book club moves to Thursday',
    );
    expect(opened?.id).toBe('book-club');
    expect(emailInReader(getMailSnapshot(), 'message-main')?.id).toBe(
      'book-club',
    );
  });

  it('falls back to a fuzzy subject match', () => {
    const opened = mailActions.showEmailInReader(
      'message-main',
      'appointment reminder',
    );
    expect(opened?.id).toBe('dentist');
  });

  it('leaves the selection alone when nothing matches', () => {
    expect(
      mailActions.showEmailInReader('message-main', 'Quarterly tax filing'),
    ).toBeUndefined();
    expect(emailInReader(getMailSnapshot(), 'message-main')?.id).toBe(
      'bakery-order',
    );
  });
});
