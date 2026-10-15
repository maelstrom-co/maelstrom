import assert from 'node:assert/strict';
import { type Page, test } from '@playwright/test';
import { computeBargeInMeasurement } from './barge-in-measurement.ts';
import {
  type GreetingAudioWindow,
  installGreetingAudioTap,
} from './greeting-audio-tap.ts';
import {
  type BrowserAudioTimelineSnapshot,
  installSharedAudioTimeline,
} from './shared-audio-capture.ts';

async function prepare(page: Page) {
  await page.route('http://localhost/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><body></body>',
    }),
  );
  await page.goto('http://localhost/');
  await page.evaluate(installSharedAudioTimeline, {
    assistantSource: 'greeting',
  });
  await page.evaluate(installGreetingAudioTap);
}

for (const mode of [
  'interrupted',
  'natural',
  'extra-source',
  'unsupported-rate',
  'trailing-silence',
] as const) {
  test(`local greeting capture: ${mode}`, async ({ page }, testInfo) => {
    await prepare(page);
    await page.evaluate((mode) => {
      const button = document.createElement('button');
      button.textContent = 'Start local greeting';
      document.body.append(button);
      button.addEventListener('click', () => {
        void (async () => {
          const producer = new AudioContext({ sampleRate: 48_000 });
          const unlock = producer.createBufferSource();
          unlock.buffer = producer.createBuffer(1, 1, producer.sampleRate);
          unlock.connect(producer.destination);
          unlock.start(0);
          await producer.resume();
          if (mode === 'natural')
            await new Promise((resolve) => setTimeout(resolve, 600));
          const timeline = (
            window as Window & {
              __voiceAudioTimeline?: {
                testAttachMicrophone(stream: MediaStream): Promise<void>;
                waitForReady(): Promise<void>;
              };
            }
          ).__voiceAudioTimeline;
          if (!timeline) throw new Error('Timeline missing');
          const microphone = producer.createMediaStreamDestination();
          await timeline.testAttachMicrophone(microphone.stream);
          await timeline.waitForReady();
          const buffer = (start: number, end: number) => {
            const audio = producer.createBuffer(
              1,
              producer.sampleRate * 2,
              producer.sampleRate,
            );
            const samples = audio.getChannelData(0);
            for (let i = 0; i < samples.length; i++) {
              const time = i / producer.sampleRate;
              if (time >= start && time < end)
                samples[i] = 0.3 * Math.sin(2 * Math.PI * 440 * time);
            }
            return audio;
          };
          const assistant = producer.createBufferSource();
          assistant.buffer = buffer(
            0.05,
            mode === 'trailing-silence' ? 0.6 : 1.9,
          );
          assistant.playbackRate.value = mode === 'unsupported-rate' ? 2 : 1;
          assistant.connect(producer.destination);
          assistant.connect(producer.destination);
          const input = producer.createBufferSource();
          input.buffer = buffer(0.5, 1.1);
          input.connect(microphone);
          assistant.start(0);
          input.start(0);
          setTimeout(
            () => {
              assistant.stop();
              assistant.disconnect();
            },
            mode === 'natural' ? 2_100 : 700,
          );
          if (mode === 'extra-source')
            setTimeout(() => {
              const extra = producer.createBufferSource();
              extra.buffer = buffer(0.05, 1.9);
              extra.connect(producer.destination);
              extra.start(0);
            }, 800);
          (
            window as Window & { __greetingTestReady?: boolean }
          ).__greetingTestReady = true;
        })().catch((error: unknown) => {
          (
            window as Window & { __greetingTestError?: string }
          ).__greetingTestError = String(error);
        });
      });
    }, mode);
    await page.getByRole('button', { name: 'Start local greeting' }).click();
    await page.waitForFunction(() => {
      const target = window as Window & {
        __greetingTestReady?: boolean;
        __greetingTestError?: string;
      };
      if (target.__greetingTestError)
        throw new Error(target.__greetingTestError);
      return target.__greetingTestReady;
    });
    await page.waitForTimeout(3_100);
    const captured = await page.evaluate(async () => {
      const target = window as GreetingAudioWindow & {
        __voiceAudioTimeline?: {
          snapshot(): Promise<BrowserAudioTimelineSnapshot>;
          dispose(): Promise<void>;
        };
      };
      if (!target.__voiceAudioTimeline || !target.__voiceGreetingAudio)
        throw new Error('Capture missing');
      const snapshot = await target.__voiceAudioTimeline.snapshot();
      const observation = target.__voiceGreetingAudio.snapshot();
      target.__voiceGreetingAudio.dispose();
      await target.__voiceAudioTimeline.dispose();
      return { snapshot, observation };
    });
    const setup = captured.snapshot.setup;
    assert.ok(
      setup &&
        setup.greetingPreparedFrame !== null &&
        setup.armedFrame !== null,
    );
    assert.ok(
      setup.greetingPreparedFrame <= setup.armedFrame,
      'The greeting stream must be connected before recording starts',
    );
    assert.equal(
      setup.preparation.firstCapturedFrame,
      captured.snapshot.startFrame,
    );
    assert.ok(setup.preparation.continuousFrames >= 4_800);
    const input = Buffer.from(captured.snapshot.inputWavBase64, 'base64');
    const assistant = Buffer.from(
      captured.snapshot.assistantWavBase64,
      'base64',
    );
    const channels = input.readUInt16LE(22);
    let onset = -1;
    for (let frame = 0; frame < (input.length - 44) / (2 * channels); frame++) {
      if (
        Math.abs(input.readInt16LE(44 + frame * channels * 2)) / 32768 >=
        0.01
      ) {
        onset = frame;
        break;
      }
    }
    const observation = captured.observation;
    const naturalCase = mode === 'natural' || mode === 'trailing-silence';
    const health = captured.snapshot.missingBlockReasons;
    const rejectedFrameGaps = naturalCase && health.frameGaps > 0;
    if (naturalCase) {
      assert.equal(observation.sourceCount, 1);
      assert.equal(observation.failure, null);
      assert.notEqual(observation.startedAtFrame, null);
      assert.notEqual(observation.stoppedAtFrame, null);
      assert.equal(observation.stoppedEarly, false);
      assert.equal(health.inputFormatChanges, 0);
      assert.equal(health.assistantFormatChanges, 0);
      assert.equal(health.inputAbsentBlocks, 0);
      assert.equal(health.assistantAbsentBlocks, 0);
      assert.equal(captured.snapshot.missingBlocks, health.frameGaps);
      assert.equal(health.frameGapDetails.length, health.frameGaps);
      if (rejectedFrameGaps) {
        console.log(
          'Negative greeting frame-gap rejection:',
          JSON.stringify(health),
        );
        await testInfo.attach('negative-capture-health.json', {
          body: JSON.stringify({
            blockCount: captured.snapshot.blockCount,
            missingBlocks: captured.snapshot.missingBlocks,
            reasons: health,
            scope:
              'Capture rejected; this validates rejection safety, not clean natural-completion PCM.',
          }),
          contentType: 'application/json',
        });
      }
    }
    if (mode === 'extra-source' || mode === 'unsupported-rate') {
      // Rejected source identities/shapes must not depend on PCM integrity.
      assert.equal(
        observation.failure,
        mode === 'extra-source'
          ? 'multiple-greeting-source-candidates'
          : 'unsupported-greeting-playback-shape',
      );
      assert.equal(observation.sourceCount, mode === 'extra-source' ? 2 : 1);
    } else if (!naturalCase) {
      assert.equal(
        captured.snapshot.missingBlocks,
        0,
        JSON.stringify(captured.snapshot.missingBlockReasons),
      );
    }
    const measurement = computeBargeInMeasurement({
      assistantPcm16: assistant.subarray(44),
      assistantChannels: assistant.readUInt16LE(22),
      sampleRate: captured.snapshot.sampleRate,
      humanOnsetSample: onset,
      missingBlocks: captured.snapshot.missingBlocks,
      targetResponseId: null,
      events: [],
      droppedEvents: 0,
      greetingPlayback: {
        ...observation,
        stoppedAtSample:
          observation.stoppedAtFrame === null
            ? null
            : observation.stoppedAtFrame - captured.snapshot.startFrame,
      },
    });
    assert.equal(
      measurement.status,
      mode === 'interrupted'
        ? 'measured'
        : naturalCase && !rejectedFrameGaps
          ? 'ambiguous'
          : 'invalid',
      JSON.stringify({ measurement, observation }),
    );
    if (naturalCase) {
      assert.equal(measurement.latencyMs, null);
      assert.equal(
        measurement.reason,
        rejectedFrameGaps
          ? 'Incomplete shared-clock capture or playback evidence.'
          : 'Output became quiet without matching interruption evidence; natural completion cannot be excluded.',
      );
    }
    if (mode === 'interrupted')
      assert.ok(
        measurement.latencyMs !== null &&
          Math.abs(measurement.latencyMs - 200) < 80,
        JSON.stringify(measurement),
      );
  });
}

test('multiple unlock contexts invalidate demo-specific source identification', async ({
  page,
}) => {
  await prepare(page);
  const observation = await page.evaluate(async () => {
    const contexts = [new AudioContext(), new AudioContext()];
    for (const context of contexts) {
      await context.resume();
      const unlock = context.createBufferSource();
      unlock.buffer = context.createBuffer(1, 1, context.sampleRate);
      unlock.connect(context.destination);
      unlock.start(0);
    }
    const target = window as GreetingAudioWindow;
    const observation = target.__voiceGreetingAudio?.snapshot();
    target.__voiceGreetingAudio?.dispose();
    await Promise.all(contexts.map((context) => context.close()));
    return observation;
  });
  assert.equal(observation?.failure, 'multiple-unlock-contexts');
});

test('an unarmed greeting tap leaves native playback working and reports invalid capture', async ({
  page,
}) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const context = new AudioContext();
    await context.resume();
    const unlock = context.createBufferSource();
    unlock.buffer = context.createBuffer(1, 1, context.sampleRate);
    unlock.connect(context.destination);
    unlock.start(0);
    const greeting = context.createBufferSource();
    greeting.buffer = context.createBuffer(
      1,
      context.sampleRate,
      context.sampleRate,
    );
    greeting.connect(context.destination);
    greeting.start(0);
    let duplicateStartThrew = false;
    try {
      greeting.start(0);
    } catch {
      duplicateStartThrew = true;
    }
    const target = window as GreetingAudioWindow;
    const observation = target.__voiceGreetingAudio?.snapshot();
    const original = AudioBufferSourceNode.prototype.start;
    target.__voiceGreetingAudio?.dispose();
    const restored = AudioBufferSourceNode.prototype.start !== original;
    greeting.stop();
    await context.close();
    return { observation, duplicateStartThrew, restored };
  });
  assert.equal(result.observation?.failure, 'greeting-tap-attachment-failed');
  assert.equal(result.duplicateStartThrew, true);
  assert.equal(result.restored, true);
});
