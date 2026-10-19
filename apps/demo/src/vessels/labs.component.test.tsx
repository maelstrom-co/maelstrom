// @vitest-environment happy-dom

import type { EngineConnector, Orchestrator } from '@maelstrom-co/client';
import {
  ActionName,
  InstanceId,
  type MaelstromResponse,
  MessageId,
  TilingLayoutSchema,
} from '@maelstrom-co/protocol';
import { act, cleanup, render, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const captured = vi.hoisted(() => ({
  client: undefined as Orchestrator | undefined,
}));

// Replace only the demo composition (voice/services), not useActions or the client.
vi.mock('../lib/maelstrom', async () => {
  const { createMaelstrom } = await import('@maelstrom-co/react');
  const { labsEntry } = await import('./labs.vessel');
  return {
    m: createMaelstrom({ vessels: [labsEntry] }).with((context) => {
      context.onOrchestrator?.((client) => {
        captured.client = client;
        return () => {
          captured.client = undefined;
        };
      });
      return {};
    }),
  };
});
const { m } = await import('../lib/maelstrom');
const { default: LabsComponent } = await import('./labs.component');
const { getLabsSelection } = await import('./labs.store');
let network: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  network = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('No network in Labs tests'));
});
afterEach(() => {
  cleanup();
  expect(network).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

function layout(first: string, second: string, variant = 'trends') {
  return {
    type: 'tiling' as const,
    ...TilingLayoutSchema.parse({
      type: 'tiling',
      tree: ['V', `ID:${first}`, `ID:${second}`],
      instances: [
        { instanceId: first, vesselId: 'labs', variant },
        { instanceId: second, vesselId: 'labs', variant: 'trends' },
      ],
    }),
  };
}

describe('Labs actual React/client wiring', () => {
  it('applies Engine layouts before Actions, keeps instances isolated and selection across navigation/remount', async () => {
    const first = 'labs-client-first';
    const second = 'labs-client-second';
    let response: MaelstromResponse;
    const connector: EngineConnector = {
      capabilities: { voice: false, streaming: false, stateful: false },
      connect: async () => {},
      disconnect: async () => {},
      subscribe: () => () => {},
      process: async () => response,
      addAssistantMessage: async () => {},
      getHistory: async () => [],
    };
    let state: ReturnType<typeof m.useMaelstrom> | undefined;
    const errors: Error[] = [];
    function Instance({ id }: { id: string }) {
      const props = m.useVessel('labs', id);
      return (
        <section aria-label={id}>
          {props && <LabsComponent {...props} />}
        </section>
      );
    }
    function Probe({ mounted }: { mounted: boolean }) {
      state = m.useMaelstrom();
      return (
        <>
          {mounted && <Instance id={first} />}
          <Instance id={second} />
        </>
      );
    }
    function App({ mounted = true }) {
      return (
        <m.Provider
          connector={connector}
          layoutMode="tiling"
          initialLayout={layout(first, second)}
          onError={(error) => errors.push(error)}
        >
          <Probe mounted={mounted} />
        </m.Provider>
      );
    }
    const screen = render(<App />);
    await waitFor(() => expect(state?.connectionStatus).toBe('connected'), {
      timeout: 1000,
    });
    const view = (id: string) =>
      within(screen.getByRole('region', { name: id }));
    async function apply(
      variant: string,
      target: string,
      action: string,
      params?: Record<string, unknown>,
    ) {
      response = {
        type: 'maelstrom_response',
        requestId: MessageId(`labs-${action}`),
        userMessage: 'Synthetic no-data response',
        rationale: '',
        layout: layout(first, second, variant),
        executionPlan: [
          {
            instanceId: InstanceId(target),
            action: ActionName(action),
            ...(params && { params }),
          },
        ],
      };
      await act(async () => {
        await state?.processIntent('Synthetic local response');
      });
      expect(state?.lastResponse).toEqual(response);
      expect(state?.lastError).toBeNull();
    }
    await apply('trends', first, 'selectMarker', { markerSlug: 'platelets' });
    expect(view(first).getByText('Selected marker: Platelets')).toBeTruthy();
    expect(view(second).getByText('Selected marker: None')).toBeTruthy();
    await apply('list', first, 'showList');
    expect(view(first).getByText('Labs — List')).toBeTruthy();
    expect(view(first).getByText('Selected marker: Platelets')).toBeTruthy();
    await apply('trends', first, 'showTrends');
    expect(view(first).getByText('Labs — Trends')).toBeTruthy();
    await apply('trends', first, 'selectMarker', { markerSlug: 'hemoglobin' });
    await apply('trends', second, 'selectMarker', { markerSlug: 'glucose' });
    expect(view(first).getByText('Selected marker: Hemoglobin')).toBeTruthy();
    expect(view(second).getByText('Selected marker: Glucose')).toBeTruthy();
    screen.rerender(<App mounted={false} />);
    screen.rerender(<App />);
    expect(view(first).getByText('Selected marker: Hemoglobin')).toBeTruthy();
    expect(errors).toEqual([]);

    const actionErrors: (Error | undefined)[] = [];
    if (!captured.client) throw new Error('Client not mounted');
    const unsubscribe = captured.client.commandProcessor.events.on(
      'action_error',
      ({ error }) => actionErrors.push(error),
    );
    // Invalid Engine parameters reach the registered handler, not a direct store call.
    for (const params of [
      { markerSlug: 'invalid' },
      {},
      { markerSlug: 5 },
      { markerSlug: 'hemoglobin', extra: true },
    ]) {
      await apply('trends', first, 'selectMarker', params);
      expect(getLabsSelection(first)).toBe('hemoglobin');
      expect(view(first).getByText('Selected marker: Hemoglobin')).toBeTruthy();
    }
    unsubscribe();
    expect(actionErrors.map((error) => error?.message)).toEqual(
      Array(4).fill('Invalid Labs marker selection.'),
    );
    expect(errors).toEqual([]);
    for (const id of [first, second]) {
      expect(view(id).getByRole('status').textContent).toBe(
        'No lab results available',
      );
      expect(
        view(id).getByText(/No trend data or medical advice/),
      ).toBeTruthy();
      expect(screen.getByRole('region', { name: id }).textContent).not.toMatch(
        /\d|mg\/|g\/dL|normal|abnormal|diagnos/i,
      );
    }
  });
});
