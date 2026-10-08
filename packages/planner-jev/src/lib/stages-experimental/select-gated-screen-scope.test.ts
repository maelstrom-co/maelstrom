import { describe, expect, test } from 'bun:test';

import { isOk } from '@maelstrom-co/protocol';
import {
  type Conversation,
  conversation,
} from '../__test-helpers__/actions-fixtures.js';
import {
  deferralOf,
  makeContext,
  makeInput,
  makeRequest,
} from '../__test-helpers__/fixtures.js';
import { scriptedAsk } from '../__test-helpers__/scripted-fetch.js';
import {
  type ScreenScopeOptions,
  selectGatedScreenScope,
} from './select-gated-screen-scope.js';

const QUIET_GATES = {
  'gate/needsActions': 0.1,
  'gate/generatedContent': 0.1,
  'gate/spatial': 0.1,
  'gate/dependsOnScreen': 0.1,
};

async function select(
  intent: string,
  script: Conversation,
  options: ScreenScopeOptions = {},
) {
  const { ask, calls } = scriptedAsk(conversation(script));
  const input = makeInput(makeRequest(intent));
  const result = await selectGatedScreenScope(ask, options)(
    input,
    makeContext(input),
  );
  const visible = isOk(result)
    ? result.value.instances
        .filter((instance) => instance.visible)
        .map((instance) => String(instance.instanceId))
        .sort()
    : undefined;
  return { result, visible, calls };
}

describe('selectGatedScreenScope', () => {
  test('asks the screen scope and one hide question per visible instance beside the gated questions, in one call', async () => {
    const { calls } = await select(
      'Show the map next to the current widgets.',
      {
        gates: QUIET_GATES,
      },
    );
    expect(calls).toHaveLength(1);
    const ids = Object.keys(calls[0]?.questions ?? {});
    expect(ids).toContain('scope');
    expect(ids).toContain('view/map-main');
    expect(ids).toContain('gate/needsActions');
    expect(ids).toContain('screen');
    expect(ids.filter((id) => id.startsWith('hide/'))).toEqual([
      'hide/calendar-main',
      'hide/weather-main',
      'hide/tasks-main',
    ]);
  });

  test('gives the screen scope and keep questions worked examples', async () => {
    const { calls } = await select(
      'Show the map next to the current widgets.',
      {
        gates: QUIET_GATES,
      },
    );
    const questions = calls[0]?.questions ?? {};
    expect(JSON.stringify(questions.screen)).toContain(
      'Show the map next to the current widgets',
    );
    expect(JSON.stringify(questions.screen)).toContain(
      'Just show me the calendar',
    );
    const view = JSON.stringify(questions['view/weather-main']);
    expect(view).toContain('examples');
    expect(view).toContain('Hide the weather');
  });

  test('counts showing two widgets side by side as the whole screen', async () => {
    const { calls } = await select(
      'Show the map next to the current widgets.',
      {
        gates: QUIET_GATES,
      },
    );
    const screen = JSON.stringify(calls[0]?.questions.screen);
    expect(screen).toContain(
      'Show me the forecast and my week view side by side',
    );
  });

  test("asks the gated selection's action gate and a spatial gate with arrangement words spelled out by default", async () => {
    const { calls } = await select('Add a task.', { gates: QUIET_GATES });
    const questions = calls[0]?.questions ?? {};
    expect(JSON.stringify(questions['gate/needsActions'])).not.toContain(
      'Add a task to pick up the dry cleaning',
    );
    expect(JSON.stringify(questions['gate/spatial'])).toContain(
      'swapping or reversing',
    );
  });

  test('asks the action and spatial gates with item edits and arrangement words spelled out on request', async () => {
    const { calls } = await select(
      'Add a task.',
      { gates: QUIET_GATES },
      { spelledOutActionsGate: true },
    );
    const questions = calls[0]?.questions ?? {};
    const needsActions = JSON.stringify(questions['gate/needsActions']);
    expect(needsActions).toContain(
      'adds, removes, checks, moves or edits an item',
    );
    expect(needsActions).toContain('Add a task to pick up the dry cleaning');
    expect(needsActions).toContain('Make the map larger');
    const spatial = JSON.stringify(questions['gate/spatial']);
    expect(spatial).toContain('swapping or reversing');
    expect(spatial).toContain('A city, place or address');
  });

  test('keeps an untargeted visible instance when the request adds to the screen, whatever its keep answer', async () => {
    const { visible } = await select(
      'Show the map next to the current widgets.',
      {
        select: {
          screen: 'adds_or_adjusts',
          'view/weather-main': 'hide',
          'view/map-main': 'keep',
        },
        gates: QUIET_GATES,
      },
    );
    expect(visible).toEqual([
      'calendar-main',
      'map-main',
      'tasks-main',
      'weather-main',
    ]);
  });

  test('hides a targeted visible instance when the request adjusts the screen, and keeps a delete answer', async () => {
    const { result, visible } = await select(
      'Hide the weather, delete the tasks.',
      {
        select: {
          screen: 'adds_or_adjusts',
          'view/weather-main': 'keep',
          'view/tasks-main': 'delete',
        },
        gates: {
          ...QUIET_GATES,
          'hide/weather-main': 0.9,
          'hide/tasks-main': 0.9,
        },
      },
    );
    expect(visible).toEqual(['calendar-main']);
    const decisions = isOk(result)
      ? Object.fromEntries(
          result.value.instances.map((instance) => [
            instance.instanceId,
            instance.decision,
          ]),
        )
      : {};
    expect(decisions).toMatchObject({
      'calendar-main': 'keep',
      'weather-main': 'hide',
      'tasks-main': 'delete',
    });
  });

  test('lets the keep answers decide when the request describes the whole screen', async () => {
    const { visible } = await select('Just show me the calendar.', {
      select: {
        screen: 'whole_screen',
        'view/weather-main': 'hide',
        'view/tasks-main': 'hide',
      },
      gates: QUIET_GATES,
    });
    expect(visible).toEqual(['calendar-main']);
  });

  test('defers as the gated selection does', async () => {
    const { result } = await select('Write me a poem.', {
      select: { screen: 'adds_or_adjusts' },
      gates: { ...QUIET_GATES, 'gate/generatedContent': 0.9 },
    });
    expect(deferralOf(result)).toBe('jevSelect/scope_unsupported');
  });
});
