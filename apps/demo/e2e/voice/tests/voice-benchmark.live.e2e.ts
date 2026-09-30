import { execFile, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import { initialNavigationURL } from '../runner-target.ts';
import {
  summarizeVoiceBenchmark,
  type VoiceBenchmarkRecord,
} from './benchmark-metrics.ts';
import { enterAndSubmitApiKey, hasKeyEntryControl } from './key-bootstrap.ts';
import { nonSilentMs, recordReplies, silentTailMs } from './reply-recorder.ts';
import {
  type BrowserAudioTimelineSnapshot,
  installSharedAudioTimeline,
} from './shared-audio-capture.ts';
import {
  type AudioTimelineMeasurement,
  computeAudioTimelineMeasurement,
  humanTurnPauseMergeMs,
  mergeHumanSpeechSegments,
  type SpeechSegment,
  vadPadding,
  vadThreshold,
} from './shared-audio-timeline.ts';

const exec = promisify(execFile);
const scenarios = ['only-tasks', 'open-calendar', 'put-it-back'] as const;
const fixture = (name: string) =>
  fileURLToPath(new URL(`../audio/${name}.wav`, import.meta.url));

const maxRepetitions = 3;
const perScenarioBudgetMs = 80_000;
const setupBudgetMs = 60_000;

function decodePCM16Wav(wav: Buffer) {
  if (
    wav.toString('ascii', 0, 4) !== 'RIFF' ||
    wav.toString('ascii', 8, 12) !== 'WAVE'
  )
    throw new Error('Shared timeline capture was not a RIFF/WAVE file');
  const channels = wav.readUInt16LE(22);
  const sampleRate = wav.readUInt32LE(24);
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const chunkLength = wav.readUInt32LE(offset + 4);
    if (wav.toString('ascii', offset, offset + 4) === 'data')
      return {
        channels,
        sampleRate,
        pcm: wav.subarray(offset + 8, offset + 8 + chunkLength),
      };
    offset += 8 + chunkLength + (chunkLength % 2);
  }
  throw new Error('Shared timeline capture has no WAV data chunk');
}

function decodeVadSegments(stdout: string): {
  sampleRate: number;
  channels: number;
  segments: SpeechSegment[];
} {
  const result = JSON.parse(stdout) as {
    sampleRate: number;
    channels: number;
    segments: { StartSample: number; EndSample: number }[];
  };
  return {
    sampleRate: result.sampleRate,
    channels: result.channels,
    segments: result.segments.map(({ StartSample, EndSample }) => ({
      startSample: StartSample,
      endSample: EndSample,
    })),
  };
}

function unsupportedLatency(reason: string): AudioTimelineMeasurement {
  return { status: 'unsupported', t0Sample: null, turns: [], reason };
}

test('voice benchmark: fixed audio scenarios', async ({ page }, testInfo) => {
  const count = Number(process.env.VOICE_BENCHMARK_REPETITIONS ?? '1');
  if (!Number.isInteger(count) || count < 1 || count > maxRepetitions)
    throw new Error(
      `VOICE_BENCHMARK_REPETITIONS must be an integer from 1 to ${maxRepetitions}`,
    );
  const recordingBudgetMs =
    setupBudgetMs + count * scenarios.length * perScenarioBudgetMs;
  testInfo.setTimeout(recordingBudgetMs + 15_000);
  const binary = process.env.TTS2MIC_BIN;
  if (!binary)
    throw new Error('Set TTS2MIC_BIN to the compiled tts2mic-mcp executable');
  if (process.platform !== 'linux' || !process.env.PULSE_SERVER)
    throw new Error(
      'Run this benchmark through tts2mic scripts/with-audio.sh on Linux/PulseAudio',
    );

  const binaryHelp = spawnSync(binary, ['__vadversion_probe__'], {
    encoding: 'utf8',
  });
  if (
    !`${binaryHelp.stdout ?? ''}${binaryHelp.stderr ?? ''}`.includes(
      'serve, analyze, vad,',
    )
  )
    throw new Error(
      'TTS2Mic image does not expose the VAD command; rebuild it with the approved voice-devtools change',
    );
  const vadPreflight = decodeVadSegments(
    (
      await exec(
        binary,
        [
          'vad',
          '--file',
          fixture('only-tasks'),
          '--threshold',
          String(vadThreshold),
          '--padding',
          vadPadding,
        ],
        { encoding: 'utf8', maxBuffer: 1024 * 1024 },
      )
    ).stdout,
  );
  if (vadPreflight.sampleRate <= 0 || vadPreflight.segments.length === 0)
    throw new Error(
      'TTS2Mic VAD preflight did not return source-rate speech sample offsets',
    );

  const baseURL = process.env.MAELSTROM_BASE_URL || 'http://localhost:3000';
  await page.addInitScript(installSharedAudioTimeline);
  await page.goto(initialNavigationURL(baseURL));
  const keyInput = page.locator('#playground-api-key');
  const apiKey = process.env.MAELSTROM_E2E_OPENAI_API_KEY;
  const keyControl = await hasKeyEntryControl(page);
  if ((await keyInput.isVisible().catch(() => false)) || keyControl) {
    if (!apiKey)
      throw new Error(
        'BYOK voice benchmark requires MAELSTROM_E2E_OPENAI_API_KEY',
      );
    await enterAndSubmitApiKey(page, apiKey);
  }
  const voiceOrb = page.locator('button.voice-orb');
  await expect(voiceOrb).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByTestId('captions')).toBeVisible();

  const capture = recordReplies('tts2mic_rx.monitor', recordingBudgetMs);
  const records: VoiceBenchmarkRecord[] = [];
  let failures = 0;
  let audioTimeline: BrowserAudioTimelineSnapshot | undefined;
  let responseLatency = unsupportedLatency(
    'Shared browser audio timeline was not captured.',
  );
  let timelineError: string | undefined;
  try {
    if (
      ['idle', 'error'].includes(
        (await voiceOrb.getAttribute('data-state')) ?? '',
      )
    )
      await voiceOrb.click();
    await expect(voiceOrb).toHaveAttribute(
      'data-state',
      /^(?:connected|listening|thinking|speaking)$/,
      { timeout: 30_000 },
    );
    await expect
      .poll(() => {
        capture.check();
        return capture.pcm().length;
      })
      .toBeGreaterThanOrEqual(24_000);
    await expect
      .poll(() => nonSilentMs(capture.pcm().subarray(-24_000)))
      .toBe(0);
    await page.evaluate(async () => {
      const timeline = (
        window as Window & {
          __voiceAudioTimeline?: { readonly ready: Promise<void> };
        }
      ).__voiceAudioTimeline;
      if (!timeline)
        throw new Error('Shared audio timeline hook was not installed');
      await timeline.ready;
    });

    const assistant = page
      .getByTestId('captions')
      .locator('[data-role="assistant"]');
    for (let repetition = 1; repetition <= count; repetition++) {
      for (const scenario of scenarios) {
        const before = await assistant.allTextContents();
        const start = capture.pcm().length;
        const { stdout } = await exec(
          binary,
          [
            'play',
            '--target',
            'pipewire',
            '--delay',
            '3s',
            '--file',
            fixture(scenario),
          ],
          {
            timeout: 20_000,
            encoding: 'utf8',
            killSignal: 'SIGTERM',
            maxBuffer: 1024 * 1024,
          },
        );
        expect(JSON.parse(stdout).status).toBe('completed');
        await expect
          .poll(
            async () => {
              const now = await assistant.allTextContents();
              return (
                now.length !== before.length ||
                now.some((text, i) => text !== before[i])
              );
            },
            { timeout: 30_000 },
          )
          .toBe(true);
        await expect
          .poll(
            async () => {
              capture.check();
              const state = await voiceOrb.getAttribute('data-state');
              const audio = capture.pcm(start);
              return (
                ['connected', 'listening'].includes(state ?? '') &&
                nonSilentMs(audio) >= 150 &&
                silentTailMs(audio) >= 1_000
              );
            },
            { timeout: 30_000 },
          )
          .toBe(true);
        const turnAudio = capture.pcm(start);
        records.push({
          scenario,
          repetition,
          assistantCapturedAudioActiveMs: nonSilentMs(turnAudio),
          measurements: {
            bargeIn: 'unsupported',
            assistantTranscriptWordCount: 'unsupported',
            assistantSpeechWpm: 'unsupported',
          },
        });
      }
    }
  } catch (error) {
    failures++;
    throw error;
  } finally {
    try {
      audioTimeline = await page.evaluate(async () => {
        const timeline = (
          window as Window & {
            __voiceAudioTimeline?: {
              snapshot(): Promise<BrowserAudioTimelineSnapshot>;
            };
          }
        ).__voiceAudioTimeline;
        if (!timeline)
          throw new Error('Shared audio timeline hook was not installed');
        return await timeline.snapshot();
      });
      const inputWav = Buffer.from(audioTimeline.inputWavBase64, 'base64');
      const assistantWav = Buffer.from(
        audioTimeline.assistantWavBase64,
        'base64',
      );
      await testInfo.attach('voice-benchmark-human-input-audioworklet.wav', {
        body: inputWav,
        contentType: 'audio/wav',
      });
      await testInfo.attach(
        'voice-benchmark-assistant-rendered-audioworklet.wav',
        {
          body: assistantWav,
          contentType: 'audio/wav',
        },
      );
      const input = decodePCM16Wav(inputWav);
      const assistantOutput = decodePCM16Wav(assistantWav);
      const capturedFrames = input.pcm.length / 2 / input.channels;
      const assistantFrames =
        assistantOutput.pcm.length / 2 / assistantOutput.channels;
      const aligned =
        input.sampleRate === audioTimeline.sampleRate &&
        assistantOutput.sampleRate === audioTimeline.sampleRate &&
        capturedFrames === audioTimeline.endFrame - audioTimeline.startFrame &&
        assistantFrames === capturedFrames;
      if (!aligned) {
        responseLatency = unsupportedLatency(
          'AudioWorklet capture frame counts did not validate against its shared currentFrame timeline.',
        );
      } else if (audioTimeline.missingBlocks > 0) {
        responseLatency = unsupportedLatency(
          `AudioWorklet reported ${audioTimeline.missingBlocks} missing or format-changing blocks.`,
        );
      } else {
        const directory = await mkdtemp(join(tmpdir(), 'voice-benchmark-vad-'));
        try {
          const inputPath = join(directory, 'human-input.wav');
          await writeFile(inputPath, inputWav);
          const { stdout } = await exec(
            binary,
            [
              'vad',
              '--file',
              inputPath,
              '--threshold',
              String(vadThreshold),
              '--padding',
              vadPadding,
            ],
            { timeout: 60_000, encoding: 'utf8', maxBuffer: 1024 * 1024 },
          );
          const vad = decodeVadSegments(stdout);
          if (
            vad.sampleRate !== audioTimeline.sampleRate ||
            vad.channels !== input.channels
          ) {
            responseLatency = unsupportedLatency(
              'VAD returned offsets in a format other than the captured source sample clock.',
            );
          } else {
            responseLatency = computeAudioTimelineMeasurement({
              inputPcm16: input.pcm,
              inputChannels: input.channels,
              assistantPcm16: assistantOutput.pcm,
              assistantChannels: assistantOutput.channels,
              sampleRate: audioTimeline.sampleRate,
              speechSegments: mergeHumanSpeechSegments(
                vad.segments,
                audioTimeline.sampleRate,
              ),
              missingBlocks: audioTimeline.missingBlocks,
            });
          }
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      }
    } catch (error) {
      timelineError = error instanceof Error ? error.message : String(error);
      responseLatency = unsupportedLatency(
        `Shared audio capture or VAD failed: ${timelineError}`,
      );
    }

    const output = {
      benchmark: 'playwright-voice',
      repetitions: count,
      context: {
        baseURL: new URL(baseURL).origin,
        browser: 'chromium',
        operatingSystem: process.platform,
        latencyCapture:
          'actual injected microphone and assistant media-element output in one 48 kHz browser AudioContext/AudioWorklet; assistant point is browser-rendered audio, not physical-speaker loopback',
        audioTimelineFiles: {
          humanInput: 'voice-benchmark-human-input-audioworklet.wav',
          assistantRenderedOutput:
            'voice-benchmark-assistant-rendered-audioworklet.wav',
        },
        sampleOffsetReference:
          'responseLatency turn sample indices address both attached full-session WAVs; absolute AudioContext frame = sampleClockStartFrame + sample index',
        sharedClock:
          'AudioWorklet currentFrame sample positions; human and assistant PCM are chunked from the same processor invocation and continuous session origin',
        sampleClockStartFrame: audioTimeline?.startFrame ?? null,
        sampleClockEndFrame: audioTimeline?.endFrame ?? null,
        t0SampleFrame:
          audioTimeline && responseLatency.t0Sample !== null
            ? audioTimeline.startFrame + responseLatency.t0Sample
            : null,
        audioWorkletBlockCount: audioTimeline?.blockCount ?? null,
        missingOrFormatChangingBlocks: audioTimeline?.missingBlocks ?? null,
        missingBlockReasons: audioTimeline?.missingBlockReasons ?? null,
        humanVAD: {
          command: 'voice-devtools vad',
          threshold: vadThreshold,
          padding: vadPadding,
          turnPauseMergeMs: humanTurnPauseMergeMs,
        },
        t0: 'first human VAD StartSample with zero VAD padding; sample index relative to the captured full-session PCM',
        assistantOnsetThreshold: 0.01,
        assistantOnsetQuietMergeMs: 10,
        physicalOutputCapture:
          'separate continuous PulseAudio monitor below, retained only for assistant active-audio duration; not used for response latency',
        turnBoundary:
          'voice UI and monitor silence are used only to orchestrate scenario completion; neither is used to derive latency',
        timelineError: timelineError ?? null,
      },
      responseLatency,
      summary: summarizeVoiceBenchmark(records, responseLatency, failures),
      records,
    };
    await testInfo.attach('voice-benchmark.json', {
      body: JSON.stringify(output, null, 2),
      contentType: 'application/json',
    });
    await page
      .getByRole('button', { name: 'Stop voice', exact: true })
      .click({ timeout: 1500 })
      .catch(() => {});
    await capture.stop();
    await testInfo.attach('voice-benchmark-recorder.log', {
      body: capture.diagnostics(),
      contentType: 'text/plain',
    });
  }
});
