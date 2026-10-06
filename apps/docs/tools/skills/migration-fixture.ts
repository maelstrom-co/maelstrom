export const ordersSource = `export interface Order { id: string; status: 'pending' | 'cancelled'; total: number }
export interface OrdersService { list(): Promise<Order[]>; cancel(id: string): Promise<void> }
export interface Session { canCancel: boolean }
export const seed: Order[] = [{ id: 'A-100', status: 'pending', total: 10 }, { id: 'B-200', status: 'pending', total: 20 }];
`;

const state = `
  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  useEffect(() => {
    let live = true;
    service.list().then(rows => { if (live) setOrders(rows); });
    return () => { live = false; };
  }, [service]);
  async function confirm() {
    if (!pending || !session.canCancel || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      await service.cancel(pending);
      setOrders(rows => rows.map(row => row.id === pending ? { ...row, status: 'cancelled' } : row));
      setPending(null);
    } catch { setError('Cancellation failed; check status before retrying'); setPending(null); }
    finally { lock.current = false; setBusy(false); }
  }
  const results = <section aria-label="Order results" data-legacy="true">
    {orders.filter(row => row.id.toLowerCase().includes(filter.toLowerCase())).map(row =>
      <article key={row.id}><h2>{row.id}</h2><p>{row.status}: {row.total}</p>
      <button type="button" disabled={!session.canCancel || busy || row.status !== 'pending'} onClick={() => setPending(row.id)}>Cancel {row.id}</button></article>)}
    {!orders.some(row => row.id.toLowerCase().includes(filter.toLowerCase())) && <p>No orders</p>}
  </section>;
`;
const shell = (
  results: string,
) => `return <main><h1>Orders</h1><label>Filter orders<input value={filter} onChange={event => setFilter(event.target.value)} /></label>
  ${results}
  {error && <p role="alert">{error}</p>}
  {pending && <section role="dialog" aria-label="Confirm cancellation"><button type="button" disabled={busy} onClick={() => void confirm()}>Confirm cancel</button><button type="button" disabled={busy} onClick={() => setPending(null)}>Keep order</button></section>}
  </main>;`;
const imports = `import type { EngineConnector } from '@maelstrom-co/client';
import { useEffect, useRef, useState } from 'react';
import type { Order, OrdersService, Session } from './orders';
export interface OrdersAppProps { useMaelstromOrders: boolean; connector: EngineConnector; service: OrdersService; session: Session }
`;

export const negativeApp = `${imports}
export function OrdersApp({ service, session }: OrdersAppProps) {${state}${shell('{results}')}}
`;

export const positiveApp = `${imports}
import { InstanceId, VesselId, VariantName } from '@maelstrom-co/protocol';
import { createMaelstrom, defineVessel, vessel } from '@maelstrom-co/react';
import { createContext, useContext } from 'react';
const Results = createContext<React.ReactNode>(null);
const definition = defineVessel({ id: 'orders', name: 'Orders', description: 'Order results', defaultVariant: 'list', variants: { list: { props: {}, minSize: { width: 1, height: 1 }, actions: [] } } });
const sdk = createMaelstrom({ vessels: [vessel(definition, () => useContext(Results))] });
const initialLayout = { type: 'tiling' as const, tree: ['ID:orders'] as const, instances: [{ instanceId: InstanceId('orders'), vesselId: VesselId('orders'), variant: VariantName('list') }] };
export function OrdersApp({ service, session, connector, useMaelstromOrders }: OrdersAppProps) {${state}${shell('{useMaelstromOrders ? <Results.Provider value={results}><sdk.Provider connector={connector} initialLayout={initialLayout}><sdk.Chart /></sdk.Provider></Results.Provider> : results}')}}
`;

export const prompt = `Migrate the order results to the installed Maelstrom React SDK behind useMaelstromOrders. Use the supplied connector. Keep the legacy path when the flag is false, including runtime rollback. Preserve filtering, one data load, current authorization at confirmation, cancellation confirmation, exactly one non-idempotent mutation per confirmation, and failure feedback without automatic retry. Keep public props and all existing tests, configuration, assets, manifests and installed dependencies unchanged. Add regression tests. Change only src files. Verify typecheck, lint, and tests.\n`;

export const setupSource = `import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'getComputedStyle']) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
class ResizeObserver { observe() {} unobserve() {} disconnect() {} }
globalThis.ResizeObserver = ResizeObserver;
`;

export const originalTest = `import { expect, it } from 'vitest';
import { seed } from './orders';
it('the legacy seed keeps two distinct order identities', () => { expect(seed.map(row => row.id)).toEqual(['A-100', 'B-200']); });
`;
