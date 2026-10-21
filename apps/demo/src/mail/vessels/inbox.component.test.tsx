// @vitest-environment happy-dom

import { isErr, isOk, type Result } from '@maelstrom-co/protocol';
import type { TypedVesselProps } from '@maelstrom-co/react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { inboxVessel } from './inbox.vessel';

vi.mock('../maelstrom', () => ({ mailM: { useActions: vi.fn() } }));

const { mailM } = await import('../maelstrom');
const { __resetMailStoreForTests, getMailSnapshot } = await import(
  '../stores/mail.store'
);
const InboxComponent = (await import('./inbox.component')).default;

type InboxHandlers = {
  openEmail: (params: { subject: string }) => Promise<Result<undefined, Error>>;
};

beforeEach(() => {
  __resetMailStoreForTests();
  vi.mocked(mailM.useActions).mockClear();
});

afterEach(cleanup);

describe('InboxComponent', () => {
  it('lists every email and marks the selected one', () => {
    const { container } = render(<InboxComponent {...props()} />);
    const items = container.querySelectorAll('.mail-inbox-item');
    expect(items).toHaveLength(getMailSnapshot().emails.length);
    expect(items[0]?.getAttribute('aria-current')).toBe('true');
    expect(items[1]?.getAttribute('aria-current')).toBeNull();
  });

  it('selects an email when clicked', () => {
    const { getByText } = render(<InboxComponent {...props()} />);
    fireEvent.click(getByText('Book club moves to Thursday'));
    expect(getMailSnapshot().selectedEmailId).toBe('book-club');
  });

  it('openEmail opens a fuzzy subject match', async () => {
    render(<InboxComponent {...props()} />);
    let result: Result<undefined, Error> | undefined;
    await act(async () => {
      result = await latestHandlers().openEmail({ subject: 'sourdough' });
    });
    expect(result && isOk(result)).toBe(true);
    expect(getMailSnapshot().selectedEmailId).toBe('bakery-order');
  });

  it('openEmail moves the selection to another email', async () => {
    render(<InboxComponent {...props()} />);
    await act(async () => {
      await latestHandlers().openEmail({ subject: 'library books' });
    });
    expect(getMailSnapshot().selectedEmailId).toBe('library');
  });

  it('openEmail errs with the available subjects when nothing matches', async () => {
    render(<InboxComponent {...props()} />);
    let result: Result<undefined, Error> | undefined;
    await act(async () => {
      result = await latestHandlers().openEmail({
        subject: 'Quarterly tax filing',
      });
    });
    expect(result && isErr(result)).toBe(true);
    if (result && isErr(result)) {
      expect(result.error.message).toContain('Your sourdough order is ready');
    }
    expect(getMailSnapshot().selectedEmailId).toBe('bakery-order');
  });
});

function props(): TypedVesselProps<typeof inboxVessel> {
  return {
    instanceId: 'inbox-test',
    variantProps: {},
    executeAction: vi.fn(),
  } as unknown as TypedVesselProps<typeof inboxVessel>;
}

function latestHandlers(): InboxHandlers {
  const last = vi.mocked(mailM.useActions).mock.calls.at(-1);
  if (!last) throw new Error('mailM.useActions was not called');
  return last[2] as unknown as InboxHandlers;
}
