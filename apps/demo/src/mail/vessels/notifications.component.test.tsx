// @vitest-environment happy-dom

import { isOk, type Result } from '@maelstrom-co/protocol';
import type { TypedVesselProps } from '@maelstrom-co/react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { notificationsVessel } from './notifications.vessel';

vi.mock('../maelstrom', () => ({ mailM: { useActions: vi.fn() } }));

const { mailM } = await import('../maelstrom');
const { __resetSettingsStoreForTests, getSettingsSnapshot } = await import(
  '../stores/settings.store'
);
const NotificationsComponent = (await import('./notifications.component'))
  .default;

type ActionHandler = (
  params?: Record<string, unknown>,
) => Promise<Result<undefined, Error>>;

beforeEach(() => {
  __resetSettingsStoreForTests();
  vi.mocked(mailM.useActions).mockClear();
});

afterEach(cleanup);

describe('NotificationsComponent', () => {
  it('setEmailNotifications turns alerts off and on', async () => {
    render(<NotificationsComponent {...props()} />);
    expect(isOk(await runAction('setEmailNotifications', { on: false }))).toBe(
      true,
    );
    expect(getSettingsSnapshot().notificationsOn).toBe(false);
    await runAction('setEmailNotifications', { on: true });
    expect(getSettingsSnapshot().notificationsOn).toBe(true);
  });

  it('setSound turns the sound off', async () => {
    render(<NotificationsComponent {...props()} />);
    expect(isOk(await runAction('setSound', { on: false }))).toBe(true);
    expect(getSettingsSnapshot().soundOn).toBe(false);
  });

  it('flips a setting when its switch is clicked', () => {
    const { getByRole } = render(<NotificationsComponent {...props()} />);
    fireEvent.click(getByRole('switch', { name: 'Sound' }));
    expect(getSettingsSnapshot().soundOn).toBe(false);
  });
});

function props(): TypedVesselProps<typeof notificationsVessel> {
  return {
    instanceId: 'notifications-test',
    variantProps: {},
    executeAction: vi.fn(),
  } as unknown as TypedVesselProps<typeof notificationsVessel>;
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
