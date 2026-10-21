// @vitest-environment happy-dom

import { isOk, type Result } from '@maelstrom-co/protocol';
import type { TypedVesselProps } from '@maelstrom-co/react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TextSize } from '../stores/settings.store';
import type { messageVessel } from './message.vessel';

vi.mock('../maelstrom', () => ({ mailM: { useActions: vi.fn() } }));

const { mailM } = await import('../maelstrom');
const { __resetMailStoreForTests } = await import('../stores/mail.store');
const { __resetSettingsStoreForTests, settingsActions } = await import(
  '../stores/settings.store'
);
const MessageComponent = (await import('./message.component')).default;

type MessageHandlers = {
  reply: () => Promise<Result<undefined, Error>> | Result<undefined, Error>;
};

beforeEach(() => {
  __resetMailStoreForTests();
  __resetSettingsStoreForTests();
  vi.mocked(mailM.useActions).mockClear();
});

afterEach(cleanup);

describe('MessageComponent', () => {
  it('shows the open email with the signature at the bottom', () => {
    const { getByText, container } = render(<MessageComponent {...props()} />);
    expect(getByText('Your sourdough order is ready')).toBeTruthy();
    expect(
      container.querySelector('.mail-message-signature')?.textContent,
    ).toBe('Sent from my Mail');
  });

  it.each<[TextSize, string]>([
    ['small', '15px'],
    ['medium', '17px'],
    ['large', '20px'],
    ['extra-large', '24px'],
  ])('maps the %s text size to a %s message font', (size, expected) => {
    settingsActions.setTextSize(size);
    const { container } = render(<MessageComponent {...props()} />);
    const body = container.querySelector('.mail-message-body') as HTMLElement;
    expect(body.style.getPropertyValue('--mail-message-font-size')).toBe(
      expected,
    );
  });

  it('reply shows that a reply was started', async () => {
    const { getByText } = render(<MessageComponent {...props()} />);
    let result: Result<undefined, Error> | undefined;
    await act(async () => {
      result = await latestHandlers().reply();
    });
    expect(result && isOk(result)).toBe(true);
    expect(getByText('Reply started')).toBeTruthy();
  });
});

function props(): TypedVesselProps<typeof messageVessel> {
  return {
    instanceId: 'message-test',
    variantProps: {},
    executeAction: vi.fn(),
  } as unknown as TypedVesselProps<typeof messageVessel>;
}

function latestHandlers(): MessageHandlers {
  const last = vi.mocked(mailM.useActions).mock.calls.at(-1);
  if (!last) throw new Error('mailM.useActions was not called');
  return last[2] as unknown as MessageHandlers;
}
