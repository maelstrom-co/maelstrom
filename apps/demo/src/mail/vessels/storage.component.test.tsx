// @vitest-environment happy-dom

import type { TypedVesselProps } from '@maelstrom-co/react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { storageVessel } from './storage.vessel';

vi.mock('../maelstrom', () => ({ mailM: { useActions: vi.fn() } }));

const { mailM } = await import('../maelstrom');
const { __resetSettingsStoreForTests } = await import(
  '../stores/settings.store'
);
const StorageComponent = (await import('./storage.component')).default;

beforeEach(() => {
  __resetSettingsStoreForTests();
  vi.mocked(mailM.useActions).mockClear();
});

afterEach(cleanup);

describe('StorageComponent', () => {
  it('shows used, total, and remaining storage in GB', () => {
    const { getByText } = render(<StorageComponent {...props()} />);
    expect(getByText('3.3 GB of 15 GB used')).toBeTruthy();
    expect(getByText('11.7 GB left')).toBeTruthy();
  });

  it('fills the progress bar to the share of storage used', () => {
    const { container } = render(<StorageComponent {...props()} />);
    const fill = container.querySelector('.mail-progress-fill') as HTMLElement;
    expect(Number.parseFloat(fill.style.width)).toBeCloseTo(22.27, 1);
  });

  it('registers no actions', () => {
    render(<StorageComponent {...props()} />);
    expect(mailM.useActions).not.toHaveBeenCalled();
  });
});

function props(): TypedVesselProps<typeof storageVessel> {
  return {
    instanceId: 'storage-test',
    variantProps: {},
    executeAction: vi.fn(),
  } as unknown as TypedVesselProps<typeof storageVessel>;
}
