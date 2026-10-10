import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assistantCompletionQuietIntervalMs,
  canStartNextFullScenarioInput,
  fullScenarioInterTurnPollIntervalMs,
  fullScenarioMinimumInterTurnGapMs,
  fullScenarioPostSpeechBufferMs,
  monitorFullScenarioLeadIn,
  tts2micPlaybackLeadInMs,
  waitForAssistantResponseCompletion,
  waitForNextFullScenarioInput,
} from './inter-turn-schedule.ts';

test('invalidates a lead-in cancellation without source-not-started proof', async () => {
  let stopCalls = 0;
  await assert.rejects(
    monitorFullScenarioLeadIn({
      playbackStartedAtMs: 10_000,
      nowMs: () => 10_020,
      assistantSilentTailMs: () => 0,
      sleep: async () => {},
      stopAndWait: async () => {
        stopCalls++;
        return {
          terminated: true,
          closedAtMs: 10_010,
          sourceNotStarted: false,
        };
      },
    }),
    /source onset is unverified/,
  );
  assert.equal(stopCalls, 1);
});

test('accepts a lead-in cancellation confirmed before the source deadline', async () => {
  const result = await monitorFullScenarioLeadIn({
    playbackStartedAtMs: 10_000,
    nowMs: () => 10_020,
    assistantSilentTailMs: () => 0,
    sleep: async () => {},
    stopAndWait: async () => ({
      terminated: true,
      closedAtMs: 10_030,
      sourceNotStarted: true,
    }),
  });
  assert.equal(result, 'cancelled-before-source');
});

test('does not replay when cancellation does not terminate the player', async () => {
  let stopCalls = 0;
  await assert.rejects(
    monitorFullScenarioLeadIn({
      playbackStartedAtMs: 10_000,
      nowMs: () => 10_020,
      assistantSilentTailMs: () => 0,
      sleep: async () => {},
      stopAndWait: async () => {
        stopCalls++;
        return {
          terminated: false,
          closedAtMs: Number.NaN,
          sourceNotStarted: false,
        };
      },
    }),
    /termination was not confirmed/,
  );
  assert.equal(stopCalls, 1);
});

test('monitors the full lead-in and refuses uncertain resumed-output cancellation', async () => {
  let nowMs = 0;
  let polls = 0;
  await assert.rejects(
    monitorFullScenarioLeadIn({
      playbackStartedAtMs: 0,
      nowMs: () => nowMs,
      assistantSilentTailMs: () => {
        polls++;
        return polls < 3 ? 5_000 : 0;
      },
      sleep: async (milliseconds) => {
        nowMs += milliseconds;
      },
      stopAndWait: async () => ({
        terminated: true,
        closedAtMs: nowMs + 1,
        sourceNotStarted: false,
      }),
    }),
    /source onset is unverified/,
  );
  assert.equal(polls, 3);
  assert.ok(nowMs < tts2micPlaybackLeadInMs);
});

test('lead-in cannot finish before the three-second onset deadline', async () => {
  let nowMs = 0;
  await monitorFullScenarioLeadIn({
    playbackStartedAtMs: 0,
    nowMs: () => nowMs,
    assistantSilentTailMs: () => 3_000,
    sleep: async (milliseconds) => {
      nowMs += milliseconds;
    },
    stopAndWait: async () => {
      throw new Error('quiet lead-in must not cancel playback');
    },
  });
  assert.ok(nowMs >= tts2micPlaybackLeadInMs);
});

test('does not finalize response audio until output quiet follows observed output', async () => {
  let calls = 0;
  let finalized = false;
  await waitForAssistantResponseCompletion({
    activity: () => {
      calls++;
      if (calls === 1) return { activeMs: 0, silentTailMs: 5_000 };
      if (calls === 2) return { activeMs: 180, silentTailMs: 0 };
      if (calls === 3) return { activeMs: 180, silentTailMs: 500 };
      return { activeMs: 180, silentTailMs: 1_000 };
    },
    sleep: async () => {},
  });
  finalized = true;
  assert.equal(finalized, true);
  assert.equal(calls, 4);
});

test('times out when assistant response completion is never observed', async () => {
  await assert.rejects(
    waitForAssistantResponseCompletion({
      activity: () => ({ activeMs: 0, silentTailMs: 0 }),
      sleep: (milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)),
      timeoutMs: 1,
    }),
    /Assistant response did not complete within 1 ms/,
  );
});

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
  assert.equal(
    27_000 + tts2micPlaybackLeadInMs,
    fullScenarioMinimumInterTurnGapMs,
  );
});

test('assistant output resuming during cooldown restarts quiet and buffer deadlines', async () => {
  let nowMs = 0;
  let lastAssistantOutputMs = 0;
  let assistantResumed = false;
  await waitForNextFullScenarioInput({
    previousSourceEndMs: 0,
    nowMs: () => nowMs,
    silentTailMs: () => {
      if (!assistantResumed && nowMs >= 26_000) {
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
  assert.ok(
    nowMs >=
      26_000 +
        assistantCompletionQuietIntervalMs +
        fullScenarioPostSpeechBufferMs,
  );
  assert.equal(
    canStartNextFullScenarioInput({
      previousSourceEndMs: 0,
      nowMs,
      assistantSilentTailMs: nowMs - lastAssistantOutputMs,
    }),
    true,
  );
  assert.ok(
    nowMs >= 27_000,
    'the 3-second lead-in is included in the source-gap deadline',
  );
  assert.ok(fullScenarioInterTurnPollIntervalMs <= 100);
});

test('does not release when the cooldown expires until the post-burst quiet buffer restarts', async () => {
  let nowMs = 0;
  const lastAssistantOutputMs = 29_000;
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

test('times out when the next full-scenario input gates never open', async () => {
  let nowMs = 0;
  let gateChecks = 0;
  await assert.rejects(
    waitForNextFullScenarioInput({
      previousSourceEndMs: 0,
      nowMs: () => nowMs,
      silentTailMs: () => {
        gateChecks++;
        return 0;
      },
      sleep: async (milliseconds) => {
        nowMs += milliseconds;
      },
      timeoutMs: 250,
    }),
    /Next full scenario input did not become ready within 250 ms/,
  );
  assert.equal(nowMs, 250);
  assert.ok(gateChecks > 0);
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
