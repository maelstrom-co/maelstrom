import assert from 'node:assert/strict';
import { type Page, test } from '@playwright/test';
import { computeBargeInMeasurement } from './barge-in-measurement.ts';
import {
  type BargeInObserverWindow,
  installBargeInObserver,
} from './barge-in-observer.ts';
import type { BrowserAudioTimelineSnapshot } from './shared-audio-capture.ts';
import { installSharedAudioTimeline } from './shared-audio-capture.ts';
import { createVoiceTestDriver } from './voice-test-driver.ts';

async function prepareAudioPage(
  page: Page,
  onRouteHit: () => void = () => {},
): Promise<void> {
  await page.route('http://localhost/**', async (route) => {
    onRouteHit();
    await route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><body></body></html>',
    });
  });
  await page.goto('http://localhost/');
}

function wavPcm(wav: Buffer) {
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  return {
    channels: wav.readUInt16LE(22),
    sampleRate: wav.readUInt32LE(24),
    pcm: wav.subarray(44),
  };
}

function countToneBursts(
  pcm: Buffer,
  channels: number,
  sampleRate: number,
): number {
  const frames = pcm.length / (2 * channels);
  const windowFrames = Math.max(1, Math.floor(sampleRate / 100));
  let active = false;
  let bursts = 0;
  for (let start = 0; start + windowFrames <= frames; start += windowFrames) {
    let energy = 0;
    for (let frame = start; frame < start + windowFrames; frame++) {
      for (let channel = 0; channel < channels; channel++) {
        const value = pcm.readInt16LE((frame * channels + channel) * 2) / 32768;
        energy += (value * value) / channels;
      }
    }
    const nowActive = Math.sqrt(energy / windowFrames) > 0.01;
    if (nowActive && !active) bursts++;
    active = nowActive;
  }
  return bursts;
}

function estimateTone(
  pcm: Buffer,
  channels: number,
  sampleRate: number,
): number {
  const frames = pcm.length / (2 * channels);
  let firstActive = -1;
  for (let frame = 0; frame < frames; frame++) {
    let active = false;
    for (let channel = 0; channel < channels; channel++) {
      if (Math.abs(pcm.readInt16LE((frame * channels + channel) * 2)) > 4_000) {
        active = true;
        break;
      }
    }
    if (active) {
      firstActive = frame;
      break;
    }
  }
  assert.notEqual(firstActive, -1, 'capture contains a tone');
  let prior = 0;
  let crossings = 0;
  const windowFrames = Math.floor(sampleRate / 10);
  for (
    let frame = firstActive;
    frame < Math.min(frames, firstActive + windowFrames);
    frame++
  ) {
    const sample = pcm.readInt16LE(frame * channels * 2);
    if (Math.abs(sample) < 500) continue;
    const sign = Math.sign(sample);
    if (prior && sign !== prior) crossings++;
    prior = sign;
  }
  return (crossings * sampleRate) / (2 * windowFrames);
}

test('voice driver bridges fast browser observations and removes browser hooks on disposal', async ({
  page,
}) => {
  await prepareAudioPage(page);
  await page.addInitScript(() => {
    const target = window as Window & {
      __nativeAudioPlay?: typeof HTMLMediaElement.prototype.play;
      __nativeGetUserMedia?: typeof navigator.mediaDevices.getUserMedia;
      __nativeSrcObject?: PropertyDescriptor | undefined;
    };
    target.__nativeAudioPlay = HTMLMediaElement.prototype.play;
    target.__nativeGetUserMedia = navigator.mediaDevices.getUserMedia;
    target.__nativeSrcObject = Object.getOwnPropertyDescriptor(
      HTMLMediaElement.prototype,
      'srcObject',
    );
  });
  const driver = createVoiceTestDriver(page);
  const cursor = driver.cursor();
  try {
    await driver.navigate('http://localhost/', true);
    await driver.waitForObservation((event) => event.type === 'bridge-ready', {
      after: cursor,
    });
    const beforeMutation = driver.cursor();
    await driver.evaluate('create deterministic voice UI', () => {
      const orb = document.createElement('button');
      orb.className = 'voice-orb';
      orb.setAttribute('data-state', 'idle');
      document.body.append(orb);
      const status = document.createElement('div');
      status.setAttribute('role', 'status');
      status.textContent = 'Listening';
      document.body.append(status);
      const captions = document.createElement('div');
      captions.dataset.testid = 'captions';
      const assistant = document.createElement('div');
      assistant.dataset.role = 'assistant';
      assistant.textContent = 'private transcript';
      captions.append(assistant);
      document.body.append(captions);
      orb.setAttribute('data-state', 'listening');
      status.textContent = 'Connected';
      assistant.textContent = 'private transcript';
    });
    const captionCreated = await driver.waitForObservation(
      (event) => event.type === 'captions',
      { after: beforeMutation },
    );
    const captionMutationCursor = driver.cursor();
    await driver.evaluate('mutate existing caption text node', () => {
      const text = document.querySelector(
        '[data-role="assistant"]',
      )?.firstChild;
      if (!text) throw new Error('Expected an existing caption text node');
      text.nodeValue = 'changed transcript';
    });
    const captionMutation = await driver.waitForObservation(
      (event) => event.type === 'captions',
      { after: captionMutationCursor },
    );
    assert.ok(captionMutation.sequence > captionCreated.sequence);
    const observed = await driver.waitForObservation(
      (event) => event.type === 'voice-state',
      { after: beforeMutation },
    );
    assert.equal(observed.identity.pageId, driver.pageId);
    assert.equal(observed.clock.domain, 'browser-performance');
    const evidence = JSON.stringify(await driver.evidence());
    assert.doesNotMatch(evidence, /private transcript|changed transcript/);
    const instrumented = await page.evaluate(() => {
      const target = window as Window & {
        __nativeAudioPlay?: typeof HTMLMediaElement.prototype.play;
        __nativeGetUserMedia?: typeof navigator.mediaDevices.getUserMedia;
        __nativeSrcObject?: PropertyDescriptor | undefined;
      };
      return {
        timelineInstalled: Boolean(
          (window as Window & { __voiceAudioTimeline?: unknown })
            .__voiceAudioTimeline,
        ),
        audioPlayPatched:
          HTMLMediaElement.prototype.play !== target.__nativeAudioPlay,
        getUserMediaPatched:
          navigator.mediaDevices.getUserMedia !== target.__nativeGetUserMedia,
      };
    });
    assert.deepEqual(instrumented, {
      timelineInstalled: true,
      audioPlayPatched: true,
      getUserMediaPatched: true,
    });
    const pending = driver.waitForObservation(() => false);
    const pendingRejection = assert.rejects(pending, /aborted|disposed/);
    await driver.dispose();
    await pendingRejection;
    const restored = await page.evaluate(() => {
      const target = window as Window & {
        __nativeAudioPlay?: typeof HTMLMediaElement.prototype.play;
        __nativeGetUserMedia?: typeof navigator.mediaDevices.getUserMedia;
        __nativeSrcObject?: PropertyDescriptor | undefined;
      };
      return {
        timelineRemoved: !(
          window as Window & { __voiceAudioTimeline?: unknown }
        ).__voiceAudioTimeline,
        audioPlayRestored:
          HTMLMediaElement.prototype.play === target.__nativeAudioPlay,
        getUserMediaRestored:
          navigator.mediaDevices.getUserMedia === target.__nativeGetUserMedia,
        srcObjectRestored:
          Object.getOwnPropertyDescriptor(
            HTMLMediaElement.prototype,
            'srcObject',
          )?.set === target.__nativeSrcObject?.set,
      };
    });
    assert.deepEqual(restored, {
      timelineRemoved: true,
      audioPlayRestored: true,
      getUserMediaRestored: true,
      srcObjectRestored: true,
    });
  } finally {
    await driver.dispose();
  }
});

test('patched microphone acquisition settles after disposal without recreating capture resources', async ({
  page,
}) => {
  await prepareAudioPage(page);
  await page.addInitScript(() => {
    const target = window as Window & {
      __voiceAudioContextCount?: number;
      __voiceReleaseMicrophone?: (stream: MediaStream) => void;
      __voicePendingMicrophone?: Promise<MediaStream>;
    };
    let release!: (stream: MediaStream) => void;
    const pending = new Promise<MediaStream>((resolve) => {
      release = resolve;
    });
    target.__voiceReleaseMicrophone = release;
    target.__voiceAudioContextCount = 0;
    const NativeAudioContext = window.AudioContext;
    window.AudioContext = new Proxy(NativeAudioContext, {
      construct(audioContextConstructor, args, newTarget) {
        target.__voiceAudioContextCount =
          (target.__voiceAudioContextCount ?? 0) + 1;
        return Reflect.construct(audioContextConstructor, args, newTarget);
      },
    });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      writable: true,
      value: () => pending,
    });
  });

  const driver = createVoiceTestDriver(page);
  try {
    await driver.navigate('http://localhost/', true);
    await page.evaluate(() => {
      const target = window as Window & {
        __voicePendingMicrophone?: Promise<MediaStream>;
      };
      target.__voicePendingMicrophone = navigator.mediaDevices.getUserMedia({
        audio: true,
      });
    });
    await driver.dispose();
    const result = await page.evaluate(async () => {
      const target = window as Window & {
        __voiceAudioContextCount?: number;
        __voiceReleaseMicrophone?: (stream: MediaStream) => void;
        __voicePendingMicrophone?: Promise<MediaStream>;
      };
      target.__voiceReleaseMicrophone?.(new MediaStream());
      const stream = await target.__voicePendingMicrophone;
      return {
        returnedStream: stream instanceof MediaStream,
        audioContextsCreated: target.__voiceAudioContextCount,
      };
    });
    assert.deepEqual(result, {
      returnedStream: true,
      audioContextsCreated: 0,
    });
  } finally {
    await driver.dispose();
  }
});

test('shared microphone capture accepts the same track and rejects a replacement', async ({
  page,
}) => {
  await prepareAudioPage(page);
  await page.evaluate(installSharedAudioTimeline);
  const result = await page.evaluate(async () => {
    const target = window as Window & {
      __voiceAudioTimeline?: {
        testAttachMicrophone(stream: MediaStream): Promise<void>;
      };
      __voiceAudioFailures?: unknown[];
      __voiceTestObserve?: (event: {
        readonly type: string;
        readonly source: string;
        readonly clock: number;
        readonly payload?: unknown;
      }) => Promise<void>;
    };
    target.__voiceAudioFailures = [];
    target.__voiceTestObserve = async (event) => {
      if (event.type === 'audio-capture-failure')
        target.__voiceAudioFailures?.push(event.payload);
    };
    const timeline = target.__voiceAudioTimeline;
    if (!timeline)
      throw new Error('Shared audio timeline hook was not installed');
    const producer = new AudioContext({ sampleRate: 48_000 });
    await producer.resume();
    const firstStream = producer.createMediaStreamDestination().stream;
    const firstTrack = firstStream.getAudioTracks()[0];
    const secondStream = producer.createMediaStreamDestination().stream;
    if (!firstTrack) throw new Error('First microphone track is unavailable');
    await timeline.testAttachMicrophone(firstStream);
    await timeline.testAttachMicrophone(new MediaStream([firstTrack]));
    let replacementError = '';
    try {
      await timeline.testAttachMicrophone(secondStream);
    } catch (error) {
      replacementError = String(error);
    }
    await producer.close();
    return {
      replacementError,
      failures: target.__voiceAudioFailures,
    };
  });
  assert.match(
    result.replacementError,
    /microphone-track-replaced-after-capture-attached/,
  );
  assert.deepEqual(result.failures, [
    { reason: 'microphone-track-replaced-after-capture-attached' },
  ]);
});

test('shared AudioWorklet retains distinct microphone/output tones through repeated and explicit flushes', async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(20_000);
  let routeHits = 0;
  await prepareAudioPage(page, () => routeHits++);
  await page.evaluate(installSharedAudioTimeline);
  await page.evaluate(() => {
    const button = document.createElement('button');
    button.id = 'start';
    button.textContent = 'Start deterministic audio';
    document.body.append(button);
    button.addEventListener('click', () => {
      void (async () => {
        const producer = new AudioContext({ sampleRate: 48_000 });
        await producer.resume();
        const microphone = producer.createMediaStreamDestination();
        const assistant = producer.createMediaStreamDestination();
        const silentKeepAlive = producer.createGain();
        silentKeepAlive.gain.value = 0;
        silentKeepAlive.connect(producer.destination);
        const target = window as Window & {
          __voiceAudioTimeline?: {
            waitForReady(): Promise<void>;
            mark(): Promise<number>;
            testAttachMicrophone(stream: MediaStream): Promise<void>;
          };
          __captureTestReady?: boolean;
          __captureTestError?: string;
        };
        const timeline = target.__voiceAudioTimeline;
        if (!timeline)
          throw new Error('Shared audio timeline hook was not installed');
        await timeline.testAttachMicrophone(microphone.stream);
        const audio = document.createElement('audio');
        document.body.append(audio);
        audio.srcObject = assistant.stream;
        await audio.play();
        await timeline.waitForReady();
        const firstAt = producer.currentTime + 0.25;
        const addToneBursts = (
          destination: AudioNode,
          frequency: number,
          burstOffsets: readonly number[],
        ) => {
          const frames = producer.sampleRate * 2;
          const buffer = producer.createBuffer(1, frames, producer.sampleRate);
          const samples = buffer.getChannelData(0);
          for (let frame = 0; frame < frames; frame++) {
            const time = frame / producer.sampleRate;
            const burst = burstOffsets.find(
              (offset) => time >= offset && time < offset + 0.25,
            );
            if (burst === undefined) continue;
            const withinBurst = time - burst;
            const edge = Math.min(
              1,
              withinBurst / 0.01,
              (0.25 - withinBurst) / 0.01,
            );
            samples[frame] =
              0.35 * edge * Math.sin(2 * Math.PI * frequency * withinBurst);
          }
          const source = producer.createBufferSource();
          source.buffer = buffer;
          source.connect(destination);
          source.connect(silentKeepAlive);
          source.start(firstAt);
        };
        addToneBursts(microphone, 440, [0.2, 1.1]);
        addToneBursts(assistant, 880, [0.6, 1.5]);
        target.__captureTestReady = true;
      })().catch((error: unknown) => {
        (
          window as Window & { __captureTestError?: string }
        ).__captureTestError = String(error);
      });
    });
  });
  const fixtureDiagnostics = await page.evaluate(() => ({
    title: document.title,
    readyState: document.readyState,
    secureContext: window.isSecureContext,
    path: window.location.pathname,
    audioWorkletNodeAvailable: typeof AudioWorkletNode === 'function',
    microphoneApiAvailable: Boolean(navigator.mediaDevices?.getUserMedia),
    startButtonCount: [...document.querySelectorAll('button')].filter(
      (button) => button.textContent?.trim() === 'Start deterministic audio',
    ).length,
    bodyText: document.body.innerText.slice(0, 500),
  }));
  await testInfo.attach('audio-fixture-diagnostics.json', {
    body: JSON.stringify({ routeHits, ...fixtureDiagnostics }, null, 2),
    contentType: 'application/json',
  });
  assert.equal(routeHits, 1, 'the deterministic localhost route was served');
  assert.equal(fixtureDiagnostics.startButtonCount, 1);
  await page.getByRole('button', { name: 'Start deterministic audio' }).click();
  await page.waitForFunction(() => {
    const win = window as Window & {
      __captureTestReady?: boolean;
      __captureTestError?: string;
    };
    if (win.__captureTestError) throw new Error(win.__captureTestError);
    return win.__captureTestReady === true;
  });
  const markerFrames = await page.evaluate(async () => {
    const timeline = (
      window as Window & {
        __voiceAudioTimeline?: { mark(): Promise<number> };
      }
    ).__voiceAudioTimeline;
    if (!timeline)
      throw new Error('Shared audio timeline hook was not installed');
    const first = await timeline.mark();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const second = await timeline.mark();
    return [first, second] as const;
  });
  await page.waitForTimeout(2_500);
  const snapshot = await page.evaluate(async () => {
    const timeline = (
      window as Window & {
        __voiceAudioTimeline?: {
          snapshot(): Promise<BrowserAudioTimelineSnapshot>;
        };
      }
    ).__voiceAudioTimeline;
    if (!timeline)
      throw new Error('Shared audio timeline hook was not installed');
    return timeline.snapshot();
  });
  const microphoneWav = Buffer.from(snapshot.inputWavBase64, 'base64');
  const assistantWav = Buffer.from(snapshot.assistantWavBase64, 'base64');
  await testInfo.attach('shared-audio-input.wav', {
    body: microphoneWav,
    contentType: 'audio/wav',
  });
  await testInfo.attach('shared-audio-assistant.wav', {
    body: assistantWav,
    contentType: 'audio/wav',
  });
  const microphone = wavPcm(microphoneWav);
  const assistant = wavPcm(assistantWav);
  assert.equal(snapshot.sampleRate, 48_000);
  assert.deepEqual(snapshot.playbackMarkers, markerFrames);
  assert.ok(markerFrames[0] >= snapshot.startFrame);
  assert.ok(markerFrames[1] > markerFrames[0]);
  assert.ok(markerFrames[1] <= snapshot.endFrame);
  assert.equal(microphone.sampleRate, snapshot.sampleRate);
  assert.equal(assistant.sampleRate, snapshot.sampleRate);
  assert.equal(
    snapshot.endFrame - snapshot.startFrame,
    microphone.pcm.length / (2 * microphone.channels),
  );
  assert.equal(
    snapshot.endFrame - snapshot.startFrame,
    assistant.pcm.length / (2 * assistant.channels),
  );
  assert.equal(
    snapshot.missingBlocks,
    0,
    JSON.stringify(snapshot.missingBlockReasons),
  );
  const microphoneBursts = countToneBursts(
    microphone.pcm,
    microphone.channels,
    microphone.sampleRate,
  );
  const assistantBursts = countToneBursts(
    assistant.pcm,
    assistant.channels,
    assistant.sampleRate,
  );
  assert.ok(
    microphoneBursts >= 2,
    `captured ${microphoneBursts} mic tone bursts`,
  );
  assert.ok(
    assistantBursts >= 2,
    `captured ${assistantBursts} assistant tone bursts`,
  );
  assert.ok(
    snapshot.blockCount >= 3,
    `expected two automatic flushes plus final flush, got ${snapshot.blockCount} blocks`,
  );
  const microphoneTone = estimateTone(
    microphone.pcm,
    microphone.channels,
    microphone.sampleRate,
  );
  const assistantTone = estimateTone(
    assistant.pcm,
    assistant.channels,
    assistant.sampleRate,
  );
  assert.ok(
    Math.abs(microphoneTone - 440) < 70,
    `microphone tone measured ${microphoneTone} Hz`,
  );
  assert.ok(
    Math.abs(assistantTone - 880) < 100,
    `assistant tone measured ${assistantTone} Hz`,
  );
});

test('shared audio timeline snapshots aligned tones after source tracks and context stop', async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(15_000);
  await prepareAudioPage(page);
  await page.evaluate(installSharedAudioTimeline);
  await page.evaluate(() => {
    const button = document.createElement('button');
    button.textContent = 'Start teardown capture';
    document.body.append(button);
    button.addEventListener('click', () => {
      void (async () => {
        const producer = new AudioContext({ sampleRate: 48_000 });
        await producer.resume();
        const microphone = producer.createMediaStreamDestination();
        const assistant = producer.createMediaStreamDestination();
        const keepAlive = producer.createGain();
        keepAlive.gain.value = 0;
        keepAlive.connect(producer.destination);
        const timeline = (
          window as Window & {
            __voiceAudioTimeline?: {
              testAttachMicrophone(stream: MediaStream): Promise<void>;
              waitForReady(): Promise<void>;
            };
            __stopTeardownCapture?: () => Promise<void>;
            __teardownCaptureReady?: boolean;
            __teardownCaptureError?: string;
          }
        ).__voiceAudioTimeline;
        if (!timeline)
          throw new Error('Shared audio timeline hook was not installed');
        await timeline.testAttachMicrophone(microphone.stream);
        const audio = document.createElement('audio');
        document.body.append(audio);
        audio.srcObject = assistant.stream;
        await audio.play();
        await timeline.waitForReady();
        const addTone = (destination: AudioNode, frequency: number) => {
          const buffer = producer.createBuffer(
            1,
            producer.sampleRate * 2,
            producer.sampleRate,
          );
          const samples = buffer.getChannelData(0);
          for (let frame = 0; frame < samples.length; frame++) {
            const time = frame / producer.sampleRate;
            const active =
              (time >= 0.2 && time < 0.45) || (time >= 1.1 && time < 1.35);
            if (active)
              samples[frame] = 0.35 * Math.sin(2 * Math.PI * frequency * time);
          }
          const source = producer.createBufferSource();
          source.buffer = buffer;
          source.connect(destination);
          source.connect(keepAlive);
          source.start();
        };
        addTone(microphone, 440);
        addTone(assistant, 880);
        (
          window as Window & {
            __stopTeardownCapture?: () => Promise<void>;
          }
        ).__stopTeardownCapture = async () => {
          audio.pause();
          audio.srcObject = null;
          for (const track of microphone.stream.getTracks()) track.stop();
          for (const track of assistant.stream.getTracks()) track.stop();
          await producer.close();
        };
        (
          window as Window & { __teardownCaptureReady?: boolean }
        ).__teardownCaptureReady = true;
      })().catch((error: unknown) => {
        (
          window as Window & { __teardownCaptureError?: string }
        ).__teardownCaptureError = String(error);
      });
    });
  });
  await page.getByRole('button', { name: 'Start teardown capture' }).click();
  await page.waitForFunction(() => {
    const win = window as Window & {
      __teardownCaptureReady?: boolean;
      __teardownCaptureError?: string;
    };
    if (win.__teardownCaptureError) throw new Error(win.__teardownCaptureError);
    return win.__teardownCaptureReady === true;
  });
  await page.waitForTimeout(2_500);
  await page.evaluate(async () => {
    const stop = (
      window as Window & { __stopTeardownCapture?: () => Promise<void> }
    ).__stopTeardownCapture;
    if (!stop) throw new Error('Teardown callback was not installed');
    await stop();
  });
  await page.waitForTimeout(100);
  const snapshot = await page.evaluate(async () => {
    const timeline = (
      window as Window & {
        __voiceAudioTimeline?: {
          snapshot(): Promise<BrowserAudioTimelineSnapshot>;
        };
      }
    ).__voiceAudioTimeline;
    if (!timeline)
      throw new Error('Shared audio timeline hook was not installed');
    return timeline.snapshot();
  });
  const input = Buffer.from(snapshot.inputWavBase64, 'base64');
  const assistant = Buffer.from(snapshot.assistantWavBase64, 'base64');
  const inputInfo = wavPcm(input);
  const assistantInfo = wavPcm(assistant);
  const report = {
    missingBlocks: snapshot.missingBlocks,
    missingBlockReasons: snapshot.missingBlockReasons,
    sampleRate: snapshot.sampleRate,
    startFrame: snapshot.startFrame,
    endFrame: snapshot.endFrame,
    inputFrames: inputInfo.pcm.length / (2 * inputInfo.channels),
    assistantFrames: assistantInfo.pcm.length / (2 * assistantInfo.channels),
    inputToneBursts: countToneBursts(
      inputInfo.pcm,
      inputInfo.channels,
      inputInfo.sampleRate,
    ),
    assistantToneBursts: countToneBursts(
      assistantInfo.pcm,
      assistantInfo.channels,
      assistantInfo.sampleRate,
    ),
  };
  await testInfo.attach('teardown-snapshot-probe.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
  console.log(`Teardown snapshot probe: ${JSON.stringify(report)}`);
  assert.equal(report.sampleRate, 48_000);
  assert.equal(
    report.missingBlocks,
    0,
    JSON.stringify(report.missingBlockReasons),
  );
  assert.equal(report.inputFrames, report.endFrame - report.startFrame);
  assert.equal(report.assistantFrames, report.inputFrames);
  assert.ok(report.inputToneBursts >= 2);
  assert.ok(report.assistantToneBursts >= 2);
});

test('rejects assistant stream replacement and restores media mute state', async ({
  page,
}) => {
  await prepareAudioPage(page);
  await page.evaluate(installSharedAudioTimeline);
  await page.evaluate(() => {
    const button = document.createElement('button');
    button.textContent = 'Start replacement capture';
    document.body.append(button);
    button.addEventListener('click', () => {
      void (async () => {
        const producer = new AudioContext({ sampleRate: 48_000 });
        await producer.resume();
        const microphone = producer.createMediaStreamDestination();
        const firstAssistant = producer.createMediaStreamDestination();
        const replacementAssistant = producer.createMediaStreamDestination();
        const timeline = (
          window as Window & {
            __voiceAudioTimeline?: {
              testAttachMicrophone(stream: MediaStream): Promise<void>;
              waitForReady(): Promise<void>;
            };
            __replacementCaptureResult?: {
              muted: boolean;
              error: string;
            };
          }
        ).__voiceAudioTimeline;
        if (!timeline)
          throw new Error('Shared audio timeline hook was not installed');
        await timeline.testAttachMicrophone(microphone.stream);
        const audio = document.createElement('audio');
        document.body.append(audio);
        audio.srcObject = firstAssistant.stream;
        await audio.play();
        await timeline.waitForReady();
        audio.srcObject = replacementAssistant.stream;
        let error = '';
        try {
          await timeline.waitForReady();
          await new Promise((resolve) => setTimeout(resolve, 0));
          await audio.play();
        } catch (reason) {
          error = String(reason);
        }
        (
          window as Window & {
            __replacementCaptureResult?: { muted: boolean; error: string };
          }
        ).__replacementCaptureResult = { muted: audio.muted, error };
      })();
    });
  });
  await page.getByRole('button', { name: 'Start replacement capture' }).click();
  await page.waitForFunction(
    () =>
      (
        window as Window & {
          __replacementCaptureResult?: { muted: boolean; error: string };
        }
      ).__replacementCaptureResult !== undefined,
  );
  const result = await page.evaluate(
    () =>
      (
        window as Window & {
          __replacementCaptureResult?: { muted: boolean; error: string };
        }
      ).__replacementCaptureResult,
  );
  assert.ok(result);
  assert.equal(result.muted, false);
  assert.match(
    result.error,
    /assistant-stream-replaced-after-capture-attached/,
  );
});

test('bounds snapshot readiness when the assistant stream never attaches', async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(10_000);
  await prepareAudioPage(page);
  await page.evaluate(installSharedAudioTimeline);
  await page.evaluate(() => {
    const button = document.createElement('button');
    button.textContent = 'Start microphone-only capture';
    document.body.append(button);
    button.addEventListener('click', () => {
      void (async () => {
        const producer = new AudioContext({ sampleRate: 48_000 });
        await producer.resume();
        const target = window as Window & {
          __voiceAudioTimeline?: {
            testAttachMicrophone(stream: MediaStream): Promise<void>;
            snapshot(): Promise<BrowserAudioTimelineSnapshot>;
          };
          __readinessResult?: { elapsedMs: number; message: string };
        };
        if (!target.__voiceAudioTimeline)
          throw new Error('Shared audio timeline hook was not installed');
        const microphone = producer.createMediaStreamDestination();
        await target.__voiceAudioTimeline.testAttachMicrophone(
          microphone.stream,
        );
        const start = performance.now();
        try {
          await target.__voiceAudioTimeline.snapshot();
          throw new Error('Snapshot unexpectedly succeeded without assistant');
        } catch (error) {
          target.__readinessResult = {
            elapsedMs: performance.now() - start,
            message: String(error),
          };
        } finally {
          await producer.close();
        }
      })();
    });
  });
  await page
    .getByRole('button', { name: 'Start microphone-only capture' })
    .click();
  await page.waitForFunction(
    () =>
      (window as Window & { __readinessResult?: unknown }).__readinessResult !==
      undefined,
    { timeout: 5_000 },
  );
  const result = await page.evaluate(
    () =>
      (
        window as Window & {
          __readinessResult?: { elapsedMs: number; message: string };
        }
      ).__readinessResult,
  );
  assert.ok(result);
  assert.match(result.message, /readiness timed out/);
  assert.ok(result.elapsedMs < 2_500, `timeout took ${result.elapsedMs} ms`);
});

test('barge-in uses captured PCM endpoints with bounded lifecycle corroboration', async ({
  page,
}) => {
  await prepareAudioPage(page);
  await page.evaluate(installSharedAudioTimeline);
  await page.evaluate(installBargeInObserver);
  await page.evaluate(() => {
    const button = document.createElement('button');
    button.textContent = 'Start synthetic interruption';
    document.body.append(button);
    button.addEventListener('click', () => {
      void (async () => {
        const producer = new AudioContext({ sampleRate: 48_000 });
        await producer.resume();
        const microphone = producer.createMediaStreamDestination();
        const assistant = producer.createMediaStreamDestination();
        const target = window as Window & {
          __voiceAudioTimeline?: {
            testAttachMicrophone(stream: MediaStream): Promise<void>;
            waitForReady(): Promise<void>;
          };
          __bargeInReady?: boolean;
          __bargeInError?: string;
        };
        const timeline = target.__voiceAudioTimeline;
        if (!timeline) throw new Error('Shared timeline is missing.');
        await timeline.testAttachMicrophone(microphone.stream);
        const audio = document.createElement('audio');
        document.body.append(audio);
        audio.srcObject = assistant.stream;
        await audio.play();
        await timeline.waitForReady();
        const connection = new RTCPeerConnection();
        const channel = connection.createDataChannel('oai-events');
        channel.dispatchEvent(
          new MessageEvent('message', {
            data: JSON.stringify({
              type: 'output_audio_buffer.started',
              response_id: 'synthetic-r1',
            }),
          }),
        );
        const firstAt = producer.currentTime + 0.25;
        const tone = (destination: AudioNode, start: number, stop: number) => {
          const buffer = producer.createBuffer(
            1,
            producer.sampleRate * 2,
            producer.sampleRate,
          );
          const samples = buffer.getChannelData(0);
          for (let frame = 0; frame < samples.length; frame++) {
            const time = frame / producer.sampleRate;
            if (time >= start && time < stop)
              samples[frame] = 0.35 * Math.sin(2 * Math.PI * 440 * time);
          }
          const source = producer.createBufferSource();
          source.buffer = buffer;
          source.connect(destination);
          source.start(firstAt);
        };
        tone(assistant, 0.1, 0.6);
        tone(microphone, 0.4, 0.8);
        setTimeout(() => {
          channel.dispatchEvent(
            new MessageEvent('message', {
              data: JSON.stringify({
                type: 'output_audio_buffer.cleared',
                response_id: 'synthetic-r1',
              }),
            }),
          );
          target.__bargeInReady = true;
          connection.close();
        }, 950);
      })().catch((error: unknown) => {
        (window as Window & { __bargeInError?: string }).__bargeInError =
          String(error);
      });
    });
  });
  await page
    .getByRole('button', { name: 'Start synthetic interruption' })
    .click();
  await page.waitForFunction(() => {
    const target = window as Window & {
      __bargeInReady?: boolean;
      __bargeInError?: string;
    };
    if (target.__bargeInError) throw new Error(target.__bargeInError);
    return target.__bargeInReady;
  });
  await page.waitForTimeout(1_100);
  const captured = await page.evaluate(async () => {
    const target = window as BargeInObserverWindow & {
      __voiceAudioTimeline?: {
        snapshot(): Promise<BrowserAudioTimelineSnapshot>;
        dispose(): Promise<void>;
      };
    };
    if (!target.__voiceAudioTimeline || !target.__voiceBargeInObserver)
      throw new Error('Capture hooks are missing.');
    const snapshot = await target.__voiceAudioTimeline.snapshot();
    const observation = target.__voiceBargeInObserver.snapshot();
    target.__voiceBargeInObserver.dispose();
    await target.__voiceAudioTimeline.dispose();
    return { snapshot, observation };
  });
  const input = wavPcm(Buffer.from(captured.snapshot.inputWavBase64, 'base64'));
  const output = wavPcm(
    Buffer.from(captured.snapshot.assistantWavBase64, 'base64'),
  );
  let onset = -1;
  for (
    let frame = 0;
    frame < input.pcm.length / (2 * input.channels);
    frame++
  ) {
    if (
      Math.abs(input.pcm.readInt16LE(frame * input.channels * 2)) / 32768 >=
      0.01
    ) {
      onset = frame;
      break;
    }
  }
  const result = computeBargeInMeasurement({
    assistantPcm16: output.pcm,
    assistantChannels: output.channels,
    sampleRate: captured.snapshot.sampleRate,
    humanOnsetSample: onset,
    missingBlocks: captured.snapshot.missingBlocks,
    targetResponseId: 'synthetic-r1',
    events: captured.observation.events.map((event) => ({
      ...event,
      frame: event.frame - captured.snapshot.startFrame,
    })),
    droppedEvents: captured.observation.dropped,
  });
  assert.equal(
    result.status,
    'measured',
    result.reason ?? 'Expected measured synthetic interruption.',
  );
  const latencyFrames =
    (result.assistantStopSample ?? Number.NaN) -
    (result.humanOnsetSample ?? Number.NaN);
  const nominalFrames = Math.round(captured.snapshot.sampleRate * 0.2);
  // Allow one 10ms stream buffer and one threshold-crossing PCM frame.
  const maximumDeltaFrames =
    Math.round(captured.snapshot.sampleRate * 0.01) + 1;
  assert.ok(
    Number.isSafeInteger(latencyFrames) &&
      Math.abs(latencyFrames - nominalFrames) <= maximumDeltaFrames,
    JSON.stringify(result),
  );
});

test('remote track gating silences the benchmark tap while a private probe keeps receiving audio', async ({
  page,
}) => {
  await prepareAudioPage(page);
  await page.evaluate(installSharedAudioTimeline);
  const result = await page.evaluate(async () => {
    const context = new AudioContext({ sampleRate: 48_000 });
    await context.resume();
    const timeline = (
      window as Window & {
        __voiceAudioTimeline?: {
          testAttachMicrophone(stream: MediaStream): Promise<void>;
          waitForReady(): Promise<void>;
          mark(): Promise<number>;
          snapshot(): Promise<BrowserAudioTimelineSnapshot>;
          dispose(): Promise<void>;
        };
      }
    ).__voiceAudioTimeline;
    if (!timeline) throw new Error('Missing audio timeline');
    const microphone = context.createMediaStreamDestination();
    const output = context.createMediaStreamDestination();
    const oscillator = context.createOscillator();
    oscillator.connect(output);
    oscillator.start();
    const track = output.stream.getAudioTracks()[0];
    if (!track) throw new Error('Missing output track');
    const probe = track.clone();
    const analyser = context.createAnalyser();
    context.createMediaStreamSource(new MediaStream([probe])).connect(analyser);
    await timeline.testAttachMicrophone(microphone.stream);
    const audio = new Audio();
    audio.srcObject = output.stream;
    await audio.play();
    await timeline.waitForReady();
    const wait = () => new Promise((resolve) => setTimeout(resolve, 300));
    await wait();
    const muteAt = await timeline.mark();
    track.enabled = false;
    await wait();
    const samples = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(samples);
    const probeRms = Math.sqrt(
      samples.reduce((sum, value) => sum + value * value, 0) / samples.length,
    );
    const restoreAt = await timeline.mark();
    track.enabled = true;
    await wait();
    const snapshot = await timeline.snapshot();
    oscillator.stop();
    probe.stop();
    track.stop();
    await timeline.dispose();
    await context.close();
    return { snapshot, muteAt, restoreAt, probeRms };
  });
  const captured = wavPcm(
    Buffer.from(result.snapshot.assistantWavBase64, 'base64'),
  );
  const rms = (start: number, end: number) => {
    let energy = 0;
    let samples = 0;
    for (
      let frame = start - result.snapshot.startFrame;
      frame < end - result.snapshot.startFrame;
      frame++
    ) {
      for (let channel = 0; channel < captured.channels; channel++) {
        const value =
          captured.pcm.readInt16LE((frame * captured.channels + channel) * 2) /
          32768;
        energy += value * value;
        samples++;
      }
    }
    return Math.sqrt(energy / samples);
  };
  const margin = result.snapshot.sampleRate * 0.1;
  assert.ok(rms(result.muteAt - margin, result.muteAt) > 0.1);
  assert.ok(rms(result.muteAt + margin, result.restoreAt - margin) < 0.001);
  assert.ok(
    rms(result.restoreAt + margin, result.restoreAt + margin * 2) > 0.1,
  );
  assert.ok(
    result.probeRms > 0.1,
    'probe must not mistake local muting for remote silence',
  );
});
