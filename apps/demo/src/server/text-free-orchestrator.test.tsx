// @vitest-environment happy-dom

import { HttpConnector, Orchestrator } from '@maelstrom-co/client';
import {
  createEngine,
  createInMemoryStore,
  type Planner,
} from '@maelstrom-co/engine';
import {
  ActionName,
  EngineMessageSchema,
  InstanceId,
  ok,
  SessionId,
  VariantName,
  type VesselDefinition,
  VesselId,
} from '@maelstrom-co/protocol';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AssistantResponse } from '../components/assistant-response';

const calendar: VesselDefinition = {
  id: VesselId('calendar'),
  name: 'Calendar',
  description: 'Displays events',
  defaultVariant: VariantName('month'),
  variants: {
    [VariantName('month')]: {
      props: {},
      minSize: { width: 4, height: 4 },
      actions: [
        {
          name: ActionName('configure'),
          description: 'Configure the new calendar',
          idempotent: false,
        },
      ],
    },
  },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('text-free strict planner transport integration', () => {
  it('applies a new-instance layout before its action, settles, and leaves presentation to the structural voice summary', async () => {
    const planner: Planner = {
      id: 'text-free-integration',
      supportedLayoutModes: ['tiling'],
      async invoke({ context }) {
        expect(
          context.calls.claim({
            plannerId: 'text-free-integration',
            stage: 'test',
          }).ok,
        ).toBe(true);
        return ok({
          kind: 'candidate' as const,
          candidate: {
            layout: {
              type: 'tiling',
              tree: ['ID:calendar-next'],
              instances: [
                {
                  instanceId: 'calendar-next',
                  vesselId: 'calendar',
                  variant: 'month',
                },
              ],
            },
            executionPlan: [
              { instanceId: 'calendar-next', action: 'configure' },
            ],
          },
        });
      },
    };
    const engine = createEngine({
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
      planner: {
        primary: {
          implementation: planner,
          finalization: 'strict',
          maxRepairAttempts: 0,
        },
        operation: { timeoutMs: null, maxProviderCalls: 1 },
      },
      history: { store: createInMemoryStore() },
    });
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      const parsed = EngineMessageSchema.parse(JSON.parse(String(init?.body)));
      const result = await engine.handle(parsed);
      if (!result.ok || result.value.type !== 'chart_response') {
        throw new Error('expected strict planner chart response');
      }
      return new Response(JSON.stringify(result.value.response));
    });

    const orchestrator = new Orchestrator(
      new HttpConnector({ baseUrl: 'https://engine.test' }),
      { sessionId: SessionId('text-free-transport'), vessels: [calendar] },
    );
    const instanceId = InstanceId('calendar-next');
    const commandOrder: string[] = [];
    let actionSawNewInstance = false;
    let settled = false;
    orchestrator.commandProcessor.events.on('command_start', ({ command }) => {
      commandOrder.push(command.kind);
    });
    orchestrator.commandProcessor.registerRunner(instanceId, {
      configure: () => {
        actionSawNewInstance =
          orchestrator.commandProcessor.store.state.instances.has(instanceId);
        return ok(undefined);
      },
    });
    orchestrator.onSettled(() => {
      settled =
        orchestrator.commandProcessor.store.state.status === 'idle' &&
        !orchestrator.getViewState().isProcessing;
    });

    const response = await orchestrator.processIntent('Add my next calendar');
    await orchestrator.commandProcessor.waitForIdle();

    expect(response.userMessage).toBeUndefined();
    expect(response.rationale).toBeUndefined();
    expect(commandOrder).toEqual(['set_layout', 'execute_actions']);
    expect(actionSawNewInstance).toBe(true);
    expect(settled).toBe(true);
    expect(
      render(
        <AssistantResponse
          isProcessing={false}
          message={response.userMessage}
          voiceActive={false}
        />,
      ).container.firstChild,
    ).toBeNull();

    await orchestrator.dispose();
  });
});
