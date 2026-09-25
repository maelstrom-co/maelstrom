import { describe, expect, test } from 'bun:test';

import { type Scenario, scenarios } from '../../core/scenarios.js';
import { scoreActions, scoreSelection } from './score.js';

function scenario(id: string): Scenario {
  const found = scenarios.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no scenario ${id}`);
  return found;
}

describe('stage scores', () => {
  test('selection compares visible and retained sets', () => {
    const hide = scenario('hide');
    const selection = {
      input: { request: hide.request },
      answers: [],
      instances: hide.request.instances.map((instance) => ({
        ...instance,
        fresh: false,
        visible: ['calendar-main', 'tasks-main'].includes(instance.instanceId),
        decision: 'keep',
      })),
    } as never;
    expect(scoreSelection(hide, selection)?.pass).toBe(true);
  });

  test('actions count a pending slot the expectation has a value for, and asks', () => {
    const capital = scenario('se-capital');
    const pending = {
      actions: [
        {
          instanceId: 'weather-main',
          action: 'setLocation',
          params: {},
          pending: [{ name: 'location', type: 'string', description: 'x' }],
        },
      ],
      asks: [],
    } as never;
    expect(scoreActions(capital, pending)?.pass).toBe(true);
    const addTask = scenario('ns-add-task');
    const asked = {
      actions: [],
      asks: [
        {
          instanceId: 'tasks-main',
          action: 'addTask',
          parameter: { name: 'title', type: 'string', description: 'x' },
        },
      ],
    } as never;
    expect(scoreActions(addTask, asked)?.pass).toBe(true);
    expect(
      scoreActions(addTask, { actions: [], asks: [] } as never)?.pass,
    ).toBe(false);
  });
});
