// @vitest-environment happy-dom

import { isOk, type Result } from '@maelstrom-co/protocol';
import type { TypedVesselProps } from '@maelstrom-co/react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { privacyVessel } from './privacy.vessel';

vi.mock('../maelstrom', () => ({ mailM: { useActions: vi.fn() } }));

const { mailM } = await import('../maelstrom');
const { __resetSettingsStoreForTests, getSettingsSnapshot } = await import(
  '../stores/settings.store'
);
const PrivacyComponent = (await import('./privacy.component')).default;

type ActionHandler = (
  params?: Record<string, unknown>,
) => Promise<Result<undefined, Error>>;

beforeEach(() => {
  __resetSettingsStoreForTests();
  vi.mocked(mailM.useActions).mockClear();
});

afterEach(cleanup);

describe('PrivacyComponent', () => {
  it('setReadReceipts turns read receipts off', async () => {
    render(<PrivacyComponent {...props()} />);
    expect(isOk(await runAction('setReadReceipts', { on: false }))).toBe(true);
    expect(getSettingsSnapshot().readReceipts).toBe(false);
  });

  it('setRemoteImages turns automatic pictures off', async () => {
    render(<PrivacyComponent {...props()} />);
    expect(isOk(await runAction('setRemoteImages', { on: false }))).toBe(true);
    expect(getSettingsSnapshot().remoteImages).toBe(false);
  });

  it('flips read receipts when its switch is clicked', () => {
    const { getByRole } = render(<PrivacyComponent {...props()} />);
    fireEvent.click(getByRole('switch', { name: 'Read receipts' }));
    expect(getSettingsSnapshot().readReceipts).toBe(false);
  });
});

function props(): TypedVesselProps<typeof privacyVessel> {
  return {
    instanceId: 'privacy-test',
    variantProps: {},
    executeAction: vi.fn(),
  } as unknown as TypedVesselProps<typeof privacyVessel>;
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
