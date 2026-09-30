import assert from 'node:assert/strict';
import { test } from '@playwright/test';
import type { BrowserAudioTimelineSnapshot } from './shared-audio-capture.ts';
import { installSharedAudioTimeline } from './shared-audio-capture.ts';

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

test('shared AudioWorklet retains distinct microphone/output tones through repeated and explicit flushes', async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(20_000);
  await page.goto('/');
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
        const silentKeepAlive = producer.createGain();
        silentKeepAlive.gain.value = 0;
        silentKeepAlive.connect(producer.destination);
        const target = window as Window & {
          __voiceAudioTimeline?: {
            waitForReady(): Promise<void>;
            testAttachMicrophone(stream: MediaStream): Promise<void>;
          };
          __captureTestReady?: boolean;
          __captureTestError?: string;
        };
        const timeline = target.__voiceAudioTimeline;
        if (!timeline)
          throw new Error('Shared audio timeline hook was not installed');
        await timeline.testAttachMicrophone(microphone.stream);
        const assistantFrames = producer.sampleRate * 2;
        const assistantPcm = new Uint8Array(assistantFrames * 2);
        const assistantSamples = new DataView(assistantPcm.buffer);
        for (let frame = 0; frame < assistantFrames; frame++) {
          const time = frame / producer.sampleRate;
          const burst = [0.6, 1.5].find(
            (offset) => time >= offset && time < offset + 0.25,
          );
          if (burst === undefined) continue;
          const withinBurst = time - burst;
          const edge = Math.min(
            1,
            withinBurst / 0.01,
            (0.25 - withinBurst) / 0.01,
          );
          assistantSamples.setInt16(
            frame * 2,
            Math.round(
              0.35 * edge * Math.sin(2 * Math.PI * 880 * withinBurst) * 32767,
            ),
            true,
          );
        }
        const assistantWav = new Uint8Array(44 + assistantPcm.length);
        const assistantHeader = new DataView(assistantWav.buffer);
        const writeTag = (offset: number, text: string) => {
          for (let i = 0; i < text.length; i++)
            assistantWav[offset + i] = text.charCodeAt(i);
        };
        writeTag(0, 'RIFF');
        assistantHeader.setUint32(4, assistantWav.length - 8, true);
        writeTag(8, 'WAVEfmt ');
        assistantHeader.setUint32(16, 16, true);
        assistantHeader.setUint16(20, 1, true);
        assistantHeader.setUint16(22, 1, true);
        assistantHeader.setUint32(24, producer.sampleRate, true);
        assistantHeader.setUint32(28, producer.sampleRate * 2, true);
        assistantHeader.setUint16(32, 2, true);
        assistantHeader.setUint16(34, 16, true);
        writeTag(36, 'data');
        assistantHeader.setUint32(40, assistantPcm.length, true);
        assistantWav.set(assistantPcm, 44);
        const sourceAudio = document.createElement('audio');
        sourceAudio.src = URL.createObjectURL(
          new Blob([assistantWav], { type: 'audio/wav' }),
        );
        document.body.append(sourceAudio);
        await sourceAudio.play();
        const assistantStream = (
          sourceAudio as HTMLAudioElement & { captureStream(): MediaStream }
        ).captureStream();
        if (assistantStream.getAudioTracks().length === 0)
          throw new Error(
            'Assistant source audio exposed no MediaStream track',
          );
        const audio = document.createElement('audio');
        audio.autoplay = true;
        document.body.append(audio);
        audio.srcObject = assistantStream;
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
        target.__captureTestReady = true;
      })().catch((error: unknown) => {
        (
          window as Window & { __captureTestError?: string }
        ).__captureTestError = String(error);
      });
    });
  });
  await page.getByRole('button', { name: 'Start deterministic audio' }).click();
  await page.waitForFunction(() => {
    const win = window as Window & {
      __captureTestReady?: boolean;
      __captureTestError?: string;
    };
    if (win.__captureTestError) throw new Error(win.__captureTestError);
    return win.__captureTestReady === true;
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

test('bounds snapshot readiness when the assistant stream never attaches', async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(10_000);
  await page.goto('/');
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
