import { afterEach, describe, expect, test } from 'bun:test';

import {
  createEngine,
  type PlannerCandidate,
  type PlanningInput,
  type Retryable,
  type Stage,
} from '@maelstrom-co/engine';
import {
  type ChartRequest,
  ChartRequestMessage,
  isOk,
  MessageId,
  ok,
  SessionId,
} from '@maelstrom-co/protocol';

import { conversation } from '../__test-helpers__/actions-fixtures.js';
import {
  makeRequest,
  plain,
  silentLogger,
} from '../__test-helpers__/fixtures.js';
import { dummyAdapter, mockChat } from '../__test-helpers__/mock-chat.js';
import { fallbackCandidate } from '../__test-helpers__/poc-fixtures.js';
import {
  type Script,
  scriptedFetch,
  TEST_MODEL,
} from '../__test-helpers__/scripted-fetch.js';
import { jevComposedPairsPlanner } from './jev-composed-pairs.js';

afterEach(() => mockChat.mockReset());

const STACKED_REQUEST = 'stack the calendar, the weather and the tasks';

describe('jevComposedPairsPlanner through createEngine', () => {
  test('ships the tree composed from the pair answers without the fallback', async () => {
    mockChat.mockResolvedValue({ userMessage: 'Stacked.' });
    const { response, fallbackCalls, calls } = await run(
      makeRequest(STACKED_REQUEST),
      answering('above', 0.9),
    );
    expect(response?.layout.tree).toEqual([
      'H:1,1,1',
      'ID:calendar-main',
      'ID:weather-main',
      'ID:tasks-main',
    ]);
    expect(fallbackCalls).toBe(0);
    expect(calls.some(asksPairs)).toBe(true);
  });

  test('asks about the pairs even when the spatial gate answers no', async () => {
    mockChat.mockResolvedValue({ userMessage: 'Stacked.' });
    const { calls, fallbackCalls } = await run(
      makeRequest(STACKED_REQUEST),
      answering('above', 0.1),
    );
    expect(calls.some(asksPairs)).toBe(true);
    expect(fallbackCalls).toBe(0);
  });

  test('defers to the fallback when no composed tree fits the Chart', async () => {
    mockChat.mockResolvedValue({ userMessage: 'unused' });
    const { response, fallbackCalls, calls } = await run(
      makeRequest(STACKED_REQUEST, { columns: 4, rows: 4 }),
      answering('above', 0.9),
    );
    expect(calls.some(asksPairs)).toBe(true);
    expect(fallbackCalls).toBe(1);
    expect(response?.userMessage).toBe('from the fallback');
  });

  test('rejects options without a fallback stage', () => {
    expect(() =>
      jevComposedPairsPlanner({
        typesafe: { apiKey: 'typesafe-test-key', model: TEST_MODEL },
        adapter: dummyAdapter,
        fallback: undefined as never,
      }),
    ).toThrow('fallback must be a stage');
  });
});

/** Hides the map and journal, plans no actions and answers every pair question with `relation`. */
function answering(relation: string, spatial: number): Script {
  const talk = conversation({
    gates: {
      'gate/needsActions': 0.1,
      'gate/generatedContent': 0.1,
      'gate/spatial': spatial,
    },
  });
  return (payload, call) => {
    const ids = Object.keys(payload.questions);
    if (!ids.some((id) => id.startsWith('pair/'))) return talk(payload, call);
    return {
      choices: Object.fromEntries(
        ids.filter((id) => id.startsWith('pair/')).map((id) => [id, relation]),
      ),
      scores: Object.fromEntries(
        ids.filter((id) => id.startsWith('size/')).map((id) => [id, 2]),
      ),
    };
  };
}

function asksPairs(payload: { readonly questions: object }): boolean {
  return Object.keys(payload.questions).some((id) => id.startsWith('pair/'));
}

async function run(request: ChartRequest, script: Script) {
  const { fetch, calls } = scriptedFetch(script);
  let fallbackCalls = 0;
  const fallback: Stage<Retryable<PlanningInput>, PlannerCandidate> = async (
    input,
  ) => {
    fallbackCalls += 1;
    return ok(fallbackCandidate(input.request));
  };
  const engine = createEngine({
    planner: jevComposedPairsPlanner({
      typesafe: {
        apiKey: 'typesafe-test-key',
        model: TEST_MODEL,
        fetch,
        timeoutMs: 1000,
      },
      adapter: dummyAdapter,
      fallback,
    }),
    retry: false,
    logger: silentLogger,
  });
  const result = await engine.handle(
    ChartRequestMessage({
      sessionId: SessionId('jev-composed-pairs'),
      id: MessageId('turn-1'),
      request,
    }),
  );
  const response =
    isOk(result) && result.value.type === 'chart_response'
      ? (plain(result.value.response) as {
          readonly userMessage: string;
          readonly layout: { readonly tree: readonly string[] };
        })
      : undefined;
  return { response, fallbackCalls, calls };
}
