import { createEngine, type PlannerCandidate } from '@maelstrom-co/engine';
import {
  ChartRequestMessage,
  defineVessel,
  MessageId,
  ok,
  SessionId,
  TilingResponseSchema,
  VesselSchema,
} from '@maelstrom-co/protocol';
import { type RecordFact, ResponseSchema, type Snapshot } from './contracts.js';

export const notes = defineVessel({
  id: 'notes',
  name: 'Notes',
  description: 'A developer-built notes Vessel.',
  defaultVariant: 'list',
  variants: {
    list: {
      description: 'The notes list',
      props: {},
      minSize: { width: 2, height: 2 },
      actions: [
        { name: 'create', description: 'Create a note in the local fixture.' },
        {
          name: 'focus',
          description: 'Focus the exact record read from storage.',
          parameters: [
            {
              name: 'id',
              type: 'string',
              required: true,
              description: 'Record ID',
            },
            {
              name: 'version',
              type: 'number',
              required: true,
              description: 'Record version',
            },
          ],
        },
      ],
    },
  },
});

export function candidate(record?: RecordFact): PlannerCandidate {
  return TilingResponseSchema.parse({
    userMessage: record ? 'Focus the created note.' : 'Create a note.',
    rationale: 'Scripted workspace fixture.',
    layout: {
      tree: ['ID:notes-1'],
      instances: [
        { instanceId: 'notes-1', vesselId: 'notes', variant: 'list' },
      ],
    },
    executionPlan: [
      {
        instanceId: 'notes-1',
        action: record ? 'focus' : 'create',
        paramsJson: record ? JSON.stringify(record) : '{}',
      },
    ],
  });
}

export async function plan(
  snapshot: Snapshot,
  requestId: string,
  proposed = candidate(),
) {
  const engine = createEngine({
    planner: async () => ok(proposed),
    retry: false,
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    validatePlan: ({ response }) =>
      response.executionPlan.length === 1
        ? []
        : [
            {
              code: 'required_action',
              message: 'The fixture requires exactly one accepted Action.',
            },
          ],
  });
  const output = await engine.handle(
    ChartRequestMessage({
      id: MessageId(requestId),
      sessionId: SessionId('agui-poc'),
      request: {
        type: 'chart_request',
        context: {
          updateReasons: [
            { type: 'user_intent', intent: proposed.userMessage },
          ],
          chartDimensions: snapshot.chartDimensions,
          layoutMode: 'tiling',
        },
        instances: snapshot.instances,
        vessels: [VesselSchema.parse(notes)],
        layout: snapshot.layout ?? { type: 'tiling', tree: [], instances: [] },
      },
    }),
  );
  if (!output.ok)
    throw new Error(`Engine refused candidate: ${output.error._tag}`);
  if (output.value.type !== 'chart_response')
    throw new Error('Unexpected Engine output');
  return ResponseSchema.parse(output.value.response);
}
