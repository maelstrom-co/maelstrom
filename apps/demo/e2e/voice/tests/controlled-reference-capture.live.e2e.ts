import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { type Page, test } from '@playwright/test';
import {
  type ControlledReferenceWindow,
  installControlledMicrophoneReference,
} from './controlled-reference-microphone.ts';
import {
  getPcm16WavMetadata,
  parseCompletedPlayback,
} from './playback-observability.ts';
import {
  type BrowserAudioTimelineSnapshot,
  installSharedAudioTimeline,
} from './shared-audio-capture.ts';
import { vadPadding, vadThreshold } from './shared-audio-timeline.ts';
import {
  requireNonemptyFixtureVad,
  validateVadPayload,
} from './single-turn-validity.ts';

const exec = promisify(execFile);
type CaptureWindow = ControlledReferenceWindow & {
  __voiceAudioTimeline?: {
    mark(): Promise<number>;
    snapshot(): Promise<BrowserAudioTimelineSnapshot>;
    waitForReady(): Promise<void>;
    dispose(): Promise<void>;
  };
  __captureReady?: boolean;
  __captureError?: string;
};
async function prepare(page: Page) {
  await page.route('http://localhost/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><body></body>',
    }),
  );
  await page.goto('http://localhost/');
}

async function installCapture(page: Page) {
  await page.evaluate(installControlledMicrophoneReference);
  await page.evaluate(installSharedAudioTimeline, {
    microphoneSource: 'controlled-reference',
  });
}

async function startCapture(page: Page) {
  await page
    .getByRole('button', { name: 'Start reference capture', exact: true })
    .click();
  await page.waitForFunction(() => {
    const target = window as CaptureWindow;
    if (target.__captureError) throw new Error(target.__captureError);
    return target.__captureReady;
  });
}

test('reference PCM survives app-track muting without changing original acquisition', async ({
  page,
}) => {
  await prepare(page);
  await page.evaluate(() => {
    const producer = new AudioContext({ sampleRate: 48_000 });
    const app = producer.createMediaStreamDestination().stream;
    const reference = producer.createMediaStreamDestination();
    const appTrack = app.getAudioTracks()[0];
    const referenceTrack = reference.stream.getAudioTracks()[0];
    if (!appTrack || !referenceTrack)
      throw new Error('Synthetic tracks missing');
    appTrack.getSettings = () => ({
      deviceId: 'synthetic-device',
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
    referenceTrack.getSettings = () => ({
      deviceId: 'synthetic-device',
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    });
    let calls = 0;
    navigator.mediaDevices.getUserMedia = async () =>
      ++calls === 1 ? app : reference.stream;
    const button = document.createElement('button');
    button.textContent = 'Start reference capture';
    document.body.append(button);
    button.addEventListener('click', () => {
      void (async () => {
        await producer.resume();
        const returned = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        if (returned !== app) throw new Error('App stream was replaced');
        appTrack.enabled = false;
        const assistant = document.createElement('audio');
        assistant.srcObject = producer.createMediaStreamDestination().stream;
        document.body.append(assistant);
        await assistant.play();
        const timeline = (window as CaptureWindow).__voiceAudioTimeline;
        if (!timeline) throw new Error('Capture timeline missing');
        await timeline.waitForReady();
        const buffer = producer.createBuffer(
          1,
          producer.sampleRate,
          producer.sampleRate,
        );
        const samples = buffer.getChannelData(0);
        for (
          let frame = producer.sampleRate / 5;
          frame < producer.sampleRate * 0.6;
          frame++
        )
          samples[frame] =
            0.3 * Math.sin((frame * Math.PI * 880) / producer.sampleRate);
        const tone = producer.createBufferSource();
        tone.buffer = buffer;
        tone.connect(reference);
        tone.start();
        (window as CaptureWindow).__captureReady = true;
        (
          window as Window & { __referenceOwnership?: () => unknown }
        ).__referenceOwnership = () => ({
          appLive: appTrack.readyState === 'live',
          appMuted: !appTrack.enabled,
          referenceEnded: referenceTrack.readyState === 'ended',
          calls,
        });
      })().catch((error: unknown) => {
        (window as CaptureWindow).__captureError = String(error);
      });
    });
  });
  await installCapture(page);
  await startCapture(page);
  await page.waitForTimeout(1_200);
  const result = await page.evaluate(async () => {
    const target = window as CaptureWindow & {
      __referenceOwnership?: () => unknown;
    };
    if (!target.__voiceAudioTimeline || !target.__referenceOwnership)
      throw new Error('Capture missing');
    const snapshot = await target.__voiceAudioTimeline.snapshot();
    const verification = target.__voiceReferenceMicrophone?.snapshot();
    await target.__voiceAudioTimeline.dispose();
    return { snapshot, verification, ownership: target.__referenceOwnership() };
  });
  assert.equal(result.verification?.status, 'verified');
  assert.equal(result.snapshot.missingBlocks, 0);
  const pcm = Buffer.from(result.snapshot.inputWavBase64, 'base64').subarray(
    44,
  );
  let peak = 0;
  for (let offset = 0; offset < pcm.length; offset += 2)
    peak = Math.max(peak, Math.abs(pcm.readInt16LE(offset)));
  assert.ok(peak > 5_000, `Reference first burst was not retained: ${peak}`);
  assert.deepEqual(result.ownership, {
    appLive: true,
    appMuted: true,
    referenceEnded: true,
    calls: 2,
  });
});

test('unverifiable reference capture does not reject native app acquisition', async ({
  page,
}) => {
  await prepare(page);
  await page.evaluate(() => {
    const context = new AudioContext();
    const app = context.createMediaStreamDestination().stream;
    const reference = context.createMediaStreamDestination().stream;
    for (const stream of [app, reference]) {
      const track = stream.getAudioTracks()[0];
      if (!track) throw new Error('Synthetic track missing');
      track.getSettings = () => ({
        deviceId: 'synthetic-device',
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      });
    }
    let calls = 0;
    navigator.mediaDevices.getUserMedia = async () =>
      ++calls === 1 ? app : reference;
    (
      window as Window & { __referenceTestStreams?: MediaStream[] }
    ).__referenceTestStreams = [app, reference];
  });
  await installCapture(page);
  const result = await page.evaluate(async () => {
    const target = window as CaptureWindow & {
      __referenceTestStreams?: MediaStream[];
    };
    const app = await navigator.mediaDevices.getUserMedia({ audio: true });
    const original = target.__referenceTestStreams?.[0];
    const reference = target.__referenceTestStreams?.[1];
    const verification = target.__voiceReferenceMicrophone?.snapshot();
    const result = {
      verification,
      originalReturned: app === original,
      appLive: original?.getAudioTracks()[0]?.readyState === 'live',
      referenceStopped: reference?.getAudioTracks()[0]?.readyState === 'ended',
    };
    await target.__voiceAudioTimeline?.dispose();
    for (const stream of target.__referenceTestStreams ?? [])
      for (const track of stream.getTracks()) track.stop();
    return result;
  });
  assert.equal(result.verification?.reason, 'reference-dsp-unverifiable');
  assert.equal(result.originalReturned, true);
  assert.equal(result.appLive, true);
  assert.equal(result.referenceStopped, true);
});

test('Linux injected reference retains the source fixture first VAD turn', async ({
  page,
}, testInfo) => {
  const binary = process.env.TTS2MIC_BIN;
  const source = fileURLToPath(
    new URL('../audio/open-calendar.wav', import.meta.url),
  );
  test.skip(
    process.platform !== 'linux' ||
      !process.env.PULSE_SERVER ||
      !binary ||
      !existsSync(source),
    'Requires isolated Linux/PulseAudio fixture injection',
  );
  if (!binary) throw new Error('TTS2MIC_BIN missing');
  testInfo.setTimeout(60_000);
  await prepare(page);
  await installCapture(page);
  await page.evaluate(() => {
    const button = document.createElement('button');
    button.textContent = 'Start reference capture';
    document.body.append(button);
    button.addEventListener('click', () => {
      void (async () => {
        const producer = new AudioContext();
        await producer.resume();
        const app = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        const audio = document.createElement('audio');
        audio.srcObject = producer.createMediaStreamDestination().stream;
        document.body.append(audio);
        await audio.play();
        await (window as CaptureWindow).__voiceAudioTimeline?.waitForReady();
        (window as CaptureWindow).__captureReady = true;
        (
          window as Window & { __stopAppCapture?: () => Promise<void> }
        ).__stopAppCapture = async () => {
          for (const track of app.getTracks()) track.stop();
          await producer.close();
        };
      })().catch((error: unknown) => {
        (window as CaptureWindow).__captureError = String(error);
      });
    });
  });
  await startCapture(page);
  const marker = await page.evaluate(() =>
    (window as CaptureWindow).__voiceAudioTimeline?.mark(),
  );
  assert.ok(marker !== undefined);
  const startedAt = performance.now();
  const { stdout } = await exec(
    binary,
    ['play', '--target', 'pipewire', '--delay', '0s', '--file', source],
    { timeout: 20_000, maxBuffer: 1024 * 1024 },
  );
  parseCompletedPlayback(stdout);
  const elapsedMs = performance.now() - startedAt;
  await page.waitForTimeout(1_000);
  const captured = await page.evaluate(async () => {
    const target = window as CaptureWindow & {
      __stopAppCapture?: () => Promise<void>;
    };
    const snapshot = await target.__voiceAudioTimeline?.snapshot();
    const verification = target.__voiceReferenceMicrophone?.snapshot();
    await target.__voiceAudioTimeline?.dispose();
    await target.__stopAppCapture?.();
    return { snapshot, verification };
  });
  assert.equal(
    captured.verification?.status,
    'verified',
    JSON.stringify(captured.verification),
  );
  const snapshot = captured.snapshot;
  assert.ok(snapshot);
  assert.equal(snapshot.missingBlocks, 0);
  const wav = Buffer.from(snapshot.inputWavBase64, 'base64');
  await testInfo.attach('controlled-reference-human.wav', {
    body: wav,
    contentType: 'audio/wav',
  });
  const directory = await mkdtemp(join(tmpdir(), 'reference-vad-'));
  try {
    const path = join(directory, 'reference.wav');
    await writeFile(path, wav);
    const metadata = getPcm16WavMetadata(await readFile(source));
    const vad = async (path: string, frames: number) => {
      const { stdout } = await exec(
        binary,
        [
          'vad',
          '--file',
          path,
          '--threshold',
          String(vadThreshold),
          '--padding',
          vadPadding,
        ],
        { timeout: 20_000, maxBuffer: 1024 * 1024 },
      );
      return requireNonemptyFixtureVad(
        validateVadPayload(JSON.parse(stdout), frames),
      );
    };
    const expected = await vad(source, metadata.frameCount);
    const actual = await vad(path, snapshot.endFrame - snapshot.startFrame);
    const expectedOnsetMs =
      ((expected.segments[0]?.startSample ?? 0) * 1000) / expected.sampleRate;
    const observedOnsetMs =
      (((actual.segments[0]?.startSample ?? 0) -
        (marker - snapshot.startFrame)) *
        1000) /
      snapshot.sampleRate;
    const excessMs = Math.max(0, elapsedMs - metadata.durationMs);
    console.log(
      'Controlled reference onset calibration:',
      JSON.stringify({
        expectedOnsetMs,
        observedOnsetMs,
        playbackExcessMs: excessMs,
        inputAllowanceMs: 200,
      }),
    );
    await testInfo.attach('controlled-reference-onset.json', {
      body: JSON.stringify({
        verification: captured.verification,
        expectedOnsetMs,
        observedOnsetMs,
        playbackExcessMs: excessMs,
        inputAllowanceMs: 200,
        actualVAD: actual,
        fixtureVAD: expected,
      }),
      contentType: 'application/json',
    });
    assert.ok(
      observedOnsetMs >= expectedOnsetMs - 50 &&
        observedOnsetMs <= expectedOnsetMs + excessMs + 200,
      'Reference missed the fixture first speech onset; inspect attached calibration.',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
