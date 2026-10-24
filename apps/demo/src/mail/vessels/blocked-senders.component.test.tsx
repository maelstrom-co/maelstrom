// @vitest-environment happy-dom

import { isErr, isOk, type Result } from '@maelstrom-co/protocol';
import type { TypedVesselProps } from '@maelstrom-co/react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { blockedSendersVessel } from './blocked-senders.vessel';

vi.mock('../maelstrom', () => ({ mailM: { useActions: vi.fn() } }));

const { mailM } = await import('../maelstrom');
const { __resetSettingsStoreForTests, getSettingsSnapshot } = await import(
  '../stores/settings.store'
);
const BlockedSendersComponent = (await import('./blocked-senders.component'))
  .default;

type ActionHandler = (
  params?: Record<string, unknown>,
) => Promise<Result<undefined, Error>>;

beforeEach(() => {
  __resetSettingsStoreForTests();
  vi.mocked(mailM.useActions).mockClear();
});

afterEach(cleanup);

describe('BlockedSendersComponent', () => {
  it('lists the blocked addresses', () => {
    const { getByText } = render(<BlockedSendersComponent {...props()} />);
    expect(getByText('prizes@win-a-cruise.example')).toBeTruthy();
  });

  it('unblocks an address when its button is clicked', () => {
    const { getAllByRole } = render(<BlockedSendersComponent {...props()} />);
    fireEvent.click(
      getAllByRole('button', { name: 'Unblock' })[0] as HTMLElement,
    );
    expect(getSettingsSnapshot().blockedSenders).not.toContain(
      'prizes@win-a-cruise.example',
    );
  });

  it('blockSender adds the address', async () => {
    render(<BlockedSendersComponent {...props()} />);
    const result = await runAction('blockSender', {
      email: 'Spam@Example.com',
    });
    expect(isOk(result)).toBe(true);
    expect(getSettingsSnapshot().blockedSenders).toContain('spam@example.com');
  });

  it('blockSender errs on an empty address', async () => {
    render(<BlockedSendersComponent {...props()} />);
    expect(isErr(await runAction('blockSender', { email: '  ' }))).toBe(true);
  });

  it('unblockSender removes a blocked address', async () => {
    render(<BlockedSendersComponent {...props()} />);
    const result = await runAction('unblockSender', {
      email: 'deals@cheap-pills.example',
    });
    expect(isOk(result)).toBe(true);
    expect(getSettingsSnapshot().blockedSenders).not.toContain(
      'deals@cheap-pills.example',
    );
  });

  it('unblockSender errs and lists the blocked addresses when not blocked', async () => {
    render(<BlockedSendersComponent {...props()} />);
    const result = await runAction('unblockSender', {
      email: 'friend@example.com',
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('prizes@win-a-cruise.example');
    }
  });
});

function props(): TypedVesselProps<typeof blockedSendersVessel> {
  return {
    instanceId: 'blocked-senders-test',
    variantProps: {},
    executeAction: vi.fn(),
  } as unknown as TypedVesselProps<typeof blockedSendersVessel>;
}

async function runAction(
  name: string,
  params?: Record<string, unknown>,
): Promise<Result<undefined, Error>> {
  const last = vi.mocked(mailM.useActions).mock.calls.at(-1);
  if (!last) throw new Error('mailM.useActions was not called');
  const handler = (last[2] as unknown as Record<string, ActionHandler>)[name];
  if (!handler) throw new Error(`No handler named ${name}`);
  let result: Result<undefined, Error> | undefined;
  await act(async () => {
    result = await handler(params);
  });
  if (!result) throw new Error(`${name} returned nothing`);
  return result;
}
