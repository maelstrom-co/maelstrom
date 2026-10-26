// @vitest-environment happy-dom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const enqueueIntent = vi.fn();

vi.mock('../maelstrom', () => ({
  mailM: {
    useMaelstrom: (select: (state: { enqueueIntent: unknown }) => unknown) =>
      select({ enqueueIntent }),
  },
}));

const { __resetMailStoreForTests, getMailSnapshot, mailActions } = await import(
  '../stores/mail.store'
);
const InboxComponent = (await import('./inbox.component')).default;

beforeEach(() => {
  __resetMailStoreForTests();
  enqueueIntent.mockClear();
});

afterEach(cleanup);

describe('InboxComponent', () => {
  it('lists every email and marks the one open in a reader', () => {
    mailActions.readerMounted('message-main');
    const { container } = render(<InboxComponent />);
    const items = container.querySelectorAll('.mail-inbox-item');
    expect(items).toHaveLength(getMailSnapshot().emails.length);
    expect(items[0]?.getAttribute('aria-current')).toBe('true');
    expect(items[1]?.getAttribute('aria-current')).toBeNull();
  });

  it('asks Maelstrom to open an email when clicked', () => {
    const { getByText } = render(<InboxComponent />);
    fireEvent.click(getByText('Book club moves to Thursday'));
    expect(enqueueIntent).toHaveBeenCalledWith(
      expect.stringContaining('Book club moves to Thursday'),
    );
  });
});
