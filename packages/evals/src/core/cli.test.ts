import { expect, test } from 'bun:test';
import {
  fakePluginWith,
  TOKYO_CANDIDATE,
} from './__test-helpers__/fake-planner.js';
import { resolveArms } from './arms.js';
import { requiredEnv } from './cli.js';

test('every run needs the OpenAI key of the adapter core builds, whatever its arms declare', () => {
  const fake = fakePluginWith({ candidate: () => TOKYO_CANDIDATE });
  expect(requiredEnv(resolveArms([fake], ['fake']))).toEqual([
    'OPENAI_API_KEY',
    'FAKE_KEY',
  ]);
  expect(
    requiredEnv(resolveArms([fake], ['fake-baseline']), ['FAKE_JUDGE_KEY']),
  ).toEqual(['OPENAI_API_KEY', 'FAKE_KEY', 'FAKE_JUDGE_KEY']);
});
