import { afterEach, describe, expect, test } from 'bun:test';

import { installMockChat, mockChat } from './__test-helpers__/mock-chat.js';
import {
  POC_CASES,
  type PocCase,
  type PocRun,
  runPocCase,
} from './__test-helpers__/poc-fixtures.js';
import { buildJevPlanner } from './jev-planner.js';
import { selectGatedScreenScope } from './stages/select-gated-screen-scope.js';
import { createJevDeps } from './stages/stage-deps.js';

installMockChat();

afterEach(() => mockChat.mockReset());

const hide = POC_CASES.find((fixture) => fixture.name === 'hide') as PocCase;
const pinned: PocRun = await Bun.file(
  new URL('./__test-helpers__/poc-evaluations/hide.json', import.meta.url),
).json();

describe('buildJevPlanner', () => {
  test('asks the screen scope questions in its select call and ships what the POC ships on a whole-screen answer', async () => {
    const run = await runPocCase(
      {
        ...hide,
        script: {
          ...hide.script,
          select: { ...hide.script.select, screen: 'whole_screen' },
        },
      },
      (options) => buildJevPlanner(createJevDeps(options)),
    );
    const questions = Object.keys(run.evaluations[0]?.questions ?? {});
    expect(questions).toContain('screen');
    expect(questions).toContain('hide/tasks-main');
    expect(run.response).toEqual(pinned.response);
    expect(run.fallbackCalls).toBe(0);
  });

  test('hides a targeted instance on an adjusting answer, as the POC does', async () => {
    const run = await runPocCase(
      {
        ...hide,
        script: {
          ...hide.script,
          select: { ...hide.script.select, screen: 'adds_or_adjusts' },
          gates: { 'hide/tasks-main': 0.9 },
        },
      },
      (options) =>
        buildJevPlanner(createJevDeps(options), {
          select: (ask) =>
            selectGatedScreenScope(ask, { spelledOutActionsGate: true }),
        }),
    );
    expect(
      JSON.stringify(run.evaluations[0]?.questions['gate/needsActions']),
    ).toContain('Add a task to pick up the dry cleaning');
    expect(run.response).toEqual(pinned.response);
  });
});
