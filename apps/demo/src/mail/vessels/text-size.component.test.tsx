// @vitest-environment happy-dom

import { isErr, isOk, type Result } from '@maelstrom-co/protocol';
import type { TypedVesselProps } from '@maelstrom-co/react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { textSizeVessel } from './text-size.vessel';

vi.mock('../maelstrom', () => ({ mailM: { useActions: vi.fn() } }));

const { mailM } = await import('../maelstrom');
const { __resetSettingsStoreForTests, getSettingsSnapshot } = await import(
  '../stores/settings.store'
);
const TextSizeComponent = (await import('./text-size.component')).default;

type ActionHandler = (
  params?: Record<string, unknown>,
) => Promise<Result<undefined, Error>>;

beforeEach(() => {
  __resetSettingsStoreForTests();
  vi.mocked(mailM.useActions).mockClear();
});

afterEach(cleanup);

describe('TextSizeComponent', () => {
  it('shows the current size in plain words', () => {
    const { getByText } = render(<TextSizeComponent {...props()} />);
    expect(getByText('Medium')).toBeTruthy();
  });

  it('updates the size live when the slider moves', () => {
    const { getByRole } = render(<TextSizeComponent {...props()} />);
    fireEvent.change(getByRole('slider'), { target: { value: '3' } });
    expect(getSettingsSnapshot().textSize).toBe('extra-large');
  });

  it('setTextSize sets the requested size', async () => {
    render(<TextSizeComponent {...props()} />);
    const result = await runAction('setTextSize', { size: 'large' });
    expect(isOk(result)).toBe(true);
    expect(getSettingsSnapshot().textSize).toBe('large');
  });

  it('setTextSize errs on an unknown size', async () => {
    render(<TextSizeComponent {...props()} />);
    const result = await runAction('setTextSize', { size: 'huge' });
    expect(isErr(result)).toBe(true);
    expect(getSettingsSnapshot().textSize).toBe('medium');
  });

  it('adjustTextSize steps bigger and smaller', async () => {
    render(<TextSizeComponent {...props()} />);
    expect(
      isOk(await runAction('adjustTextSize', { direction: 'bigger' })),
    ).toBe(true);
    expect(getSettingsSnapshot().textSize).toBe('large');
    await runAction('adjustTextSize', { direction: 'smaller' });
    await runAction('adjustTextSize', { direction: 'smaller' });
    expect(getSettingsSnapshot().textSize).toBe('small');
  });

  it('adjustTextSize stops at both ends', async () => {
    render(<TextSizeComponent {...props()} />);
    for (let step = 0; step < 5; step++) {
      await runAction('adjustTextSize', { direction: 'bigger' });
    }
    expect(getSettingsSnapshot().textSize).toBe('extra-large');
    for (let step = 0; step < 5; step++) {
      await runAction('adjustTextSize', { direction: 'smaller' });
    }
    expect(getSettingsSnapshot().textSize).toBe('small');
  });

  it('adjustTextSize errs on an unknown direction', async () => {
    render(<TextSizeComponent {...props()} />);
    const result = await runAction('adjustTextSize', { direction: 'sideways' });
    expect(isErr(result)).toBe(true);
  });
});

function props(): TypedVesselProps<typeof textSizeVessel> {
  return {
    instanceId: 'text-size-test',
    variantProps: {},
    executeAction: vi.fn(),
  } as unknown as TypedVesselProps<typeof textSizeVessel>;
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
