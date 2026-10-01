import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assistantCompletionQuietIntervalMs,
  canStartNextFullScenarioInput,
  fullScenarioInterTurnPollIntervalMs,
  fullScenarioMinimumInterTurnGapMs,
  fullScenarioPostSpeechBufferMs,
  tts2micPlaybackLeadInMs,
  waitForNextFullScenarioInput,
} from './inter-turn-schedule.ts';

test('requires assistant quiet plus buffer and the source-gap deadline', () => {
  assert.equal(
    canStartNextFullScenarioInput({
      previousSourceEndMs: 0,
      nowMs: 27_000,
      assistantSilentTailMs:
        assistantCompletionQuietIntervalMs + fullScenarioPostSpeechBufferMs,
    }),
    true,
  );
  assert.equal(
    canStartNextFullScenarioInput({
      previousSourceEndMs: 0,
      nowMs: 26_999,
      assistantSilentTailMs: 10_000,
    }),
    false,
  );
  assert.equal(
    canStartNextFullScenarioInput({
      previousSourceEndMs: 0,
      nowMs: 27_000,
      assistantSilentTailMs: 2_999,
    }),
    false,
  );
  assert.equal(27_000 + tts2micPlaybackLeadInMs, fullScenarioMinimumInterTurnGapMs);
});

test('assistant output resuming during cooldown restarts quiet and buffer deadlines', async () => {
  let nowMs = 0;
  let lastAssistantOutputMs = 0;
  let assistantResumed = false;
  await waitForNextFullScenarioInput({
    previousSourceEndMs: 0,
    nowMs: () => nowMs,
    silentTailMs: () => {
      if (!assistantResumed && nowMs >= 29_000) {
        assistantResumed = true;
        lastAssistantOutputMs = nowMs;
      }
      return nowMs - lastAssistantOutputMs;
    },
    sleep: async (milliseconds) => {
      nowMs += milliseconds;
    },
  });

  assert.equal(assistantResumed, true);
  assert.ok(nowMs >= 29_000 + assistantCompletionQuietIntervalMs + fullScenarioPostSpeechBufferMs);
  assert.equal(
    canStartNextFullScenarioInput({
      previousSourceEndMs: 0,
      nowMs,
      assistantSilentTailMs: nowMs - lastAssistantOutputMs,
    }),
    true,
  );
  assert.ok(nowMs >= 27_000, 'the 3-second lead-in is included in the source-gap deadline');
  assert.ok(fullScenarioInterTurnPollIntervalMs <= 100);
});

test('does not release when the cooldown expires until the post-burst quiet buffer restarts', async () => {
  let nowMs = 0;
  let lastAssistantOutputMs = 29_000;
  await waitForNextFullScenarioInput({
    previousSourceEndMs: 0,
    nowMs: () => nowMs,
    silentTailMs: () => Math.max(0, nowMs - lastAssistantOutputMs),
    sleep: async (milliseconds) => {
      nowMs += milliseconds;
    },
  });
  assert.ok(nowMs >= 32_000);
  assert.ok(
    nowMs - lastAssistantOutputMs >=
      assistantCompletionQuietIntervalMs + fullScenarioPostSpeechBufferMs,
  );
});

test('rejects invalid schedule observations', async () => {
  assert.throws(
    () =>
      canStartNextFullScenarioInput({
        previousSourceEndMs: 0,
        nowMs: 1,
        assistantSilentTailMs: Number.NaN,
      }),
    /finite and nonnegative/,
  );
  await assert.rejects(
    () =>
      waitForNextFullScenarioInput({
        previousSourceEndMs: Number.POSITIVE_INFINITY,
        nowMs: () => 0,
        silentTailMs: () => 0,
        sleep: async () => {},
      }),
    /timestamp must be finite/,
  );
});
