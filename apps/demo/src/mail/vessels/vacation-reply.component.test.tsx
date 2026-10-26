// @vitest-environment happy-dom

import { isOk, type Result } from '@maelstrom-co/protocol';
import type { TypedVesselProps } from '@maelstrom-co/react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { vacationReplyVessel } from './vacation-reply.vessel';

vi.mock('../maelstrom', () => ({ mailM: { useActions: vi.fn() } }));

const { mailM } = await import('../maelstrom');
const { __resetSettingsStoreForTests, getSettingsSnapshot } = await import(
  '../stores/settings.store'
);
const VacationReplyComponent = (await import('./vacation-reply.component'))
  .default;

type ActionHandler = (
  params?: Record<string, unknown>,
) => Promise<Result<undefined, Error>>;

beforeEach(() => {
  __resetSettingsStoreForTests();
  vi.mocked(mailM.useActions).mockClear();
});

afterEach(cleanup);

describe('VacationReplyComponent', () => {
  it('setVacationReply turns the reply on with a new message', async () => {
    render(<VacationReplyComponent {...props()} />);
    const result = await runAction('setVacationReply', {
      on: true,
      message: 'At the beach until Monday',
    });
    expect(isOk(result)).toBe(true);
    expect(getSettingsSnapshot().vacationReply).toEqual({
      on: true,
      message: 'At the beach until Monday',
    });
  });

  it('setVacationReply keeps the message when none is given', async () => {
    render(<VacationReplyComponent {...props()} />);
    const before = getSettingsSnapshot().vacationReply.message;
    await runAction('setVacationReply', { on: true });
    expect(getSettingsSnapshot().vacationReply).toEqual({
      on: true,
      message: before,
    });
  });

  it('turns the reply on when the switch is clicked', () => {
    const { getByRole } = render(<VacationReplyComponent {...props()} />);
    fireEvent.click(getByRole('switch', { name: 'Reply while I am away' }));
    expect(getSettingsSnapshot().vacationReply.on).toBe(true);
  });
});

function props(): TypedVesselProps<typeof vacationReplyVessel> {
  return {
    instanceId: 'vacation-reply-test',
    variantProps: {},
    executeAction: vi.fn(),
  } as unknown as TypedVesselProps<typeof vacationReplyVessel>;
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
