// @vitest-environment happy-dom

import { isErr, isOk, type Result } from '@maelstrom-co/protocol';
import type { TypedVesselProps } from '@maelstrom-co/react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { themeVessel } from './theme.vessel';

vi.mock('../maelstrom', () => ({ mailM: { useActions: vi.fn() } }));

const { mailM } = await import('../maelstrom');
const { __resetSettingsStoreForTests, getSettingsSnapshot } = await import(
  '../stores/settings.store'
);
const ThemeComponent = (await import('./theme.component')).default;

type ActionHandler = (
  params?: Record<string, unknown>,
) => Promise<Result<undefined, Error>>;

beforeEach(() => {
  __resetSettingsStoreForTests();
  vi.mocked(mailM.useActions).mockClear();
});

afterEach(cleanup);

describe('ThemeComponent', () => {
  it('marks the current theme as pressed', () => {
    const { getByRole } = render(<ThemeComponent {...props()} />);
    expect(
      getByRole('button', { name: 'Light' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('switches theme when a segment is clicked', () => {
    const { getByRole } = render(<ThemeComponent {...props()} />);
    fireEvent.click(getByRole('button', { name: 'Sepia' }));
    expect(getSettingsSnapshot().theme).toBe('sepia');
  });

  it('setTheme sets the requested theme', async () => {
    render(<ThemeComponent {...props()} />);
    const result = await runAction('setTheme', { theme: 'dark' });
    expect(isOk(result)).toBe(true);
    expect(getSettingsSnapshot().theme).toBe('dark');
  });

  it('setTheme errs on an unknown theme', async () => {
    render(<ThemeComponent {...props()} />);
    const result = await runAction('setTheme', { theme: 'neon' });
    expect(isErr(result)).toBe(true);
    expect(getSettingsSnapshot().theme).toBe('light');
  });
});

function props(): TypedVesselProps<typeof themeVessel> {
  return {
    instanceId: 'theme-test',
    variantProps: {},
    executeAction: vi.fn(),
  } as unknown as TypedVesselProps<typeof themeVessel>;
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
