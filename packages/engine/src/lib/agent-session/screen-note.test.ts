import { describe, expect, test } from 'bun:test';

import {
  ActionName,
  type ActionExecution,
  type AgentActionOutcome,
  type ChartRequest,
  InstanceId,
} from '@maelstrom-co/protocol';

import { makeGridRequest } from '../__test-helpers__/fixtures.js';
import {
  describeScreenUpdate,
  describeShowCancelled,
  describeShowFailed,
  describeShowNotConfirmed,
  describeShowQueued,
  describeShowSkipped,
} from './screen-note.js';

const ok: AgentActionOutcome = { ok: true };

describe('describeShowQueued', () => {
  test('names one tool with a singular result', () => {
    expect(describeShowQueued(['latest_order'])).toBe(
      'Show queued: latest_order result.',
    );
  });

  test('joins two tools with and', () => {
    expect(describeShowQueued(['latest_order', 'search_products'])).toBe(
      'Show queued: latest_order and search_products results.',
    );
  });

  test('lists three tools with commas and joins the last two with and', () => {
    expect(describeShowQueued(['a', 'b', 'c'])).toBe(
      'Show queued: a, b and c results.',
    );
    expect(describeShowQueued(['a', 'b', 'c', 'd'])).toBe(
      'Show queued: a, b, c and d results.',
    );
  });
});

describe('describeShowFailed', () => {
  test('names one, two and three tools', () => {
    expect(describeShowFailed(['latest_order'])).toBe(
      'Show failed: latest_order result could not be shown.',
    );
    expect(describeShowFailed(['latest_order', 'search_products'])).toBe(
      'Show failed: latest_order and search_products results could not be shown.',
    );
    expect(describeShowFailed(['a', 'b', 'c'])).toBe(
      'Show failed: a, b and c results could not be shown.',
    );
  });
});

describe('describeShowSkipped', () => {
  test('says there is nothing new to show', () => {
    expect(
      describeShowSkipped(['latest_order'], { reason: 'nothing_to_show' }),
    ).toBe('Show skipped: nothing new to show for latest_order result.');
    expect(
      describeShowSkipped(['a', 'b', 'c'], { reason: 'nothing_to_show' }),
    ).toBe('Show skipped: nothing new to show for a, b and c results.');
  });

  test('relays the Planner question when it needs more detail', () => {
    expect(
      describeShowSkipped(['latest_order'], {
        reason: 'needs_clarification',
        question: 'Which order do you mean?',
      }),
    ).toBe(
      'Show skipped: the Planner needs more detail to show latest_order result. Question: Which order do you mean?',
    );
    expect(
      describeShowSkipped(['latest_order', 'search_products'], {
        reason: 'needs_clarification',
        question: 'Which one?',
      }),
    ).toBe(
      'Show skipped: the Planner needs more detail to show latest_order and search_products results. Question: Which one?',
    );
  });
});

describe('describeShowNotConfirmed', () => {
  test('says the screen did not acknowledge the change, never that it failed', () => {
    expect(describeShowNotConfirmed(['latest_order'])).toBe(
      'Show not confirmed: the screen did not acknowledge the latest_order change.',
    );
    expect(describeShowNotConfirmed(['a', 'b'])).toBe(
      'Show not confirmed: the screen did not acknowledge the a and b change.',
    );
  });
});

describe('describeShowCancelled', () => {
  test('names one, two and three tools', () => {
    expect(describeShowCancelled(['latest_order'])).toBe(
      'Show cancelled: latest_order result.',
    );
    expect(describeShowCancelled(['a', 'b'])).toBe(
      'Show cancelled: a and b results.',
    );
    expect(describeShowCancelled(['a', 'b', 'c'])).toBe(
      'Show cancelled: a, b and c results.',
    );
  });
});

describe('describeScreenUpdate', () => {
  test('describes one Action with the Vessel and the Variant it reached', () => {
    const note = describeScreenUpdate({
      executionPlan: [action('calendar-main', 'showWeek')],
      actionOutcomes: [ok],
      chart: chartWithCalendar('week'),
    });

    expect(note).toBe(
      'Screen updated: ran showWeek on calendar → week. Visible: calendar (week).',
    );
  });

  test('describes several Actions in plan order joined by commas', () => {
    const note = describeScreenUpdate({
      executionPlan: [
        action('calendar-main', 'showWeek'),
        action('tasks-main', 'filterOpen'),
      ],
      actionOutcomes: [ok, ok],
      chart: makeGridRequest({
        instances: [
          {
            instanceId: 'calendar-main',
            vesselId: 'calendar',
            variant: 'week',
          },
          { instanceId: 'tasks-main', vesselId: 'tasks', variant: 'open' },
        ],
        layout: {
          type: 'grid',
          positions: [
            gridPosition('calendar-main', 0),
            gridPosition('tasks-main', 6),
          ],
        },
      }),
    });

    expect(note).toBe(
      'Screen updated: ran showWeek on calendar → week, ran filterOpen on tasks → open. Visible: calendar (week), tasks (open).',
    );
  });

  test('reports an Action whose positional outcome is not ok as failed', () => {
    const note = describeScreenUpdate({
      executionPlan: [
        action('calendar-main', 'showWeek'),
        action('calendar-main', 'showDay'),
      ],
      actionOutcomes: [ok, { ok: false, error: 'secret failure detail' }],
      chart: chartWithCalendar('week'),
    });

    expect(note).toBe(
      'Screen updated: ran showWeek on calendar → week, failed showDay on calendar. Visible: calendar (week).',
    );
    expect(note).not.toContain('secret failure detail');
  });

  test('says the layout changed when the plan is empty', () => {
    const note = describeScreenUpdate({
      executionPlan: [],
      actionOutcomes: [],
      chart: chartWithCalendar('month'),
    });

    expect(note).toBe(
      'Screen updated: layout changed. Visible: calendar (month).',
    );
  });

  test('falls back to the Instance id when the Chart lacks the Instance', () => {
    const note = describeScreenUpdate({
      executionPlan: [action('ghost-instance', 'showWeek')],
      actionOutcomes: [ok],
      chart: chartWithCalendar('month'),
    });

    expect(note).toBe(
      'Screen updated: ran showWeek on ghost-instance. Visible: calendar (month).',
    );
  });

  test('says nothing is visible when the layout shows no Instance', () => {
    const note = describeScreenUpdate({
      executionPlan: [],
      actionOutcomes: [],
      chart: makeGridRequest({ layout: { type: 'grid', positions: [] } }),
    });

    expect(note).toBe('Screen updated: layout changed. Visible: nothing.');
  });

  test('caps the note at 300 characters ending with an ellipsis', () => {
    const instanceIds = Array.from(
      { length: 40 },
      (_, index) => `item-${index}`,
    );
    const note = describeScreenUpdate({
      executionPlan: instanceIds.map((instanceId) =>
        action(instanceId, 'refresh'),
      ),
      actionOutcomes: instanceIds.map(() => ok),
      chart: makeGridRequest({
        instances: instanceIds.map((instanceId) => ({
          instanceId,
          vesselId: 'calendar',
          variant: 'month',
        })),
        layout: {
          type: 'grid',
          positions: instanceIds.map((instanceId, index) =>
            gridPosition(instanceId, index),
          ),
        },
      }),
    });

    expect(note).toHaveLength(300);
    expect(note.endsWith('…')).toBe(true);
    expect(
      note.startsWith('Screen updated: ran refresh on calendar → month'),
    ).toBe(true);
  });

  test('never includes Action parameters or Instance props', () => {
    const note = describeScreenUpdate({
      executionPlan: [
        {
          instanceId: InstanceId('calendar-main'),
          action: ActionName('showWeek'),
          params: { secretParam: 'param-value-77' },
        },
      ],
      actionOutcomes: [ok],
      chart: withInstanceProps(chartWithCalendar('week')),
    });

    expect(note).not.toContain('secretParam');
    expect(note).not.toContain('param-value-77');
    expect(note).not.toContain('secretProp');
    expect(note).not.toContain('prop-value-88');
  });
});

function withInstanceProps(chart: ChartRequest): ChartRequest {
  return {
    ...chart,
    instances: chart.instances.map((instance) => ({
      ...instance,
      props: { secretProp: 'prop-value-88' },
    })),
  } as ChartRequest;
}

function action(instanceId: string, name: string): ActionExecution {
  return { instanceId: InstanceId(instanceId), action: ActionName(name) };
}

function gridPosition(instanceId: string, column: number) {
  return {
    instanceId,
    position: { row: 0, column },
    size: { width: 1, height: 1 },
  };
}

function chartWithCalendar(variant: string) {
  return makeGridRequest({
    instances: [{ instanceId: 'calendar-main', vesselId: 'calendar', variant }],
  });
}
