import { afterEach, describe, expect, test } from 'bun:test';

import type { PlannerCandidate, ValidateCandidate } from '@maelstrom-co/engine';
import {
  ActionName,
  type ChartRequest,
  err,
  InstanceId,
  isOk,
  MessageId,
  ok,
  VariantName,
  type Vessel,
  VesselId,
} from '@maelstrom-co/protocol';

import {
  acceptAll,
  deferralOf,
  errorTagOf,
  makeContext,
  makeRequest,
  plain,
  spyLogger,
  vessels,
} from '../__test-helpers__/fixtures.js';
import {
  completionPlan,
  planned,
} from '../__test-helpers__/layout-fixtures.js';
import {
  chatCall,
  chatPrompt,
  dummyAdapter,
  installMockChat,
  mockChat,
} from '../__test-helpers__/mock-chat.js';
import type {
  JevLayoutPlan,
  PendingParameter,
  PlannedAction,
} from '../types.js';
import { llmComplete } from './llm-complete.js';

installMockChat();

afterEach(() => mockChat.mockReset());

const LOCATION: PendingParameter = {
  name: 'location',
  type: 'string',
  description: 'City or place to request weather for',
};

async function run(
  layoutPlan: JevLayoutPlan,
  overrides: { validate?: ValidateCandidate; signal?: AbortSignal } = {},
) {
  const { logger, entries } = spyLogger();
  const ctx = makeContext(layoutPlan.plan.selection.input, {
    logger,
    ...overrides,
  });
  const result = await llmComplete({ adapter: dummyAdapter })(layoutPlan, ctx);
  return { result, entries };
}

/** A layout plan over `request` that also creates `instanceId` of `vesselId` in `variant`. */
function creating(
  request: ChartRequest,
  created: { instanceId: string; vesselId: string; variant: string },
  actions: readonly PlannedAction[],
): JevLayoutPlan {
  const base = completionPlan(request, { actions });
  const { selection } = base.plan;
  return {
    ...base,
    plan: {
      ...base.plan,
      selection: {
        ...selection,
        instances: [
          ...selection.instances,
          {
            instanceId: InstanceId(created.instanceId),
            vesselId: VesselId(created.vesselId),
            variant: VariantName(created.variant),
            visible: true,
            fresh: true,
            decision: 'create',
          },
        ],
      },
    },
  };
}

/** The fixture catalog with a map `focusLocation` that moves to a `compact` view offering no `focusLocation`. */
function withCompactMap(): readonly Vessel[] {
  const focusLocation = {
    name: ActionName('focusLocation'),
    description: 'Focus a saved place',
    idempotent: false,
    parameters: [
      { name: 'name', type: 'string' as const, description: 'Place name' },
    ],
    transitionsTo: VariantName('compact'),
  };
  return vessels.map((vessel) => {
    const overview = vessel.variants[VariantName('overview')];
    if (vessel.id !== 'map' || overview === undefined) return vessel;
    return {
      ...vessel,
      variants: {
        ...vessel.variants,
        overview: {
          ...overview,
          actions: [...overview.actions, focusLocation],
        },
        compact: { ...overview, actions: [] },
      },
    };
  });
}

function declaredVariant(
  candidate: ReturnType<typeof candidateOf>,
  instanceId: string,
): string | undefined {
  return candidate.layout.instances.find(
    (instance) => instance.instanceId === instanceId,
  )?.variant;
}

function candidateOf(result: Awaited<ReturnType<typeof run>>['result']) {
  if (!isOk(result))
    throw new Error(`expected a candidate: ${deferralOf(result)}`);
  return plain(result.value) as {
    userMessage: string;
    rationale: string;
    executionPlan: {
      instanceId: string;
      action: string;
      paramsJson?: string;
    }[];
    layout: {
      tree: unknown[];
      instances: { instanceId: string; variant: string }[];
    };
  };
}

describe('llmComplete', () => {
  test('uses the { userMessage } schema when nothing is pending', async () => {
    mockChat.mockResolvedValue({ userMessage: 'Done.' });
    const { result } = await run(completionPlan(makeRequest('hide the tasks')));
    expect(candidateOf(result).userMessage).toBe('Done.');
    expect(Object.keys(chatCall().outputSchema.shape)).toEqual(['userMessage']);
  });

  test('the schema has exactly the pending slots, typed from their parameters', async () => {
    mockChat.mockResolvedValue({
      userMessage: 'ok',
      params: { p0: 'Tokyo', p1: 3, p2: 'Buy milk', p3: '{"a":1}' },
    });
    await run(
      completionPlan(makeRequest('x'), {
        actions: [
          planned('weather-main/setLocation', {}, [LOCATION]),
          planned('tasks-main/setLimit', {}, [
            { name: 'count', type: 'number', description: 'How many' },
          ]),
          planned('tasks-main/checkTask', {}, [
            {
              name: 'title',
              type: 'string',
              description: 'Title',
              enum: ['Buy milk', 'Send invoice'],
            },
          ]),
          planned('tasks-main/importTasks', {}, [
            { name: 'payload', type: 'object', description: 'Tasks' },
          ]),
        ],
      }),
    );
    const params = chatCall().outputSchema.shape.params as unknown as {
      shape: Record<
        string,
        { safeParse: (v: unknown) => { success: boolean } }
      >;
    };
    expect(Object.keys(params.shape)).toEqual(['p0', 'p1', 'p2', 'p3']);
    expect(params.shape.p0?.safeParse('Tokyo').success).toBe(true);
    expect(params.shape.p0?.safeParse(null).success).toBe(true);
    expect(params.shape.p1?.safeParse('3').success).toBe(false);
    expect(params.shape.p1?.safeParse(3).success).toBe(true);
    expect(params.shape.p2?.safeParse('Buy milk').success).toBe(true);
    expect(params.shape.p2?.safeParse('Buy bread').success).toBe(false);
    expect(params.shape.p3?.safeParse('{"a":1}').success).toBe(true);
  });

  test('merges filled values into paramsJson', async () => {
    mockChat.mockResolvedValue({ userMessage: 'ok', params: { p0: 'Tokyo' } });
    const { result } = await run(
      completionPlan(makeRequest('weather for the capital of Japan'), {
        actions: [planned('weather-main/setLocation', {}, [LOCATION])],
      }),
    );
    expect(candidateOf(result).executionPlan).toEqual([
      {
        instanceId: 'weather-main',
        action: 'setLocation',
        paramsJson: '{"location":"Tokyo"}',
      },
    ]);
    expect(chatPrompt()).toContain('## Values to fill');
  });

  test('the prompt tells the model to resolve indirect references and states the parameter description', async () => {
    mockChat.mockResolvedValue({ userMessage: 'ok', params: { p0: 'Paris' } });
    await run(
      completionPlan(
        makeRequest(
          'set the weather to the city where the Eiffel Tower stands',
        ),
        { actions: [planned('weather-main/setLocation', {}, [LOCATION])] },
      ),
    );
    expect(chatPrompt()).toContain(
      'resolve a landmark, event, or other indirect reference',
    );
    expect(chatPrompt()).toContain(LOCATION.description);
  });

  test('a resolved value for an indirectly stated parameter ships in the action params', async () => {
    mockChat.mockResolvedValue({ userMessage: 'ok', params: { p0: 'Paris' } });
    const { result } = await run(
      completionPlan(
        makeRequest(
          'set the weather to the city where the Eiffel Tower stands',
        ),
        { actions: [planned('weather-main/setLocation', {}, [LOCATION])] },
      ),
    );
    expect(candidateOf(result).executionPlan).toEqual([
      {
        instanceId: 'weather-main',
        action: 'setLocation',
        paramsJson: '{"location":"Paris"}',
      },
    ]);
  });

  test('a verbatim value still passes through unchanged', async () => {
    mockChat.mockResolvedValue({ userMessage: 'ok', params: { p0: 'Tokyo' } });
    const { result } = await run(
      completionPlan(makeRequest('Set the weather location to "Tokyo".'), {
        actions: [planned('weather-main/setLocation', {}, [LOCATION])],
      }),
    );
    expect(candidateOf(result).executionPlan).toEqual([
      {
        instanceId: 'weather-main',
        action: 'setLocation',
        paramsJson: '{"location":"Tokyo"}',
      },
    ]);
  });

  test.each([
    ['null', null],
    ['an unparsable object', 'not json'],
  ])('a %s fill defers param_unfilled', async (_name, value) => {
    const slot: PendingParameter =
      value === null
        ? LOCATION
        : { name: 'payload', type: 'object', description: 'x' };
    mockChat.mockResolvedValue({ userMessage: 'ok', params: { p0: value } });
    const { result, entries } = await run(
      completionPlan(makeRequest('x'), {
        actions: [
          planned(
            value === null
              ? 'weather-main/setLocation'
              : 'tasks-main/importTasks',
            {},
            [slot],
          ),
        ],
      }),
    );
    expect(deferralOf(result)).toBe('llmComplete/param_unfilled');
    expect(entries.find((e) => e.msg === 'jev.defer')?.data?.question).toBe(
      value === null
        ? 'weather-main/setLocation/location'
        : 'tasks-main/importTasks/payload',
    );
  });

  test('asks appear in the prompt and the dropped action is not planned', async () => {
    mockChat.mockResolvedValue({ userMessage: 'What should the task say?' });
    const { result } = await run(
      completionPlan(makeRequest('add a task and show the weekly forecast'), {
        actions: [planned('weather-main/showWeekly')],
        asks: [
          {
            instanceId: InstanceId('tasks-main'),
            action: ActionName('addTask'),
            parameter: {
              name: 'title',
              type: 'string',
              description: 'Task title',
            },
          },
        ],
      }),
    );
    expect(chatPrompt()).toContain('## Ask the user');
    expect(chatPrompt()).toContain('title for addTask on tasks-main');
    const candidate = candidateOf(result);
    expect(candidate.executionPlan.map((a) => a.action)).toEqual([
      'showWeekly',
    ]);
    expect(candidate.rationale).toContain(
      'Asked the user for: tasks-main.addTask.title',
    );
  });

  test('declares post-transition variants and a code-built rationale', async () => {
    mockChat.mockResolvedValue({ userMessage: 'Opened it.' });
    const tree = [
      'V:2,1',
      'ID:journal-main',
      'H',
      'ID:calendar-main',
      'ID:weather-main',
    ];
    const { result } = await run(
      completionPlan(makeRequest('open the Monday entry'), {
        actions: [planned('journal-main/openEntry', { title: 'Monday' })],
        decisions: { 'journal-main': 'keep', 'tasks-main': 'delete' },
        tree,
      }),
    );
    const candidate = candidateOf(result);
    expect(candidate.layout.tree).toEqual(tree);
    expect(candidate.layout.instances).toEqual([
      { instanceId: 'calendar-main', vesselId: 'calendar', variant: 'month' },
      { instanceId: 'weather-main', vesselId: 'weather', variant: 'current' },
      { instanceId: 'map-main', vesselId: 'map', variant: 'overview' },
      { instanceId: 'journal-main', vesselId: 'journal', variant: 'entry' },
    ] as never);
    expect(candidate.rationale).toContain('Planned by Jev.');
    expect(candidate.rationale).toContain('openEntry on journal-main');
    expect(candidate.rationale).toContain('Deleted: tasks-main');
  });

  test('a new map with a route is declared in route and keeps showRoute', async () => {
    mockChat.mockResolvedValue({ userMessage: 'Added a map.' });
    const { result } = await run(
      creating(
        makeRequest('show me a map with a route to Central Station'),
        { instanceId: 'map-new', vesselId: 'map', variant: 'overview' },
        [planned('map-new/showRoute', { destination: 'Central Station' })],
      ),
    );
    const candidate = candidateOf(result);
    expect(declaredVariant(candidate, 'map-new')).toBe('route');
    expect(candidate.executionPlan).toEqual([
      {
        instanceId: 'map-new',
        action: 'showRoute',
        paramsJson: '{"destination":"Central Station"}',
      },
    ]);
  });

  test('a new calendar switched to week is declared in week without the switch', async () => {
    mockChat.mockResolvedValue({ userMessage: 'Added a week calendar.' });
    const { result } = await run(
      creating(
        makeRequest('add a calendar for this week and the weekly forecast'),
        { instanceId: 'calendar-new', vesselId: 'calendar', variant: 'month' },
        [planned('calendar-new/showWeek'), planned('weather-main/showWeekly')],
      ),
    );
    const candidate = candidateOf(result);
    expect(declaredVariant(candidate, 'calendar-new')).toBe('week');
    expect(declaredVariant(candidate, 'weather-main')).toBe('weekly');
    expect(candidate.executionPlan).toEqual([
      { instanceId: 'weather-main', action: 'showWeekly' },
    ]);
  });

  test('a new instance keeps its created variant and actions when a parameterized action is not offered in the final variant', async () => {
    mockChat.mockResolvedValue({ userMessage: 'Added a map.' });
    const { result } = await run(
      creating(
        makeRequest('add a map focused on the office', {
          vessels: withCompactMap(),
        }),
        { instanceId: 'map-new', vesselId: 'map', variant: 'overview' },
        [planned('map-new/focusLocation', { name: 'Office' })],
      ),
    );
    const candidate = candidateOf(result);
    expect(declaredVariant(candidate, 'map-new')).toBe('overview');
    expect(candidate.executionPlan).toEqual([
      {
        instanceId: 'map-new',
        action: 'focusLocation',
        paramsJson: '{"name":"Office"}',
      },
    ]);
  });

  test('an existing instance is declared in its final variant and keeps its switch', async () => {
    mockChat.mockResolvedValue({ userMessage: 'Showing the week.' });
    const { result } = await run(
      completionPlan(makeRequest('show this week'), {
        actions: [planned('calendar-main/showWeek')],
      }),
    );
    const candidate = candidateOf(result);
    expect(declaredVariant(candidate, 'calendar-main')).toBe('week');
    expect(candidate.executionPlan).toEqual([
      { instanceId: 'calendar-main', action: 'showWeek' },
    ]);
  });

  test('a validation error defers invalid_candidate', async () => {
    mockChat.mockResolvedValue({ userMessage: 'ok' });
    const { result } = await run(completionPlan(makeRequest('x')), {
      validate: () =>
        err({ _tag: 'ParseError', message: 'empty userMessage', raw: '' }),
    });
    expect(deferralOf(result)).toBe('llmComplete/invalid_candidate');
  });

  test('a recommended retry defers retry_recommended', async () => {
    mockChat.mockResolvedValue({ userMessage: 'ok' });
    const recommending: ValidateCandidate = (candidate: PlannerCandidate) => {
      const report = acceptAll(candidate);
      if (!isOk(report)) return report;
      return ok({
        ...report.value,
        requestId: MessageId('req-1'),
        diagnostics: {
          ...report.value.diagnostics,
          retryHint: { severity: 'medium', recommend: true },
        },
      });
    };
    const { result } = await run(completionPlan(makeRequest('x')), {
      validate: recommending,
    });
    expect(deferralOf(result)).toBe('llmComplete/retry_recommended');
  });

  test('a provider failure is a ProviderError, not a deferral', async () => {
    mockChat.mockRejectedValue(new Error('rate limited'));
    const { result } = await run(completionPlan(makeRequest('x')));
    expect(errorTagOf(result)).toBe('ProviderError');
  });

  test('an abort is a CancellationError, not a deferral', async () => {
    const controller = new AbortController();
    mockChat.mockImplementation(async (options) => {
      controller.abort('user left');
      expect(options.abortController.signal.aborted).toBe(true);
      throw new DOMException('aborted', 'AbortError');
    });
    const { result } = await run(completionPlan(makeRequest('x')), {
      signal: controller.signal,
    });
    expect(errorTagOf(result)).toBe('CancellationError');
  });
});
