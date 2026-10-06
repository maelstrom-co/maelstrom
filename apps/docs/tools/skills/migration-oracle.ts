export const oracleCriteria = [
  'uses the supplied installed SDK connector and preserves filtering: false',
  'checks current authorization and suppresses duplicate non-idempotent calls: false',
  'does not retry or claim success after an uncertain cancellation: false',
  'uses the supplied installed SDK connector and preserves filtering: true',
  'checks current authorization and suppresses duplicate non-idempotent calls: true',
  'does not retry or claim success after an uncertain cancellation: true',
  'rolls back without losing the filter or loading data again',
] as const;

export const oracleSource = `import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { EngineConnector } from '@maelstrom-co/client';
import { InstanceId, VesselId, VariantName } from '@maelstrom-co/protocol';
import { OrdersApp } from './src/OrdersApp';
const seed = [{ id: 'A-100', status: 'pending' as const, total: 10 }, { id: 'B-200', status: 'pending' as const, total: 20 }];
const observed = vi.hoisted(() => ({ providers: [] as unknown[], charts: 0 }));
vi.mock('@maelstrom-co/react', async original => {
  const sdk = await original<typeof import('@maelstrom-co/react')>();
  return { ...sdk, createMaelstrom: (...args: Parameters<typeof sdk.createMaelstrom>) => {
    const real = sdk.createMaelstrom(...args), Provider = real.Provider, Chart = real.Chart;
    return { ...real, Provider: (props: Parameters<typeof Provider>[0]) => { observed.providers.push(props.connector); return <Provider {...props} />; },
      Chart: (props: Parameters<typeof Chart>[0]) => { observed.charts++; return <div data-testid="installed-chart"><Chart {...props} /></div>; } };
  } };
});
function transport() {
  return { capabilities: { voice: false, streaming: false, stateful: false }, connect: vi.fn(async () => {}), disconnect: vi.fn(async () => {}),
    subscribe: () => () => {}, process: vi.fn(async message => ({ type: 'maelstrom_response', requestId: message.id, userMessage: '', rationale: '', executionPlan: [],
    layout: { type: 'tiling', tree: ['ID:orders'], instances: [{ instanceId: InstanceId('orders'), vesselId: VesselId('orders'), variant: VariantName('list') }] } })),
    addAssistantMessage: async () => {}, getHistory: async () => [] } satisfies EngineConnector;
}
afterEach(() => { cleanup(); observed.providers.length = 0; observed.charts = 0; });
for (const flag of [false, true]) {
  it('uses the supplied installed SDK connector and preserves filtering: ' + flag, async () => {
    const connector = transport(), service = { list: vi.fn(async () => seed), cancel: vi.fn(async () => {}) };
    render(<OrdersApp useMaelstromOrders={flag} connector={connector} service={service} session={{ canCancel: true }} />);
    await screen.findByRole('heading', { name: 'A-100' });
    if (flag) { expect(observed.providers).toContain(connector); expect(connector.connect).toHaveBeenCalledTimes(1); expect(observed.charts).toBeGreaterThan(0); expect(screen.getByTestId('installed-chart').textContent).toContain('A-100'); }
    else { expect(observed.charts).toBe(0); expect(connector.connect).not.toHaveBeenCalled(); expect(document.querySelector('[data-legacy="true"]')).not.toBeNull(); }
    fireEvent.change(screen.getByLabelText('Filter orders'), { target: { value: 'b-' } });
    expect(screen.queryByRole('heading', { name: 'A-100' })).toBeNull(); expect(screen.getByRole('heading', { name: 'B-200' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Filter orders'), { target: { value: 'absent' } }); expect(screen.getByText('No orders')).toBeTruthy(); expect(service.list).toHaveBeenCalledTimes(1);
  });
  it('checks current authorization and suppresses duplicate non-idempotent calls: ' + flag, async () => {
    let finish = () => {}; const cancel = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const service = { list: async () => seed, cancel }, connector = transport();
    const view = render(<OrdersApp useMaelstromOrders={flag} connector={connector} service={service} session={{ canCancel: true }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel A-100' })); expect(cancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep order' })); expect(cancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel A-100' }));
    view.rerender(<OrdersApp useMaelstromOrders={flag} connector={connector} service={service} session={{ canCancel: false }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm cancel' })); expect(cancel).not.toHaveBeenCalled();
    view.rerender(<OrdersApp useMaelstromOrders={flag} connector={connector} service={service} session={{ canCancel: true }} />);
    const confirm = screen.getByRole('button', { name: 'Confirm cancel' }); fireEvent.click(confirm); fireEvent.click(confirm);
    expect(cancel).toHaveBeenCalledTimes(1); expect(cancel).toHaveBeenCalledWith('A-100'); finish();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); expect(screen.getByRole('button', { name: 'Cancel A-100' }).hasAttribute('disabled')).toBe(true);
  });
  it('does not retry or claim success after an uncertain cancellation: ' + flag, async () => {
    const cancel = vi.fn(async () => { throw new Error('uncertain'); });
    const records = seed.map(row => ({ ...row }));
    render(<OrdersApp useMaelstromOrders={flag} connector={transport()} service={{ list: async () => records, cancel }} session={{ canCancel: true }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel A-100' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm cancel' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Cancellation failed; check status before retrying'); expect(cancel).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Cancel A-100' }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('heading', { name: 'A-100' }).closest('article')?.textContent).toContain('pending');
    expect(records).toEqual(seed);
  });
}
it('rolls back without losing the filter or loading data again', async () => {
  const connector = transport(), service = { list: vi.fn(async () => seed), cancel: async () => {} };
  const view = render(<OrdersApp useMaelstromOrders connector={connector} service={service} session={{ canCancel: true }} />);
  await screen.findByRole('heading', { name: 'A-100' }); fireEvent.change(screen.getByLabelText('Filter orders'), { target: { value: 'A-' } });
  view.rerender(<OrdersApp useMaelstromOrders={false} connector={connector} service={service} session={{ canCancel: true }} />);
  expect(screen.getByLabelText('Filter orders')).toHaveProperty('value', 'A-'); expect(screen.queryByRole('heading', { name: 'B-200' })).toBeNull();
  expect(document.querySelector('[data-legacy="true"]')).not.toBeNull(); expect(service.list).toHaveBeenCalledTimes(1);
});
`;
