import { describe, expect, test } from 'bun:test';
import type { AskCall, Evaluation } from '@maelstrom-co/planner-jev/_internal';
import {
  makeContext,
  makeInput,
  makeRequest,
  scriptedFetch,
  TEST_MODEL,
} from '@maelstrom-co/planner-jev/_testing';
import { isOk } from '@maelstrom-co/protocol';
import { typesafeClientBuilder } from './client-builder.js';
import { typesafeSettings } from './typesafe-settings.js';

const EVALUATION: Evaluation = {
  state: { request: 'hide the weather' },
  questions: {
    'gate/spatial': {
      type: 'noul',
      instructions: 'Does the user ask for a new arrangement?',
    },
  },
};

describe('the TypeSafe client builder', () => {
  test('labels its calls Jev, needs the TypeSafe keys and prints the Jev model', () => {
    const client = typesafeClientBuilder(
      typesafeSettings({ apiKey: 'typesafe-test-key', model: 'jev-pinned' }),
    );
    expect(client.provider).toBe('Jev');
    expect(client.requiredEnv).toEqual(['TYPESAFE_API_KEY', 'JEV_MODEL']);
    expect(client.meta()).toEqual({ jevModel: 'jev-pinned' });
  });

  test('reads its settings when a client is built, not when the builder is made', () => {
    let model = 'jev-before';
    const client = typesafeClientBuilder(() => ({
      apiKey: 'typesafe-test-key',
      model,
    }));
    model = 'jev-after';
    expect(client.meta()).toEqual({ jevModel: 'jev-after' });
  });

  test('reports every call its client makes to the given onCall', async () => {
    const transport = scriptedFetch(() => ({
      choices: {},
      nouls: { 'gate/spatial': 0.9 },
    }));
    const client = typesafeClientBuilder(
      typesafeSettings({
        apiKey: 'typesafe-test-key',
        model: TEST_MODEL,
        fetch: transport.fetch,
      }),
    );
    const calls: AskCall[] = [];
    const result = await client.ask((call) => calls.push(call))(
      'jevSelect',
      EVALUATION,
      makeContext(makeInput(makeRequest('hide the weather'))),
    );
    expect(isOk(result)).toBe(true);
    expect(transport.calls).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ stage: 'jevSelect', outcome: 'ok' });
    expect(typeof calls[0]?.latencyMs).toBe('number');
  });
});
