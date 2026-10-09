import { afterEach, describe, expect, test } from 'bun:test';

import { installMockChat, mockChat } from '../__test-helpers__/mock-chat.js';
import {
  POC_CASES,
  type PocCase,
  runPocCase,
  runPocCaseOnDecisions,
} from '../__test-helpers__/poc-fixtures.js';
import { createJevDeps } from '../stages/stage-deps.js';
import { buildComposedPairsScreenScopePlanner } from './composed-pairs-screen-scope.js';

installMockChat();

afterEach(() => mockChat.mockReset());

const hide = POC_CASES.find((fixture) => fixture.name === 'hide') as PocCase;

describe('buildComposedPairsScreenScopePlanner', () => {
  test('asks the screen scope select and, with answerable fractions, tells the fraction questions what to answer when none is stated', async () => {
    mockChat.mockResolvedValue({ userMessage: 'Done.' });
    const run = await runPocCaseOnDecisions(
      {
        ...hide,
        request: { ...hide.request },
        script: {
          select: { 'view/tasks-main': 'hide', screen: 'whole_screen' },
          gates: { 'gate/spatial': 0.9 },
        },
      },
      (deps) =>
        buildComposedPairsScreenScopePlanner(deps, {
          spelledOutActionsGate: true,
          answerableFractions: true,
        }),
    );
    const [select] = run.evaluations;
    expect(Object.keys(select?.questions ?? {})).toContain('screen');
    expect(JSON.stringify(select?.questions['gate/needsActions'])).toContain(
      'Add a task to pick up the dry cleaning',
    );
    const layout = run.evaluations.find(
      (evaluation) => evaluation.questions['fraction_in_group/calendar-main'],
    );
    expect(
      layout?.questions['fraction_in_group/calendar-main']?.instructions,
    ).toContain('states no such fraction');
  });

  test('without options asks the shared needsActions gate and leaves the fraction questions without a default answer', async () => {
    mockChat.mockResolvedValue({ userMessage: 'Done.' });
    const run = await runPocCase(
      {
        ...hide,
        request: { ...hide.request },
        script: {
          select: { 'view/tasks-main': 'hide', screen: 'whole_screen' },
          gates: { 'gate/spatial': 0.9 },
        },
      },
      (options) => buildComposedPairsScreenScopePlanner(createJevDeps(options)),
    );
    const [select] = run.evaluations;
    expect(Object.keys(select?.questions ?? {})).toContain('screen');
    expect(
      JSON.stringify(select?.questions['gate/needsActions']),
    ).not.toContain('Add a task to pick up the dry cleaning');
    const layout = run.evaluations.find(
      (evaluation) => evaluation.questions['fraction_in_group/calendar-main'],
    );
    expect(layout).toBeDefined();
    expect(
      layout?.questions['fraction_in_group/calendar-main']?.instructions,
    ).not.toContain('states no such fraction');
  });
});
