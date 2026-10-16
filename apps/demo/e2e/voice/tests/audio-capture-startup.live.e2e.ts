import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { type Page, test } from '@playwright/test';
import { computeBargeInMeasurement } from './barge-in-measurement.ts';
import {
  type AudioCaptureSetupDiagnostics,
  installSharedAudioTimeline,
} from './shared-audio-capture.ts';

type Timeline = {
  waitForReady(): Promise<void>;
  testAttachMicrophone(stream: MediaStream): Promise<void>;
  diagnostics(): AudioCaptureSetupDiagnostics;
  sampleFrame(): number | null;
  testWorkletSource(): string;
  dispose(): Promise<void>;
};
type FixtureWindow = Window & {
  __voiceAudioTimeline?: Timeline;
  __captureFixtureDone?: boolean;
  __captureFixtureError?: string;
  __captureFixtureReadyEvents?: number;
  __captureFixtureFailureProbe?: {
    readinessError: string;
    reattachmentError: string;
    sourceNodes: number;
    failureEvents: number;
  };
  __voiceTestObserve?: (event: { type: string }) => Promise<void>;
};

async function prepare(page: Page) {
  await page.route('http://localhost/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><body></body>',
    }),
  );
  await page.goto('http://localhost/');
  await page.evaluate(() => {
    const target = window as FixtureWindow;
    target.__captureFixtureReadyEvents = 0;
    target.__voiceTestObserve = async (event) => {
      if (event.type === 'audio-capture-ready')
        target.__captureFixtureReadyEvents =
          (target.__captureFixtureReadyEvents ?? 0) + 1;
    };
  });
}

function simulate(source: string) {
  type Message = {
    armed?: boolean;
    assistantMonitorResponse?: number;
    activeMs?: number;
    frame?: number;
    length?: number;
    clockResets?: number;
    formatResets?: number;
    continuousFrames?: number;
  };
  type Processor = {
    port: { onmessage(event: { data: unknown }): void };
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
  };
  const messages: Message[] = [];
  const factory: { ctor?: new () => Processor } = {};
  const scope = {
    currentFrame: 0,
    sampleRate: 48_000,
    AudioWorkletProcessor: class {
      port = {
        onmessage: (_event: { data: unknown }) => {},
        postMessage: (data: Message) => messages.push(data),
      };
    },
    registerProcessor: (_name: string, ctor: new () => Processor) => {
      factory.ctor = ctor;
    },
  };
  runInNewContext(source, scope);
  assert.ok(factory.ctor);
  const recorder = new factory.ctor();
  let nextFrame = 0;
  return {
    messages,
    send: (data: unknown) => recorder.port.onmessage({ data }),
    step({
      gap = 0,
      microphone = true,
      assistant = true,
      microphoneChannels = 1,
      assistantChannels = 1,
      amplitude = 0.25,
    } = {}) {
      nextFrame += gap;
      scope.currentFrame = nextFrame;
      const output = [new Float32Array(128), new Float32Array(128)];
      recorder.process(
        [
          microphone
            ? Array.from({ length: microphoneChannels }, () =>
                new Float32Array(128).fill(amplitude * 2),
              )
            : [],
          assistant
            ? Array.from({ length: assistantChannels }, () =>
                new Float32Array(128).fill(amplitude),
              )
            : [],
        ],
        [output],
      );
      nextFrame += 128;
      return output;
    },
  };
}

test('connected-input preparation rejects pre-start instability but never clears post-start gaps', async ({
  page,
}) => {
  await prepare(page);
  await page.evaluate(installSharedAudioTimeline);
  const source = await page.evaluate(() =>
    (window as FixtureWindow).__voiceAudioTimeline?.testWorkletSource(),
  );
  assert.ok(source);
  const model = simulate(source);
  model.send('microphone-connected');
  model.send('assistant-connected');
  model.send('arm');
  for (let i = 0; i < 16; i++) {
    const output = model.step();
    assert.ok(
      output[0]?.every((sample) => sample === 0.25),
      'Remote output must pass through before capture readiness',
    );
  }
  assert.equal(model.messages.filter((message) => message.armed).length, 0);
  model.send({ assistantMonitorRequest: 1, fromFrame: 0 });
  assert.equal(
    model.messages.find((message) => message.assistantMonitorResponse === 1)
      ?.activeMs,
    0,
  );
  model.step({ gap: 128 });
  for (
    let i = 0;
    i < 40 && !model.messages.some((message) => message.armed);
    i++
  )
    model.step();
  const armed = model.messages.find((message) => message.armed);
  assert.ok(armed && armed.frame !== undefined);
  assert.equal(armed.clockResets, 1);
  assert.ok((armed.continuousFrames ?? 0) >= 4_800);
  model.step({ gap: 128 });
  model.send('arm');
  model.step();
  model.send('flush');
  assert.equal(
    model.messages.filter((message) => message.armed).length,
    1,
    'Recording must enter once only',
  );
  const blocks = model.messages.filter(
    (message): message is { frame: number; length: number } =>
      message.length !== undefined && message.frame !== undefined,
  );
  assert.ok(blocks.length >= 2);
  const gaps = blocks
    .slice(1)
    .filter(
      (block, index) =>
        block.frame !==
        (blocks[index]?.frame ?? 0) + (blocks[index]?.length ?? 0),
    );
  assert.equal(
    gaps.length,
    1,
    'A post-start discontinuity must remain in captured block coordinates',
  );
  const measurement = computeBargeInMeasurement({
    assistantPcm16: Buffer.alloc(48_000 * 2),
    assistantChannels: 1,
    sampleRate: 48_000,
    humanOnsetSample: 8_000,
    missingBlocks: gaps.length,
    targetResponseId: null,
    events: [],
    droppedEvents: 0,
  });
  assert.equal(measurement.status, 'invalid');
  assert.equal(measurement.latencyMs, null);
});

test('preparation requires stable supported inputs but accepts complete silence', async ({
  page,
}) => {
  await prepare(page);
  await page.evaluate(installSharedAudioTimeline);
  const source = await page.evaluate(() =>
    (window as FixtureWindow).__voiceAudioTimeline?.testWorkletSource(),
  );
  assert.ok(source);
  const absent = simulate(source);
  absent.send('microphone-connected');
  absent.send('assistant-connected');
  absent.send('arm');
  for (let i = 0; i < 100; i++) absent.step({ assistant: false });
  assert.equal(
    absent.messages.some((message) => message.armed),
    false,
  );
  const silent = simulate(source);
  silent.send('microphone-connected');
  silent.send('assistant-connected');
  silent.send('arm');
  for (let i = 0; i < 16; i++) silent.step({ amplitude: 0 });
  silent.step({ amplitude: 0, assistantChannels: 2 });
  for (let i = 0; i < 40; i++)
    silent.step({ amplitude: 0, assistantChannels: 2 });
  const armed = silent.messages.find((message) => message.armed);
  assert.ok(armed);
  assert.equal(armed.formatResets, 1);
  assert.ok((armed.continuousFrames ?? 0) >= 4_800);
});

async function createFixture(page: Page, failureObservationMs = 0) {
  await page.evaluate((failureObservationMs) => {
    const button = document.createElement('button');
    button.textContent = 'Initialize capture';
    document.body.append(button);
    button.addEventListener('click', () => {
      void (async () => {
        const producer = new AudioContext();
        await producer.resume();
        const timeline = (window as FixtureWindow).__voiceAudioTimeline;
        if (!timeline) throw new Error('Timeline missing');
        try {
          await timeline.testAttachMicrophone(
            producer.createMediaStreamDestination().stream,
          );
          const audio = document.createElement('audio');
          document.body.append(audio);
          audio.srcObject = producer.createMediaStreamDestination().stream;
          await audio.play();
          await timeline.waitForReady();
        } catch (error) {
          if (failureObservationMs > 0)
            await new Promise((resolve) =>
              setTimeout(resolve, failureObservationMs),
            );
          throw error;
        } finally {
          await producer.close();
        }
        (window as FixtureWindow).__captureFixtureDone = true;
      })().catch((error: unknown) => {
        (window as FixtureWindow).__captureFixtureError = String(error);
      });
    });
  }, failureObservationMs);
  await page.getByRole('button', { name: 'Initialize capture' }).click();
  await page.waitForFunction(() => {
    const target = window as FixtureWindow;
    return target.__captureFixtureDone || target.__captureFixtureError;
  });
  const result = await page.evaluate(() => ({
    done: (window as FixtureWindow).__captureFixtureDone ?? false,
    error: (window as FixtureWindow).__captureFixtureError ?? null,
    setup: (window as FixtureWindow).__voiceAudioTimeline?.diagnostics(),
    frame:
      (window as FixtureWindow).__voiceAudioTimeline?.sampleFrame() ?? null,
    readyEvents: (window as FixtureWindow).__captureFixtureReadyEvents ?? 0,
  }));
  await page.evaluate(() =>
    (window as FixtureWindow).__voiceAudioTimeline?.dispose(),
  );
  return result;
}

test('cold processor startup waits for the warm acknowledgment, not a one-second assumption', async ({
  page,
}) => {
  await prepare(page);
  await page.evaluate(() => {
    const Native = AudioWorkletNode;
    window.AudioWorkletNode = new Proxy(Native, {
      construct(target, args, newTarget) {
        const node: AudioWorkletNode = Reflect.construct(
          target,
          args,
          newTarget,
        );
        let delayed = false;
        node.port.addEventListener('message', (event) => {
          if (event.data?.warmed && !delayed) {
            delayed = true;
            event.stopImmediatePropagation();
            setTimeout(
              () =>
                node.port.dispatchEvent(
                  new MessageEvent('message', { data: event.data }),
                ),
              1_300,
            );
          }
        });
        return node;
      },
    });
  });
  await page.evaluate(installSharedAudioTimeline);
  const result = await createFixture(page);
  assert.equal(result.done, true, result.error ?? 'Capture did not initialize');
  assert.equal(result.setup?.stage, 'recording');
  assert.equal(result.readyEvents, 1);
  assert.notEqual(result.frame, null);
  assert.equal(result.setup?.errorName, null);
  assert.ok((result.setup?.preparation.continuousFrames ?? 0) >= 4_800);
});

test('input preparation has one bounded deadline and cannot publish readiness after cancellation', async ({
  page,
}) => {
  await prepare(page);
  await page.evaluate(() => {
    const Native = AudioWorkletNode;
    window.AudioWorkletNode = new Proxy(Native, {
      construct(target, args, newTarget) {
        const node: AudioWorkletNode = Reflect.construct(
          target,
          args,
          newTarget,
        );
        const nativePost = node.port.postMessage.bind(node.port);
        node.port.postMessage = (message, transfer) => {
          if (message !== 'arm')
            nativePost(message, transfer as Transferable[]);
        };
        return node;
      },
    });
  });
  await page.evaluate(installSharedAudioTimeline, {
    preparationTimeoutMs: 200,
  });
  const result = await createFixture(page);
  assert.equal(result.done, false);
  assert.match(result.error ?? '', /audio-input-preparation-timeout/);
  assert.equal(result.readyEvents, 0);
  assert.equal(result.frame, null);
  assert.equal(result.setup?.preparation.timedOut, true);
  assert.equal(result.setup?.preparation.firstCapturedFrame, null);
});

test('late recording acknowledgment preserves post-start gaps without reviving timed-out readiness', async ({
  page,
}) => {
  await prepare(page);
  await page.evaluate(() => {
    const Native = AudioWorkletNode;
    window.AudioWorkletNode = new Proxy(Native, {
      construct(target, args, newTarget) {
        const node: AudioWorkletNode = Reflect.construct(
          target,
          args,
          newTarget,
        );
        const nativePost = node.port.postMessage.bind(node.port);
        node.port.postMessage = (message, transfer) => {
          nativePost(message, transfer as Transferable[]);
          if (message === 'arm') {
            setTimeout(() => nativePost('flush'), 180);
            setTimeout(() => nativePost('flush'), 500);
          }
        };
        let withheld = false;
        let replaying = false;
        let blockCount = 0;
        node.port.addEventListener('message', (event) => {
          if (replaying) return;
          if (event.data?.armed && !withheld) {
            withheld = true;
            event.stopImmediatePropagation();
            setTimeout(
              () =>
                node.port.dispatchEvent(
                  new MessageEvent('message', { data: event.data }),
                ),
              900,
            );
          } else if (
            typeof event.data?.length === 'number' &&
            ++blockCount > 1
          ) {
            event.stopImmediatePropagation();
            replaying = true;
            try {
              node.port.dispatchEvent(
                new MessageEvent('message', {
                  data: { ...event.data, frame: event.data.frame + 128 },
                }),
              );
            } finally {
              replaying = false;
            }
          }
        });
        return node;
      },
    });
  });
  await page.evaluate(installSharedAudioTimeline, {
    preparationTimeoutMs: 300,
  });
  const result = await createFixture(page, 1_100);
  assert.equal(result.done, false);
  assert.match(result.error ?? '', /audio-input-preparation-timeout/);
  assert.equal(result.readyEvents, 0);
  assert.equal(result.frame, null);
  assert.equal(result.setup?.preparation.timedOut, true);
  assert.notEqual(result.setup?.preparation.firstCapturedFrame, null);
  assert.ok((result.setup?.recording.receivedBlocks ?? 0) >= 2);
  assert.ok((result.setup?.recording.missingBlockReasons.frameGaps ?? 0) >= 1);
  assert.ok((result.setup?.recording.missingBlocks ?? 0) >= 1);
});

for (const greetingHook of ['absent', 'unprepared'] as const) {
  test(`missing greeting stream fails readiness before connecting sources: ${greetingHook}`, async ({
    page,
  }) => {
    await prepare(page);
    await page.evaluate(installSharedAudioTimeline, {
      assistantSource: 'greeting',
    });
    await page.evaluate((greetingHook) => {
      const target = window as FixtureWindow & {
        __voiceGreetingAudio?: { captureStream(): MediaStream | null };
      };
      if (greetingHook === 'unprepared')
        target.__voiceGreetingAudio = { captureStream: () => null };
      const timeline = target.__voiceAudioTimeline;
      if (!timeline) throw new Error('Timeline missing');
      let sourceNodes = 0;
      let failureEvents = 0;
      const observe = target.__voiceTestObserve;
      target.__voiceTestObserve = async (event) => {
        if (event.type === 'audio-capture-failure') failureEvents++;
        await observe?.(event);
      };
      const nativeSource = AudioContext.prototype.createMediaStreamSource;
      AudioContext.prototype.createMediaStreamSource = function (stream) {
        sourceNodes++;
        return nativeSource.call(this, stream);
      };
      const attach = timeline.testAttachMicrophone;
      const rejection = (operation: Promise<void>) =>
        operation.then(
          () => 'resolved',
          (error: unknown) => String(error),
        );
      timeline.testAttachMicrophone = async (stream) => {
        try {
          await attach(stream);
        } catch (error) {
          const readinessError = await rejection(timeline.waitForReady());
          const reattachmentError = await rejection(attach(stream));
          target.__captureFixtureFailureProbe = {
            readinessError,
            reattachmentError,
            sourceNodes,
            failureEvents,
          };
          throw error;
        }
      };
    }, greetingHook);
    const result = await createFixture(page);
    const probe = await page.evaluate(
      () => (window as FixtureWindow).__captureFixtureFailureProbe,
    );
    assert.equal(result.done, false);
    assert.match(result.error ?? '', /greeting-stream-unprepared/);
    assert.equal(probe?.readinessError, result.error);
    assert.equal(probe?.reattachmentError, result.error);
    assert.equal(probe?.sourceNodes, 0);
    assert.equal(probe?.failureEvents, 1);
    assert.equal(result.readyEvents, 0);
    assert.equal(result.frame, null);
    assert.equal(result.setup?.greetingPreparedFrame, null);
    assert.equal(result.setup?.preparation.requestedFrame, null);
    assert.equal(result.setup?.preparation.timedOut, false);
  });
}

test('initialization failures preserve a bounded stage and error category', async ({
  page,
}) => {
  await prepare(page);
  await page.evaluate(() => {
    window.AudioWorkletNode = new Proxy(AudioWorkletNode, {
      construct() {
        throw new DOMException(
          'sensitive device detail must not be logged',
          'NotSupportedError',
        );
      },
    });
  });
  await page.evaluate(installSharedAudioTimeline);
  const result = await createFixture(page);
  assert.equal(result.done, false);
  assert.match(result.error ?? '', /construct-recorder:NotSupportedError/);
  assert.doesNotMatch(JSON.stringify(result), /sensitive device detail/);
  assert.equal(result.setup?.stage, 'construct-recorder');
  assert.equal(result.setup?.errorName, 'NotSupportedError');
});
