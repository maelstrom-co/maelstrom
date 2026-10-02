import { execFile, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect } from '@playwright/test';
import {
  selectVoiceBenchmark,
  singleTurnDiagnosticRetries,
} from '../benchmark-selection.ts';
import {
  summarizeVoiceBenchmark,
  type VoiceBenchmarkRecord,
} from './benchmark-metrics.ts';
import {
  canStartNextFullScenarioInput,
  monitorFullScenarioLeadIn,
  tts2micPlaybackLeadInMs,
  waitForAssistantResponseCompletion,
  waitForNextFullScenarioInput,
} from './inter-turn-schedule.ts';
import { startVoiceDemoFromKeylessLanding } from './key-bootstrap.ts';
import {
  getPcm16WavMetadata,
  parseCompletedPlayback,
  serializePlaybackObservation,
} from './playback-observability.ts';
import { nonSilentMs, recordReplies, silentTailMs } from './reply-recorder.ts';
import type { BrowserAudioTimelineSnapshot } from './shared-audio-capture.ts';
import {
  type AudioTimelineMeasurement,
  computeAudioTimelineMeasurement,
  humanTurnPauseMergeMs,
  mergeHumanSpeechSegments,
  type SpeechSegment,
  singleCommandSpeechEnvelope,
  vadPadding,
  vadThreshold,
} from './shared-audio-timeline.ts';
import {
  addAttemptFailure,
  analyzeSingleTurnValidity,
  attachReportAndCleanup,
  requireNonemptyFixtureVad,
  singleTurnMinimumVadCoverageRatio,
  suppressInvalidSingleTurnLatency,
  type VadValidation,
  validateVadPayload,
} from './single-turn-validity.ts';
import {
  attachVoiceBenchmarkFailureStatus,
  installAssistantCaptionMutationObserver,
  type VoiceBenchmarkFailurePhase,
} from './voice-benchmark-status.ts';
import { test } from './voice-test-fixture.ts';

const exec = promisify(execFile);
const fixture = (name: string) =>
  fileURLToPath(new URL(`../audio/${name}.wav`, import.meta.url));

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

function decodeVadPayload(stdout: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

function unsupportedLatency(reason: string): AudioTimelineMeasurement {
  return { status: 'unsupported', t0Sample: null, turns: [], reason };
}

test.describe('voice benchmark', () => {
  test.describe.configure({
    retries: singleTurnDiagnosticRetries(
      process.env.VOICE_BENCHMARK_SINGLE_TURN,
    ),
  });

  test('fixed audio scenarios', async ({ page, voiceDriver }, testInfo) => {
    const selection = selectVoiceBenchmark({
      singleTurn: process.env.VOICE_BENCHMARK_SINGLE_TURN,
      repetitions: process.env.VOICE_BENCHMARK_REPETITIONS,
    });
    const { repetitions: count, scenarios } = selection;
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
    const fixtureScenario = selection.selectedScenario ?? 'only-tasks';
    const fixtureMetadata = getPcm16WavMetadata(
      await readFile(fixture(fixtureScenario)),
    );
    const { stdout: fixtureVadStdout } = await exec(
      binary,
      [
        'vad',
        '--file',
        fixture(fixtureScenario),
        '--threshold',
        String(vadThreshold),
        '--padding',
        vadPadding,
      ],
      { encoding: 'utf8', maxBuffer: 1024 * 1024 },
    );
    const fixtureVadValidation = requireNonemptyFixtureVad(
      validateVadPayload(
        decodeVadPayload(fixtureVadStdout),
        fixtureMetadata.frameCount,
      ),
      {
        sampleRate: fixtureMetadata.sampleRate,
        channels: fixtureMetadata.channels,
      },
    );
    const fixturePreflight = {
      sampleRate: fixtureVadValidation.sampleRate,
      channels: fixtureVadValidation.channels,
      rawVADSegmentCount: fixtureVadValidation.valid
        ? fixtureVadValidation.segments.length
        : null,
      rawVADSegments: fixtureVadValidation.valid
        ? fixtureVadValidation.segments
        : null,
      validation: {
        valid: fixtureVadValidation.valid,
        reason: fixtureVadValidation.reason,
      },
    };

    const baseURL = process.env.MAELSTROM_BASE_URL || 'http://localhost:3000';
    const voiceOrb = page.locator('button.voice-orb');
    try {
      await voiceDriver.navigate(baseURL);
      await startVoiceDemoFromKeylessLanding(
        page,
        process.env.MAELSTROM_E2E_OPENAI_API_KEY,
      );
      voiceDriver.assertHealthy('voice benchmark bootstrap');
      await expect(voiceOrb).toHaveCount(1, { timeout: 30_000 });
      await expect(page.getByTestId('captions')).toBeVisible();
    } catch (error) {
      await attachVoiceBenchmarkFailureStatus(page, testInfo, {
        failurePhase: 'bootstrap',
        captionChanged: false,
        assistantOutputAudioActive: false,
        assistantOutputAudioSampleCount: 0,
      }).catch(() => {});
      voiceDriver.assertHealthy('voice benchmark bootstrap', error);
      throw error;
    }

    await installAssistantCaptionMutationObserver(page);
    const capture = recordReplies('tts2mic_rx.monitor', recordingBudgetMs);
    const records: VoiceBenchmarkRecord[] = [];
    let failures = 0;
    let audioTimeline: BrowserAudioTimelineSnapshot | undefined;
    let responseLatency = unsupportedLatency(
      'Shared browser audio timeline was not captured.',
    );
    let timelineCaptureFailed = false;
    let rawVadSegments: SpeechSegment[] | null = null;
    let capturedVadSampleRate: number | null = null;
    let capturedVadValidation: VadValidation | null = null;
    let malformedVadInput = !fixtureVadValidation.valid;
    let singleTurnFailureReason: string | null = null;
    let attemptFailed = false;
    let attemptError: unknown;
    let failurePhase: VoiceBenchmarkFailurePhase = 'realtime-connection';
    let captionChanged = false;
    let scenarioAudioStart = 0;
    let previousSourceEndMs: number | null = null;
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
      await voiceDriver.waitForAudioReady();

      const assistant = page
        .getByTestId('captions')
        .locator('[data-role="assistant"]');
      for (let repetition = 1; repetition <= count; repetition++) {
        for (const scenario of scenarios) {
          failurePhase = 'assistant-caption';
          captionChanged = false;
          let before: string[];
          let start: number;
          const sourceMetadata = getPcm16WavMetadata(
            await readFile(fixture(scenario)),
          );
          const markPlaybackStart = () => voiceDriver.markPlaybackStart();
          const assistantMonitor = (fromFrame: number) =>
            voiceDriver.assistantActivity(fromFrame);
          const assistantSilentTailMs = async () => {
            capture.check();
            return (await assistantMonitor(0)).silentTailMs;
          };
          const previousSourceEnd = previousSourceEndMs;
          const monitorBeforeNextInput =
            !selection.singleTurn && previousSourceEnd !== null;
          let timeline: number;
          let playbackStartedAt: number;
          let stdout: string | undefined;
          while (true) {
            if (monitorBeforeNextInput && previousSourceEnd !== null) {
              while (true) {
                await waitForNextFullScenarioInput({
                  previousSourceEndMs: previousSourceEnd,
                  nowMs: () => performance.now(),
                  silentTailMs: assistantSilentTailMs,
                  sleep: (milliseconds) =>
                    new Promise<void>((resolve) =>
                      setTimeout(resolve, milliseconds),
                    ),
                });
                const marker = await markPlaybackStart();
                if (
                  canStartNextFullScenarioInput({
                    previousSourceEndMs: previousSourceEnd,
                    nowMs: performance.now(),
                    assistantSilentTailMs: await assistantSilentTailMs(),
                  })
                ) {
                  before = await assistant.allTextContents();
                  start = capture.pcm().length;
                  scenarioAudioStart = start;
                  timeline = marker;
                  break;
                }
              }
            } else {
              before = await assistant.allTextContents();
              start = capture.pcm().length;
              scenarioAudioStart = start;
              timeline = await markPlaybackStart();
            }

            playbackStartedAt = performance.now();
            const playbackProcess = voiceDriver.startPlayback(
              binary,
              fixture(scenario),
              {
                delayMs: tts2micPlaybackLeadInMs,
                timeoutMs: 20_000,
                maxOutputBytes: 1024 * 1024,
              },
            );
            if (monitorBeforeNextInput) {
              try {
                await monitorFullScenarioLeadIn({
                  playbackStartedAtMs: playbackStartedAt,
                  nowMs: () => performance.now(),
                  assistantSilentTailMs,
                  sleep: (milliseconds) =>
                    new Promise<void>((resolve) =>
                      setTimeout(resolve, milliseconds),
                    ),
                  stopAndWait: async () => {
                    const stopped = await playbackProcess.stopAndWait();
                    return {
                      terminated: true,
                      closedAtMs: stopped.closedAtMs,
                      sourceNotStarted: false,
                    };
                  },
                });
              } catch (error) {
                await playbackProcess.stopAndWait();
                throw error;
              }
            }
            stdout = (await playbackProcess.completed()).stdout;
            break;
          }
          if (stdout === undefined)
            throw new Error('Playback ended without a completed result');
          const playbackCompletedAt = performance.now();
          previousSourceEndMs = playbackCompletedAt;
          const playback = parseCompletedPlayback(stdout);
          const playbackElapsedMs = playbackCompletedAt - playbackStartedAt;
          const workletEndFrame = await voiceDriver.evaluate(
            'audio:worklet-end',
            async () => {
              const timeline = (
                window as Window & {
                  __voiceAudioTimeline?: { mark(): Promise<number> };
                }
              ).__voiceAudioTimeline;
              if (!timeline)
                throw new Error('Shared audio timeline hook was not installed');
              return timeline.mark();
            },
          );
          await expect
            .poll(
              async () => {
                const now = await assistant.allTextContents();
                captionChanged =
                  now.length !== before.length ||
                  now.some((text, i) => text !== before[i]);
                return captionChanged;
              },
              { timeout: 30_000 },
            )
            .toBe(true);
          failurePhase = 'assistant-output-audio';
          if (selection.singleTurn) {
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
          } else {
            await expect
              .poll(
                async () => {
                  capture.check();
                  return (await assistantMonitor(timeline)).activeMs >= 150;
                },
                { timeout: 30_000 },
              )
              .toBe(true);
            await waitForAssistantResponseCompletion({
              activity: async () => {
                capture.check();
                return assistantMonitor(timeline);
              },
              sleep: (milliseconds) =>
                new Promise<void>((resolve) =>
                  setTimeout(resolve, milliseconds),
                ),
            });
          }
          const turnAudio = capture.pcm(start);
          records.push({
            scenario,
            repetition,
            ...serializePlaybackObservation(
              sourceMetadata,
              playback,
              playbackElapsedMs,
              timeline,
              workletEndFrame,
            ),
            assistantCapturedAudioActiveMs: nonSilentMs(turnAudio),
            measurements: {
              bargeIn: 'unsupported',
              assistantTranscriptWordCount: 'unsupported',
              assistantSpeechWpm: 'unsupported',
            },
          });
        }
      }
      voiceDriver.assertHealthy('voice benchmark scenarios completed');
    } catch (error) {
      let assistantOutputAudioActive = false;
      let assistantOutputAudioSampleCount = 0;
      try {
        const outputPcm = capture.pcm(scenarioAudioStart);
        assistantOutputAudioActive = nonSilentMs(outputPcm) >= 150;
        assistantOutputAudioSampleCount = outputPcm.length / 2;
      } catch {}
      await attachVoiceBenchmarkFailureStatus(page, testInfo, {
        failurePhase,
        captionChanged,
        assistantOutputAudioActive,
        assistantOutputAudioSampleCount,
      }).catch(() => {});
      attemptFailed = true;
      attemptError = error;
    } finally {
      try {
        audioTimeline = await voiceDriver.snapshotAudio();
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
          capturedFrames ===
            audioTimeline.endFrame - audioTimeline.startFrame &&
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
          const directory = await mkdtemp(
            join(tmpdir(), 'voice-benchmark-vad-'),
          );
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
            const vadValidation = validateVadPayload(
              decodeVadPayload(stdout),
              capturedFrames,
            );
            capturedVadValidation = vadValidation;
            if (!vadValidation.valid) {
              malformedVadInput = true;
              responseLatency = unsupportedLatency(
                'Captured VAD data failed validation.',
              );
            } else if (
              vadValidation.sampleRate !== audioTimeline.sampleRate ||
              vadValidation.channels !== input.channels
            ) {
              malformedVadInput = true;
              capturedVadValidation = {
                ...vadValidation,
                valid: false,
                reason: 'sample-clock-mismatch',
                segments: [],
              };
              responseLatency = unsupportedLatency(
                'VAD returned offsets in a format other than the captured source sample clock.',
              );
            } else {
              rawVadSegments = [...vadValidation.segments];
              capturedVadSampleRate = vadValidation.sampleRate;
              const humanTurns = selection.singleTurn
                ? singleCommandSpeechEnvelope(vadValidation.segments)
                : mergeHumanSpeechSegments(
                    vadValidation.segments,
                    audioTimeline.sampleRate,
                  );
              if (selection.singleTurn && vadValidation.segments.length === 0) {
                responseLatency = unsupportedLatency(
                  'Single-turn capture is unsupported: VAD detected no speech segments.',
                );
              } else {
                responseLatency = computeAudioTimelineMeasurement({
                  inputPcm16: input.pcm,
                  inputChannels: input.channels,
                  assistantPcm16: assistantOutput.pcm,
                  assistantChannels: assistantOutput.channels,
                  sampleRate: audioTimeline.sampleRate,
                  speechSegments: humanTurns,
                  missingBlocks: audioTimeline.missingBlocks,
                  rejectAssistantOnsetBeforeSpeechEnd: selection.singleTurn,
                });
              }
            }
          } finally {
            await rm(directory, { recursive: true, force: true });
          }
        }
      } catch (error) {
        timelineCaptureFailed = true;
        attemptFailed = true;
        attemptError ??= error;
        responseLatency = unsupportedLatency(
          'Shared audio capture or VAD failed.',
        );
      }

      const singleTurnAnalysis = selection.singleTurn
        ? analyzeSingleTurnValidity({
            latency: responseLatency,
            expected: {
              segments: fixtureVadValidation.segments,
              sampleRate: fixtureVadValidation.sampleRate,
            },
            captured:
              capturedVadValidation?.valid === true &&
              capturedVadValidation.sampleRate !== null &&
              rawVadSegments !== null &&
              capturedVadSampleRate !== null
                ? {
                    segments: rawVadSegments,
                    sampleRate: capturedVadSampleRate,
                  }
                : null,
            malformedVadInput,
            captureFailed: timelineCaptureFailed || attemptFailed,
          })
        : null;
      const coverage = singleTurnAnalysis?.coverage ?? null;
      const singleTurnValidity = singleTurnAnalysis?.validity ?? null;
      if (singleTurnAnalysis?.analysisFailed) {
        timelineCaptureFailed = true;
        responseLatency = unsupportedLatency(
          'Single-turn coverage analysis failed.',
        );
      }
      singleTurnFailureReason = selection.singleTurn
        ? (singleTurnValidity?.reasons[0] ?? null)
        : null;
      failures = addAttemptFailure(
        failures,
        attemptFailed,
        singleTurnFailureReason,
      );
      if (singleTurnFailureReason) {
        if (singleTurnValidity)
          responseLatency = suppressInvalidSingleTurnLatency(
            responseLatency,
            singleTurnValidity,
          );
      }
      const output = {
        benchmark: 'playwright-voice',
        attemptIndex: testInfo.retry,
        repetitions: count,
        mode: selection.singleTurn ? 'single-turn' : 'full-scenario-suite',
        selectedScenario: selection.selectedScenario,
        scenarios: [...scenarios],
        context: {
          baseURL: new URL(baseURL).origin,
          browser: 'chromium',
          operatingSystem: process.platform,
          latencyCapture:
            'actual injected getUserMedia microphone and the assistant WebRTC MediaStream assigned to the app HTMLAudioElement enter one 48 kHz browser AudioContext/AudioWorklet; native element output is muted and the shared graph renders the stream exactly once before the physical speaker sink',
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
            fixturePreflight,
            capturedVADValidation: capturedVadValidation
              ? {
                  valid: capturedVadValidation.valid,
                  reason: capturedVadValidation.reason,
                }
              : null,
            rawVADSegmentCount: rawVadSegments?.length ?? null,
            rawVADSegments: rawVadSegments,
            logicalHumanTurnCount: selection.singleTurn
              ? rawVadSegments === null
                ? null
                : rawVadSegments.length > 0
                  ? 1
                  : 0
              : null,
          },
          t0: selection.singleTurn
            ? 'first captured human VAD StartSample with zero VAD padding; latency baseline is the final raw VAD EndSample of the one-playback command envelope'
            : 'first human VAD StartSample with zero VAD padding; sample index relative to the captured full-session PCM',
          assistantOnsetThreshold: 0.01,
          assistantOnsetQuietMergeMs: 10,
          physicalOutputCapture:
            'separate continuous PulseAudio monitor below, retained for active-audio diagnostics; it is not used to gate full-scenario fixture scheduling',
          turnBoundary:
            'single-turn completion retains its voice UI and physical-monitor condition; full-scenario scheduling uses only the captured assistant WebRTC track; neither is used to derive response latency',
          timelineCaptureFailed,
          singleTurnDiagnostic: selection.singleTurn
            ? {
                attemptIndex: testInfo.retry,
                expectedVadActiveMs: coverage?.expectedActiveMs ?? null,
                capturedVadActiveMs: coverage?.capturedActiveMs ?? null,
                vadCoverageRatio: coverage?.coverageRatio ?? null,
                minimumVadCoverageRatio: singleTurnMinimumVadCoverageRatio,
                coverageAnalysisFailed:
                  singleTurnAnalysis?.analysisFailed ?? false,
                validity: singleTurnValidity,
                failureReason: singleTurnFailureReason,
              }
            : null,
        },
        responseLatency,
        summary: summarizeVoiceBenchmark(records, responseLatency, failures),
        records,
      };
      await testInfo
        .attach('voice-driver-before-cleanup.json', {
          body: JSON.stringify(await voiceDriver.evidence(), null, 2),
          contentType: 'application/json',
        })
        .catch(() => {});
      await attachReportAndCleanup(
        output,
        async (report) =>
          testInfo.attach('voice-benchmark.json', {
            body: JSON.stringify(report, null, 2),
            contentType: 'application/json',
          }),
        [
          async () =>
            page
              .getByRole('button', { name: 'Stop voice', exact: true })
              .click({ timeout: 1500 }),
          async () => capture.stop(),
        ],
      );
    }
    if (singleTurnFailureReason)
      throw new Error(
        `Single-turn diagnostic attempt is invalid: ${singleTurnFailureReason}`,
      );
    if (attemptFailed) throw attemptError;
  });
});
