import {
  ActionName,
  type ChartRequest,
  InstanceId,
  type MaelstromResponse,
  VariantName,
} from '@maelstrom-co/protocol';
import { expect, it } from 'vitest';

import { liveLayout, liveTopicDefinition, validateLivePlan } from './live-plan';

const topics = [
  { id: 'one', content: 'Opening' },
  { id: 'two', content: 'Closing' },
];
const layout = () => liveLayout(topics.map((topic) => topic.id));
function input() {
  return {
    request: {
      vessels: topics.map(liveTopicDefinition),
      layout: layout(),
      context: {
        updateReasons: [
          { type: 'user_intent', intent: 'Final speech evidence' },
        ],
      },
    } as unknown as ChartRequest,
    response: {
      layout: layout(),
      executionPlan: [
        {
          instanceId: InstanceId('talking-points-live-one-main'),
          action: ActionName('mark'),
          params: {},
        },
      ],
    } as unknown as MaelstromResponse,
  };
}
it('accepts only the seeded logical tiling, IDs, order and stable Variant with mark-only Actions', () => {
  const value = input();
  expect(validateLivePlan(value)).toEqual([]);
  for (const change of [
    { layout: { ...layout(), tree: [...layout().tree].reverse() } },
    {
      executionPlan: [
        {
          instanceId: InstanceId('talking-points-live-one-main'),
          action: ActionName('unmark'),
        },
      ],
    },
    {
      executionPlan: [
        { instanceId: InstanceId('other'), action: ActionName('mark') },
      ],
    },
    {
      executionPlan: [
        {
          instanceId: InstanceId('talking-points-live-one-main'),
          action: ActionName('mark'),
          params: { id: 'two' },
        },
      ],
    },
    { layout: { ...layout(), instances: layout().instances.slice(0, 1) } },
    {
      layout: {
        ...layout(),
        instances: layout().instances.map((instance) => ({
          ...instance,
          variant: VariantName('spoken'),
        })),
      },
    },
  ]) {
    expect(
      validateLivePlan({ ...value, response: { ...value.response, ...change } })
        .length,
    ).toBeGreaterThan(0);
  }
});
it('resize and catalog mutation cannot invent spoken coverage without submitted evidence', () => {
  for (const type of ['chart_resize', 'vessel_mutation']) {
    const value = input();
    const request = {
      ...value.request,
      context: { ...value.request.context, updateReasons: [{ type } as never] },
    };
    expect(validateLivePlan({ ...value, request }).length).toBeGreaterThan(0);
    expect(
      validateLivePlan({
        request,
        response: { ...value.response, executionPlan: [] },
      }),
    ).toEqual([]);
  }
});
it('does not apply live policy to the unrelated preparation catalog', () => {
  const value = input();
  expect(
    validateLivePlan({ ...value, request: { ...value.request, vessels: [] } }),
  ).toEqual([]);
});

it('accepts the real Engine healed seeded layout on resize and refuses changed visibility', async () => {
  const { createEngine } = await import('@maelstrom-co/engine');
  const { ChartRequestSchema, ChartRequestMessage, SessionId, ok } =
    await import('@maelstrom-co/protocol');
  const request = ChartRequestSchema.parse({
    type: 'chart_request',
    vessels: topics.map(liveTopicDefinition),
    instances: layout().instances,
    layout: layout(),
    context: {
      updateReasons: [
        {
          type: 'chart_resize',
          previous: { columns: 12, rows: 8 },
          current: { columns: 6, rows: 8 },
        },
      ],
      chartDimensions: { columns: 6, rows: 8 },
      layoutMode: 'tiling',
    },
  });
  let candidate = layout();
  const engine = createEngine({
    planner: async () =>
      ok({
        type: 'plan' as const,
        userMessage: 'Ready.',
        rationale: '',
        executionPlan: [],
        layout: candidate,
      }),
    validatePlan: validateLivePlan,
    retry: false,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  const accepted = await engine.handle(
    ChartRequestMessage({ sessionId: SessionId('live-plan'), request }),
  );
  expect(accepted).toMatchObject({ ok: true });
  candidate = { ...layout(), tree: [layout().tree.at(-1)!] };
  expect(
    (
      await engine.handle(
        ChartRequestMessage({ sessionId: SessionId('live-plan'), request }),
      )
    ).ok,
  ).toBe(false);
});
