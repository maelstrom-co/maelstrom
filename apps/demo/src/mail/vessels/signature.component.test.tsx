// @vitest-environment happy-dom

import { isOk, type Result } from '@maelstrom-co/protocol';
import type { TypedVesselProps } from '@maelstrom-co/react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { signatureVessel } from './signature.vessel';

vi.mock('../maelstrom', () => ({ mailM: { useActions: vi.fn() } }));

const { mailM } = await import('../maelstrom');
const { __resetSettingsStoreForTests, getSettingsSnapshot } = await import(
  '../stores/settings.store'
);
const SignatureComponent = (await import('./signature.component')).default;

type ActionHandler = (
  params?: Record<string, unknown>,
) => Promise<Result<undefined, Error>>;

beforeEach(() => {
  __resetSettingsStoreForTests();
  vi.mocked(mailM.useActions).mockClear();
});

afterEach(cleanup);

describe('SignatureComponent', () => {
  it('shows the current signature', () => {
    const { getByRole } = render(<SignatureComponent {...props()} />);
    expect((getByRole('textbox') as HTMLTextAreaElement).value).toBe(
      'Sent from my Mail',
    );
  });

  it('updates the signature as the user types', () => {
    const { getByRole } = render(<SignatureComponent {...props()} />);
    fireEvent.change(getByRole('textbox'), {
      target: { value: 'Cheers, Sam' },
    });
    expect(getSettingsSnapshot().signature).toBe('Cheers, Sam');
  });

  it('setSignature replaces the signature', async () => {
    render(<SignatureComponent {...props()} />);
    const result = await runAction('setSignature', { text: 'Warmly, Alex' });
    expect(isOk(result)).toBe(true);
    expect(getSettingsSnapshot().signature).toBe('Warmly, Alex');
  });
});

function props(): TypedVesselProps<typeof signatureVessel> {
  return {
    instanceId: 'signature-test',
    variantProps: {},
    executeAction: vi.fn(),
  } as unknown as TypedVesselProps<typeof signatureVessel>;
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
