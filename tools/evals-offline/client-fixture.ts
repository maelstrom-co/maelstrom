import { spyOn } from 'bun:test';
import {
  type EngineConnector,
  Orchestrator,
} from '../../packages/client/src/index.js';
import type {
  EvaluationAdapter,
  Verdict,
} from '../../packages/evals/src/core/runtime/evaluate.js';
import {
  ActionName,
  defineVessel,
  InstanceId,
  type MaelstromResponse,
  ok,
  VariantName,
  VesselId,
} from '../../packages/protocol/src/index.js';

interface Effect {
  readonly action: string;
  readonly exists: boolean;
  readonly variant?: string;
}
interface ClientObservation {
  readonly effects: readonly Effect[];
  readonly skipped: number;
  readonly failed: number;
}

export interface ClientFixtureData {
  readonly reportInstanceId: string;
  readonly createdInstanceId: string;
  readonly intent: string;
  readonly effects: readonly {
    readonly action: string;
    readonly variant: string;
  }[];
}
const defaultData: ClientFixtureData = {
  reportInstanceId: 'report-main',
  createdInstanceId: 'created',
  intent: 'Open the report and create weather',
  effects: [
    { action: 'openBreakdown', variant: 'breakdown' },
    { action: 'configure', variant: 'current' },
  ],
};

export function scoreClientEffects(
  value: ClientObservation,
  expected = defaultData.effects,
): Verdict {
  const failures: string[] = [];
  if (value.effects.length !== 2)
    failures.push('Both handlers must execute exactly once');
  for (const { action, variant } of expected) {
    const effect = value.effects.find((effect) => effect.action === action);
    if (!effect?.exists) failures.push(`${action} must observe its Instance`);
    if (effect?.variant !== variant)
      failures.push(`${action} observed the wrong Variant`);
  }
  if (value.skipped || value.failed)
    failures.push('No Action may fail or be skipped');
  return { outcome: failures.length ? 'fail' : 'pass', failures };
}

/** Synthetic legacy race plus new-Instance Action, using the real public client boundary. */
export function clientFixture(
  fault?: 'reverse-order' | 'replace-source-runner',
  data: ClientFixtureData = defaultData,
): EvaluationAdapter<ClientObservation> {
  let orchestrator: Orchestrator | undefined;
  let restore: (() => void) | undefined;
  const releases: (() => void)[] = [];
  return {
    surface: 'client-application',
    provenance:
      'mock-connector/real-client; legacy-derived D16, not engine-old',
    async execute(context) {
      const report = defineVessel({
        id: 'report',
        name: 'Report',
        description: 'Synthetic report',
        defaultVariant: 'summary',
        variants: {
          summary: {
            props: {},
            minSize: { width: 1, height: 1 },
            actions: [
              {
                name: 'openBreakdown',
                description: 'Open details',
                transitionsTo: 'breakdown',
              },
            ],
          },
          breakdown: {
            props: {},
            minSize: { width: 1, height: 1 },
            actions: [],
          },
        },
      });
      const weather = defineVessel({
        id: 'weather',
        name: 'Weather',
        description: 'Synthetic weather',
        defaultVariant: 'current',
        variants: {
          current: {
            props: {},
            minSize: { width: 1, height: 1 },
            actions: [
              {
                name: 'configure',
                description: 'Configure the created Instance',
              },
            ],
          },
        },
      });
      const connector: EngineConnector = {
        capabilities: { voice: false, streaming: false, stateful: false },
        connect: async () => {},
        disconnect: async () => {},
        subscribe: () => () => {},
        addAssistantMessage: async () => {},
        getHistory: async () => [],
        async process(message): Promise<MaelstromResponse> {
          return {
            type: 'maelstrom_response',
            requestId: message.id,
            userMessage: 'Done',
            rationale: 'Synthetic fixture',
            layout: {
              type: 'tiling',
              tree: [
                'V',
                `ID:${data.reportInstanceId}`,
                `ID:${data.createdInstanceId}`,
              ],
              instances: [
                {
                  instanceId: InstanceId(data.reportInstanceId),
                  vesselId: VesselId('report'),
                  variant: VariantName('breakdown'),
                },
                {
                  instanceId: InstanceId(data.createdInstanceId),
                  vesselId: VesselId('weather'),
                  variant: VariantName('current'),
                },
              ],
            },
            executionPlan: [
              {
                instanceId: InstanceId(data.reportInstanceId),
                action: ActionName('openBreakdown'),
              },
              {
                instanceId: InstanceId(data.createdInstanceId),
                action: ActionName('configure'),
              },
            ],
          };
        },
      };
      const client = new Orchestrator(connector, {
        vessels: [report, weather],
        readyTimeoutMs: 25,
        initialLayout: {
          type: 'tiling',
          tree: [`ID:${data.reportInstanceId}`],
          instances: [
            {
              instanceId: InstanceId(data.reportInstanceId),
              vesselId: VesselId('report'),
              variant: VariantName('summary'),
            },
          ],
        },
      });
      orchestrator = client;
      const effects: Effect[] = [];
      const observe = (action: string, id: string) => {
        const instance = client.commandProcessor.store.state.instances.get(
          InstanceId(id),
        );
        effects.push({
          action,
          exists: instance !== undefined,
          variant: instance?.variant,
        });
        return ok(undefined);
      };
      releases.push(
        client.commandProcessor.registerRunner(
          InstanceId(data.reportInstanceId),
          {
            async openBreakdown() {
              // A legitimate asynchronous transition must not be scored as a defect.
              await Promise.resolve();
              return observe('openBreakdown', data.reportInstanceId);
            },
          },
        ),
      );
      releases.push(
        client.commandProcessor.events.on('command_complete', ({ command }) => {
          if (command.kind !== 'set_layout') return;
          if (fault === 'replace-source-runner')
            releases.push(
              client.commandProcessor.registerRunner(
                InstanceId(data.reportInstanceId),
                {},
              ),
            );
          // Simulate asynchronous registration after the new Instance becomes observable.
          queueMicrotask(() =>
            releases.push(
              client.commandProcessor.registerRunner(
                InstanceId(data.createdInstanceId),
                {
                  configure: async () =>
                    observe('configure', data.createdInstanceId),
                },
              ),
            ),
          );
        }),
      );
      let skipped = 0;
      let failed = 0;
      releases.push(
        client.commandProcessor.events.on('actions_completed', ({ result }) => {
          skipped += result.skippedCount;
          failed += result.failureCount;
        }),
      );
      releases.push(
        client.diagnostics.subscribe(({ event }) =>
          context.record({
            kind: 'diagnostic',
            producer: context.sampleKey,
            requestId: event.requestId,
            value: { kind: event.kind },
          }),
        ),
      );
      if (fault === 'reverse-order') {
        const original = client.commandProcessor.dispatchSettled.bind(
          client.commandProcessor,
        );
        const spy = spyOn(
          client.commandProcessor,
          'dispatchSettled',
        ).mockImplementation((...commands) =>
          original(...[...commands].reverse()),
        );
        restore = () => spy.mockRestore();
      }
      await client.connect();
      await client.processIntent(data.intent);
      await client.commandProcessor.waitForIdle();
      return {
        disposition: 'planned',
        completeness: 'complete',
        value: { effects, skipped, failed },
      };
    },
    score: (value) => scoreClientEffects(value, data.effects),
    async dispose() {
      restore?.();
      for (const release of releases.splice(0)) release();
      await orchestrator?.dispose();
    },
  };
}
