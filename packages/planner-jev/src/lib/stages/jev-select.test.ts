import { describe, expect, test } from 'bun:test';

import { isOk } from '@maelstrom-co/protocol';

import {
  deferralOf,
  makeContext,
  makeInput,
  makeRequest,
  makeResizeRequest,
  plain,
  type RequestOptions,
  spyLogger,
} from '../__test-helpers__/fixtures.js';
import {
  type Script,
  scriptedAsk,
} from '../__test-helpers__/scripted-fetch.js';
import { jevSelect } from './jev-select.js';

const HIDDEN_BY_DEFAULT = {
  'view/map-main': 'hide',
  'view/journal-main': 'hide',
};

async function run(
  intent: string | ReturnType<typeof makeRequest>,
  script: Script,
  options: RequestOptions = {},
) {
  const { ask, calls } = scriptedAsk(script);
  const { logger, entries } = spyLogger();
  const request =
    typeof intent === 'string' ? makeRequest(intent, options) : intent;
  const input = makeInput(request);
  const result = await jevSelect(ask)(input, makeContext(input, { logger }));
  return { result, calls, entries, input };
}

describe('jevSelect', () => {
  test('grid requests defer without a call', async () => {
    const { result, calls } = await run(
      'hide the tasks',
      () => ({ choices: {} }),
      {
        layoutMode: 'grid',
      },
    );
    expect(deferralOf(result)).toBe('jevSelect/grid_mode');
    expect(calls).toHaveLength(0);
  });

  test.each([
    ['ambiguous', 'jevSelect/scope_ambiguous'],
    ['unsupported', 'jevSelect/scope_unsupported'],
  ])('scope %s defers with the info log', async (scope, reason) => {
    const { result, entries } = await run('delete that one', () => ({
      choices: { scope },
    }));
    expect(deferralOf(result)).toBe(reason);
    expect(entries).toContainEqual({
      level: 'info',
      msg: 'jev.defer',
      data: { stage: 'jevSelect', reason, question: 'scope' },
    });
  });

  test('keep, hide, delete and create map to selected instances', async () => {
    const { result, calls } = await run(
      'show the map, hide weather, drop tasks, add a journal',
      () => ({
        choices: {
          'view/calendar-main': 'keep',
          'view/weather-main': 'hide',
          'view/tasks-main': 'delete',
          'view/map-main': 'keep',
          'view/journal-main': 'hide',
          'new/journal': 'one/entry',
        },
      }),
    );
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    const byId = Object.fromEntries(
      result.value.instances.map((instance) => [instance.instanceId, instance]),
    );
    expect(byId['calendar-main']).toMatchObject({
      visible: true,
      decision: 'keep',
    });
    expect(byId['weather-main']).toMatchObject({
      visible: false,
      decision: 'hide',
    });
    expect(byId['tasks-main']).toMatchObject({
      visible: false,
      decision: 'delete',
    });
    expect(byId['map-main']).toMatchObject({ visible: true, decision: 'keep' });
    expect(plain(byId['journal-jev-1'])).toEqual({
      instanceId: 'journal-jev-1',
      vesselId: 'journal',
      variant: 'entry',
      visible: true,
      fresh: true,
      decision: 'create',
    });
    const view = calls[0]?.questions['view/weather-main'];
    expect(Object.keys(view?.criteria ?? {})).toEqual([
      'keep',
      'hide',
      'delete',
    ]);
  });

  test('existing instances keep their variant whatever the answer', async () => {
    const { result } = await run(
      'show the weekly forecast',
      () => ({ choices: HIDDEN_BY_DEFAULT }),
      { variants: { weather: 'weekly' } },
    );
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(
      String(
        result.value.instances.find((i) => i.instanceId === 'weather-main')
          ?.variant,
      ),
    ).toBe('weekly');
  });

  test('a pair creates two instances with ids that avoid existing ones', async () => {
    const request = makeRequest('two more weather widgets');
    const withTaken = {
      ...request,
      instances: [
        ...request.instances,
        { ...request.instances[1], instanceId: 'weather-jev-1' },
      ],
      layout:
        request.layout.type === 'tiling'
          ? {
              ...request.layout,
              instances: [
                ...request.layout.instances,
                { ...request.layout.instances[1], instanceId: 'weather-jev-1' },
              ],
            }
          : request.layout,
    } as typeof request;
    const { result } = await run(withTaken, () => ({
      choices: {
        ...HIDDEN_BY_DEFAULT,
        'view/weather-jev-1': 'hide',
        'new/weather': 'pair/current/weekly',
      },
    }));
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    const created = result.value.instances.filter((i) => i.fresh);
    expect(plain(created.map((i) => [i.instanceId, i.variant]))).toEqual([
      ['weather-jev-2', 'current'],
      ['weather-jev-3', 'weekly'],
    ]);
  });

  test('provider deferrals propagate with the jevSelect prefix', async () => {
    const { result } = await run('hide the tasks', () => ({ status: 503 }));
    expect(deferralOf(result)).toBe('jevSelect/provider_http');
  });

  test('records the confidence of every answer', async () => {
    const { result } = await run('keep it', () => ({
      choices: HIDDEN_BY_DEFAULT,
      confidence: 0.42,
    }));
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    const questions = result.value.answers.map((answer) => answer.question);
    expect(questions).toContain('scope');
    expect(questions).toContain('view/calendar-main');
    expect(questions).toContain('new/tasks');
    expect(result.value.answers.every((a) => a.confidence === 0.42)).toBe(true);
  });

  test('a resize turn asks the same questions and can keep everything', async () => {
    const { result, calls } = await run(makeResizeRequest(12, 20), () => ({
      choices: HIDDEN_BY_DEFAULT,
    }));
    expect(Object.keys(calls[0]?.questions ?? {})).toContain('scope');
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(
      plain(
        result.value.instances
          .filter((i) => i.visible)
          .map((i) => i.instanceId),
      ),
    ).toEqual(['calendar-main', 'weather-main', 'tasks-main']);
    expect(result.value.instances.some((i) => i.fresh)).toBe(false);
  });
});
