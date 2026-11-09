import { describe, expect, test } from 'bun:test';

import type { ReplylessCandidate } from '@maelstrom-co/engine';
import {
  ActionName,
  type ChartRequest,
  InstanceId,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';

import { makeRequest, plain } from './__test-helpers__/fixtures.js';
import { parameterClarification } from './parameter-clarification.js';
import type { ParameterAsk, PendingParameter } from './types.js';

const TITLE: PendingParameter = {
  name: 'title',
  type: 'string',
  description: 'Task title',
};

const DESTINATION: PendingParameter = {
  name: 'destination',
  type: 'string',
  description: 'Name of the destination location',
  enum: ['Studio Vortex HQ', 'Central Station'],
};

const CHECK_TITLE: PendingParameter = {
  name: 'title',
  type: 'string',
  description: 'Title of the task to check',
  enum: ['Buy milk', 'Send invoice', 7, null],
};

const SHOW_WEEKLY = [
  { instanceId: InstanceId('weather-main'), action: ActionName('showWeekly') },
] as const;

describe('parameterClarification question', () => {
  test('one ask without enum names the parameter, action, instance and description', () => {
    const request = makeRequest('add a task');
    const result = parameterClarification(
      [ask('tasks-main/addTask', TITLE)],
      partial(request),
      request,
    );
    expect(result.type).toBe('needs_clarification');
    expect(result.question).toBe(
      'What should title be for addTask on tasks-main? (Task title)',
    );
    expect(plain(result)).not.toHaveProperty('options');
  });

  test('an enum ask offers its values as options', () => {
    const request = makeRequest('show a route');
    const result = parameterClarification(
      [ask('map-main/showRoute', DESTINATION)],
      partial(request),
      request,
    );
    expect(result.options).toEqual(['Studio Vortex HQ', 'Central Station']);
  });

  test('a mixed enum keeps strings and stringifies the rest', () => {
    const request = makeRequest('check a task');
    const result = parameterClarification(
      [ask('tasks-main/checkTask', CHECK_TITLE)],
      partial(request),
      request,
    );
    expect(result.options).toEqual(['Buy milk', 'Send invoice', '7', 'null']);
  });

  test('two asks give one sentence each in ask order and no options', () => {
    const request = makeRequest('add a task and show a route');
    const result = parameterClarification(
      [
        ask('tasks-main/addTask', TITLE),
        ask('map-main/showRoute', DESTINATION),
      ],
      partial(request),
      request,
    );
    expect(result.question).toBe(
      'What should title be for addTask on tasks-main? (Task title) What should destination be for showRoute on map-main? (Name of the destination location)',
    );
    expect(plain(result)).not.toHaveProperty('options');
  });
});

describe('parameterClarification partial changes', () => {
  test('carries a non-empty executionPlan and leaves an unchanged layout out', () => {
    const request = makeRequest('add a task and show the weekly forecast');
    const result = parameterClarification(
      [ask('tasks-main/addTask', TITLE)],
      partial(request, { executionPlan: SHOW_WEEKLY }),
      request,
    );
    expect(plain(result.executionPlan)).toEqual([
      { instanceId: 'weather-main', action: 'showWeekly' },
    ]);
    expect(plain(result)).not.toHaveProperty('layout');
  });

  test('carries the layout when the tree changed', () => {
    const request = makeRequest('add a task and hide the tasks');
    const tree = ['H', 'ID:calendar-main', 'ID:weather-main'];
    const result = parameterClarification(
      [ask('tasks-main/addTask', TITLE)],
      partial(request, { tree }),
      request,
    );
    expect(plain(result.layout)).toMatchObject({ tree });
  });

  test('carries the layout when it creates an instance', () => {
    const request = makeRequest('add a map with a route');
    const created = {
      instanceId: InstanceId('map-new'),
      vesselId: VesselId('map'),
      variant: VariantName('overview'),
    };
    const result = parameterClarification(
      [ask('map-new/showRoute', DESTINATION)],
      partial(request, { instances: [...request.instances, created] }),
      request,
    );
    expect(plain(result.layout)).toMatchObject({
      instances: expect.arrayContaining([
        expect.objectContaining({ instanceId: 'map-new' }),
      ]),
    });
  });

  test('an empty executionPlan and an unchanged layout leave only the question', () => {
    const request = makeRequest('add a task');
    const result = parameterClarification(
      [ask('tasks-main/addTask', TITLE)],
      partial(request),
      request,
    );
    expect(Object.keys(plain(result) as object).sort()).toEqual([
      'question',
      'type',
    ]);
  });
});

function ask(target: string, parameter: PendingParameter): ParameterAsk {
  const [instanceId, action] = target.split('/');
  return {
    instanceId: InstanceId(instanceId),
    action: ActionName(action),
    parameter,
  };
}

/** A replyless tiling candidate over `request`, by default with its current tree and instances and no actions. */
function partial(
  request: ChartRequest,
  overrides: {
    readonly executionPlan?: readonly {
      instanceId: InstanceId;
      action: ActionName;
    }[];
    readonly tree?: readonly string[];
    readonly instances?: ChartRequest['instances'];
  } = {},
): ReplylessCandidate {
  if (request.layout.type !== 'tiling')
    throw new Error('expected a tiling request');
  return {
    type: 'plan',
    rationale: 'Planned by Jev.',
    executionPlan: overrides.executionPlan ?? [],
    layout: {
      tree: overrides.tree ?? request.layout.tree,
      instances: overrides.instances ?? request.instances,
    },
  } as ReplylessCandidate;
}
