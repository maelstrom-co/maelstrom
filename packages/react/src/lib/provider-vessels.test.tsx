import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import type { VesselDefinition } from '@maelstrom-co/protocol';
import { act, cleanup, render } from '@testing-library/react';
import { createMockConnector } from './__tests__/mock-connector.js';
import { testVessel } from './__tests__/test-vessel.fixture.js';
import { createMaelstromContext } from './context.js';
import { createProvider } from './provider.js';
import { vessel } from './vessel.js';

// TS-legal (VesselDefinition's fields are plain strings/records) but rejected
// by VesselSchema's runtime refine: `variants: {}` fails "must have at least
// one variant". Same shape the client package's own regression test uses.
const brokenVessel: VesselDefinition = {
  id: 'broken',
  name: 'Broken',
  description: 'a vessel with no variants',
  defaultVariant: 'x',
  variants: {},
};

const validEntry = vessel(testVessel, () => null);
const brokenEntry = vessel(brokenVessel, () => null);

afterEach(() => cleanup());

describe('Provider vessels — invalid vessel resilience', () => {
  // A vessel definition that fails schema validation must be skipped and
  // logged, not abort Orchestrator construction — a construction failure
  // collapses the whole subtree, since the Provider renders null when
  // `orchestrator` is null.
  it('still renders children when one of the static vessels is invalid', async () => {
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    const contextPair = createMaelstromContext();
    const Provider = createProvider(contextPair, [brokenEntry, validEntry], {});
    const connector = createMockConnector();

    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <Provider connector={connector}>
          <div>alive</div>
        </Provider>,
      ));
    });

    expect(container.innerHTML).toContain('alive');

    const orchestrator = contextPair.contextRef.current?.orchestrator;
    expect(orchestrator).toBeDefined();
    expect(orchestrator?.vesselManager.has('broken')).toBe(false);
    expect(orchestrator?.vesselManager.has('orders')).toBe(true);

    // With the throw gone, this log IS the contract: it is the only way a
    // developer learns their vessel silently vanished, so assert it named the
    // vessel and said why — not merely that something logged.
    const brokenReports = errorSpy.mock.calls.filter((args) =>
      args.some((a) => typeof a === 'string' && a.includes('"broken"')),
    );
    expect(brokenReports).toHaveLength(1);
    expect(JSON.stringify(brokenReports[0])).toContain('at least one variant');

    errorSpy.mockRestore();
  });
});
