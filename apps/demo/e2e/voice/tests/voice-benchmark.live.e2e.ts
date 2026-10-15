import { execFile, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
  bargeInPolicy,
  computeBargeInMeasurement,
  invalidBargeIn,
} from './barge-in-measurement.ts';
import {
  type BargeInObserverSnapshot,
  type BargeInObserverWindow,
  installBargeInObserver,
} from './barge-in-observer.ts';
import { assessBargeInRun, completeBargeInReport } from './barge-in-report.ts';
import {
  selectRealtimeBeforeVoiceConnection,
  waitForFixedGreetingSettlement,
} from './barge-in-setup.ts';
import {
  summarizeVoiceBenchmark,
  type VoiceBenchmarkRecord,
} from './benchmark-metrics.ts';
import type {
  ControlledReferenceObservation,
  ControlledReferenceWindow,
} from './controlled-reference-microphone.ts';
import type {
  GreetingAudioObservation,
  GreetingAudioWindow,
} from './greeting-audio-tap.ts';
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
import {
  nonSilentMs,
  recordReplies,
  replyWav,
  silentTailMs,
} from './reply-recorder.ts';
import type {
  AudioCaptureSetupDiagnostics,
  BrowserAudioTimelineSnapshot,
} from './shared-audio-capture.ts';
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
  sampleTaskBargeInGate,
  type TaskBargeInGate,
} from './task-barge-in-gate.ts';
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
      timeout: 60_000,
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
      {
        timeout: 60_000,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
      },
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
              let leadInResult: Awaited<
                ReturnType<typeof monitorFullScenarioLeadIn>
              >;
              try {
                leadInResult = await monitorFullScenarioLeadIn({
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
                      sourceNotStarted:
                        stopped.closedAtMs <
                        playbackStartedAt + tts2micPlaybackLeadInMs,
                    };
                  },
                });
              } catch (error) {
                await playbackProcess.stopAndWait();
                throw error;
              }
              if (leadInResult === 'cancelled-before-source')
                throw new Error(
                  'Assistant output resumed during playback lead-in; playback will not be replayed',
                );
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
          captureInitialization: {
            revision: 2,
            setup: audioTimeline?.setup ?? null,
          },
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
      try {
        const evidence = await voiceDriver.evidence();
        await testInfo.attach('voice-driver-before-cleanup.json', {
          body: JSON.stringify(evidence, null, 2),
          contentType: 'application/json',
        });
      } catch {}
      try {
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
      } catch (error) {
        attemptFailed = true;
        attemptError ??= error;
      }
    }
    if (attemptFailed) throw attemptError;
    if (singleTurnFailureReason)
      throw new Error(
        `Single-turn diagnostic attempt is invalid: ${singleTurnFailureReason}`,
      );
  });

  for (const scenario of ['task-response', 'greeting'] as const) {
    test.describe(`${scenario} barge-in`, () => {
      const isGreeting = scenario === 'greeting';
      test.use({
        assistantSource: isGreeting ? 'greeting' : 'remote',
        microphoneSource: 'controlled-reference',
      });
      test('prerecorded barge-in interruptions', async ({
        page,
        voiceDriver,
      }, testInfo) => {
        const selection = selectVoiceBenchmark({
          singleTurn: process.env.VOICE_BENCHMARK_SINGLE_TURN,
          repetitions: process.env.VOICE_BENCHMARK_REPETITIONS,
        });
        test.skip(
          selection.singleTurn,
          'Single-turn diagnostics retain exactly one playback.',
        );
        testInfo.setTimeout(
          setupBudgetMs + selection.repetitions * perScenarioBudgetMs,
        );
        const binary = process.env.TTS2MIC_BIN;
        if (
          !binary ||
          process.platform !== 'linux' ||
          !process.env.PULSE_SERVER
        )
          throw new Error(
            'Run through the Linux/PulseAudio benchmark container with TTS2MIC_BIN.',
          );
        if (!isGreeting) await page.addInitScript(installBargeInObserver);
        const prefix = isGreeting ? 'greeting-barge-in' : 'barge-in';
        const records: VoiceBenchmarkRecord[] = [];
        const attempts: unknown[] = [];
        let infrastructureError: unknown;
        const baseURL =
          process.env.MAELSTROM_BASE_URL || 'http://localhost:3000';
        for (
          let repetition = 1;
          repetition <= selection.repetitions;
          repetition++
        ) {
          let measurement = invalidBargeIn('Interruption was not captured.');
          let audioTimeline: BrowserAudioTimelineSnapshot | undefined;
          let captureSetup: AudioCaptureSetupDiagnostics | undefined;
          let observation: BargeInObserverSnapshot = { events: [], dropped: 0 };
          let targetResponseId: string | null = null;
          const taskGate: { value: TaskBargeInGate | null } = { value: null };
          let greetingSettledBeforePrimer = false;
          let startFrame: number | null = null;
          let endFrame: number | null = null;
          let playbackObservation = {};
          let assistantActiveMs = 0;
          let greetingPlayback: GreetingAudioObservation | undefined;
          let referenceCapture: ControlledReferenceObservation | undefined;
          let fixtureVad: VadValidation | null = null;
          let capturedVad: VadValidation | null = null;
          let selectedOnsetSample: number | null = null;
          let playbackWindow: {
            startSample: number;
            endSample: number;
          } | null = null;
          let fixtureSha256: string | null = null;
          let followupCapture: 'not-requested' | 'quiet' | 'timeout' =
            'not-requested';
          const speakerCapture = isGreeting
            ? recordReplies(
                'tts2mic_rx.monitor',
                setupBudgetMs + perScenarioBudgetMs,
              )
            : undefined;
          try {
            const sourceWav = await readFile(fixture('open-calendar'));
            const sourceMetadata = getPcm16WavMetadata(sourceWav);
            fixtureSha256 = createHash('sha256')
              .update(sourceWav)
              .digest('hex');
            await testInfo.attach(`${prefix}-${repetition}-fixture.wav`, {
              body: sourceWav,
              contentType: 'audio/wav',
            });
            const { stdout: sourceVadStdout } = await exec(
              binary,
              [
                'vad',
                '--file',
                fixture('open-calendar'),
                '--threshold',
                String(vadThreshold),
                '--padding',
                vadPadding,
              ],
              { timeout: 60_000, encoding: 'utf8', maxBuffer: 1024 * 1024 },
            );
            fixtureVad = validateVadPayload(
              decodeVadPayload(sourceVadStdout),
              sourceMetadata.frameCount,
            );
            requireNonemptyFixtureVad(fixtureVad, sourceMetadata);
            await voiceDriver.navigate(baseURL);
            await selectRealtimeBeforeVoiceConnection(page);
            await startVoiceDemoFromKeylessLanding(
              page,
              process.env.MAELSTROM_E2E_OPENAI_API_KEY,
            );
            await expect(
              page.getByRole('combobox', {
                name: 'Voice provider',
                exact: true,
              }),
            ).toHaveValue('realtime');
            const orb = page.locator('button.voice-orb');
            await expect(orb).toHaveCount(1, { timeout: 30_000 });
            if (
              ['idle', 'error'].includes(
                (await orb.getAttribute('data-state')) ?? '',
              )
            )
              await orb.click();
            await expect(orb).toHaveAttribute(
              'data-state',
              /^(?:connected|listening|thinking|speaking)$/,
              { timeout: 30_000 },
            );
            await voiceDriver.waitForAudioReady();
            referenceCapture = await page.evaluate(() =>
              (
                window as ControlledReferenceWindow
              ).__voiceReferenceMicrophone?.snapshot(),
            );
            if (referenceCapture?.status !== 'verified')
              throw new Error(
                'Controlled injected-audio reference was not verified.',
              );
            if (!isGreeting) {
              await waitForFixedGreetingSettlement(page);
              greetingSettledBeforePrimer = true;
            }
            const primerStart = isGreeting
              ? 0
              : await voiceDriver.markPlaybackStart();
            if (!isGreeting) {
              const primer = voiceDriver.startPlayback(
                binary,
                fixture('only-tasks'),
                {
                  delayMs: tts2micPlaybackLeadInMs,
                  timeoutMs: 20_000,
                  maxOutputBytes: 1024 * 1024,
                },
              );
              parseCompletedPlayback((await primer.completed()).stdout);
            }
            if (isGreeting) {
              await expect
                .poll(
                  async () => {
                    const activity =
                      await voiceDriver.assistantActivity(primerStart);
                    return (
                      activity.activeMs >= 300 &&
                      activity.silentTailMs <=
                        bargeInPolicy.maximumPreOnsetQuietMs
                    );
                  },
                  { timeout: 30_000, intervals: [20] },
                )
                .toBe(true);
            } else {
              await expect
                .poll(
                  async () => {
                    taskGate.value = await voiceDriver.evaluate(
                      'task-response:prelaunch-gate',
                      sampleTaskBargeInGate,
                      {
                        primerFrame: primerStart,
                        minimumActiveMs: 300,
                        maximumQuietMs: bargeInPolicy.maximumPreOnsetQuietMs,
                      },
                    );
                    return taskGate.value !== null;
                  },
                  { timeout: 30_000, intervals: [20] },
                )
                .toBe(true);
              if (!taskGate.value)
                throw new Error(
                  'No current identified task response was speaking before injection.',
                );
              targetResponseId = taskGate.value.responseId;
            }
            const captionsBefore = isGreeting
              ? await page
                  .getByTestId('captions')
                  .locator('[data-role="assistant"]')
                  .allTextContents()
              : [];
            startFrame =
              taskGate.value?.playbackMarkerFrame ??
              (await voiceDriver.markPlaybackStart());
            const startedAt = performance.now();
            const interrupt = voiceDriver.startPlayback(
              binary,
              fixture('open-calendar'),
              {
                delayMs: 0,
                timeoutMs: 20_000,
                maxOutputBytes: 1024 * 1024,
              },
            );
            const completed = parseCompletedPlayback(
              (await interrupt.completed()).stdout,
            );
            endFrame = await voiceDriver.markPlaybackStart();
            playbackObservation = serializePlaybackObservation(
              sourceMetadata,
              completed,
              performance.now() - startedAt,
              startFrame,
              endFrame,
            );
            await new Promise<void>((resolve) =>
              setTimeout(
                resolve,
                bargeInPolicy.maximumStopLatencyMs +
                  bargeInPolicy.quietConfirmationMs +
                  bargeInPolicy.resumeGuardMs +
                  bargeInPolicy.cancellationGraceMs,
              ),
            );
            if (isGreeting && speakerCapture) {
              followupCapture = 'timeout';
              await expect
                .poll(
                  async () => {
                    speakerCapture.check();
                    const captions = await page
                      .getByTestId('captions')
                      .locator('[data-role="assistant"]')
                      .allTextContents();
                    const changed =
                      captions.length !== captionsBefore.length ||
                      captions.some(
                        (text, index) => text !== captionsBefore[index],
                      );
                    const state = await orb.getAttribute('data-state');
                    return (
                      changed &&
                      ['connected', 'listening'].includes(state ?? '') &&
                      silentTailMs(speakerCapture.pcm()) >= 1_000
                    );
                  },
                  { timeout: 30_000 },
                )
                .toBe(true)
                .then(() => {
                  followupCapture = 'quiet';
                })
                .catch(() => {});
              speakerCapture.check();
            }
            audioTimeline = await voiceDriver.snapshotAudio();
            if (isGreeting) {
              greetingPlayback = await page.evaluate(() =>
                (
                  window as GreetingAudioWindow
                ).__voiceGreetingAudio?.snapshot(),
              );
              if (!greetingPlayback || greetingPlayback.startedAtFrame === null)
                throw new Error(
                  'No classified greeting source start was captured.',
                );
            } else {
              observation = await page.evaluate(
                () =>
                  (
                    window as BargeInObserverWindow
                  ).__voiceBargeInObserver?.snapshot() ?? {
                    events: [],
                    dropped: 0,
                  },
              );
            }
            await speakerCapture?.stop();
            const inputWav = Buffer.from(
              audioTimeline.inputWavBase64,
              'base64',
            );
            const assistantWav = Buffer.from(
              audioTimeline.assistantWavBase64,
              'base64',
            );
            await testInfo.attach(`${prefix}-${repetition}-human-input.wav`, {
              body: inputWav,
              contentType: 'audio/wav',
            });
            await testInfo.attach(
              `${prefix}-${repetition}-assistant-output.wav`,
              {
                body: assistantWav,
                contentType: 'audio/wav',
              },
            );
            const input = decodePCM16Wav(inputWav);
            const output = decodePCM16Wav(assistantWav);
            const frames = input.pcm.length / (2 * input.channels);
            if (
              input.sampleRate !== audioTimeline.sampleRate ||
              output.sampleRate !== audioTimeline.sampleRate ||
              frames !== audioTimeline.endFrame - audioTimeline.startFrame ||
              output.pcm.length / (2 * output.channels) !== frames
            )
              throw new Error(
                'Barge-in capture did not validate against the shared sample clock.',
              );
            const directory = await mkdtemp(
              join(tmpdir(), 'voice-barge-in-vad-'),
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
              const vad = validateVadPayload(decodeVadPayload(stdout), frames);
              capturedVad = vad;
              if (
                !vad.valid ||
                vad.sampleRate !== input.sampleRate ||
                vad.channels !== input.channels
              )
                throw new Error(
                  'Barge-in captured VAD sample clock is invalid.',
                );
              const sampleClockStartFrame = audioTimeline.startFrame;
              const playbackStartSample = startFrame - sampleClockStartFrame;
              const playbackEndSample = endFrame - sampleClockStartFrame;
              playbackWindow = {
                startSample: playbackStartSample,
                endSample: playbackEndSample,
              };
              const onset = vad.segments.find(
                (segment) =>
                  segment.startSample >= playbackStartSample &&
                  segment.startSample < playbackEndSample,
              )?.startSample;
              selectedOnsetSample = onset ?? null;
              measurement =
                onset === undefined
                  ? invalidBargeIn(
                      'No human speech onset was detected in the interruption playback window.',
                    )
                  : computeBargeInMeasurement({
                      assistantPcm16: output.pcm,
                      assistantChannels: output.channels,
                      sampleRate: audioTimeline.sampleRate,
                      humanOnsetSample: onset,
                      missingBlocks: audioTimeline.missingBlocks,
                      targetResponseId,
                      events: observation.events.map((event) => ({
                        ...event,
                        frame: event.frame - sampleClockStartFrame,
                      })),
                      droppedEvents: observation.dropped,
                      ...(greetingPlayback
                        ? {
                            greetingPlayback: {
                              sourceCount: greetingPlayback.sourceCount,
                              failure: greetingPlayback.failure,
                              stoppedEarly: greetingPlayback.stoppedEarly,
                              stoppedAtSample:
                                greetingPlayback.stoppedAtFrame === null
                                  ? null
                                  : greetingPlayback.stoppedAtFrame -
                                    sampleClockStartFrame,
                            },
                          }
                        : {}),
                    });
              assistantActiveMs = (
                await voiceDriver.assistantActivity(startFrame)
              ).activeMs;
            } finally {
              await rm(directory, { recursive: true, force: true });
            }
            voiceDriver.assertHealthy('barge-in benchmark');
          } catch (error) {
            infrastructureError ??= error;
            measurement = invalidBargeIn(
              'Benchmark setup, playback, capture, or VAD failed.',
            );
          } finally {
            if (!isGreeting)
              observation = await page
                .evaluate(
                  () =>
                    (
                      window as BargeInObserverWindow
                    ).__voiceBargeInObserver?.snapshot() ?? {
                      events: [],
                      dropped: 0,
                    },
                )
                .catch(() => observation);
            captureSetup = await page
              .evaluate(() =>
                (
                  window as Window & {
                    __voiceAudioTimeline?: {
                      diagnostics(): AudioCaptureSetupDiagnostics;
                    };
                  }
                ).__voiceAudioTimeline?.diagnostics(),
              )
              .catch(() => undefined);
            referenceCapture ??= await page
              .evaluate(() =>
                (
                  window as ControlledReferenceWindow
                ).__voiceReferenceMicrophone?.snapshot(),
              )
              .catch(() => undefined);
            records.push({
              scenario: isGreeting
                ? 'greeting-interrupted-by-open-calendar'
                : 'only-tasks-interrupted-by-open-calendar',
              repetition,
              ...playbackObservation,
              assistantCapturedAudioActiveMs: assistantActiveMs,
              measurements: {
                bargeIn: measurement,
                assistantTranscriptWordCount: 'unsupported',
                assistantSpeechWpm: 'unsupported',
              },
            });
            attempts.push({
              repetition,
              targetResponseId,
              inputGate: taskGate.value,
              greetingSettledBeforePrimer,
              startFrame,
              endFrame,
              sampleClockStartFrame: audioTimeline?.startFrame ?? null,
              sampleClockEndFrame: audioTimeline?.endFrame ?? null,
              captureIntegrity: {
                setup: captureSetup ?? audioTimeline?.setup ?? null,
                blockCount:
                  audioTimeline?.blockCount ??
                  captureSetup?.recording.retainedBlocks ??
                  null,
                missingBlocks:
                  audioTimeline?.missingBlocks ??
                  captureSetup?.recording.missingBlocks ??
                  null,
                missingBlockReasons:
                  audioTimeline?.missingBlockReasons ??
                  captureSetup?.recording.missingBlockReasons ??
                  null,
              },
              observation,
              referenceCapture,
              onsetEvidence: {
                fixtureSha256,
                fixtureVad,
                capturedVad,
                playbackWindow,
                selectedOnsetSample,
                gateToCapturedOnsetMs:
                  selectedOnsetSample !== null &&
                  taskGate.value?.observedFrame !== null &&
                  taskGate.value?.observedFrame !== undefined &&
                  audioTimeline
                    ? ((audioTimeline.startFrame +
                        selectedOnsetSample -
                        taskGate.value.observedFrame) *
                        1000) /
                      audioTimeline.sampleRate
                    : null,
              },
              ...(isGreeting ? { greetingPlayback, followupCapture } : {}),
              measurement,
            });
            if (speakerCapture) {
              await speakerCapture.stop();
              await testInfo.attach(
                `${prefix}-${repetition}-speaker-monitor.wav`,
                {
                  body: replyWav(speakerCapture.pcm()),
                  contentType: 'audio/wav',
                },
              );
            }
            await page
              .evaluate(() =>
                (
                  window as BargeInObserverWindow
                ).__voiceBargeInObserver?.dispose(),
              )
              .catch(() => {});
            await page
              .getByRole('button', { name: 'Stop voice', exact: true })
              .click({ timeout: 1500 })
              .catch(() => {});
          }
          if (infrastructureError) break;
        }
        const assessment = assessBargeInRun(
          records.flatMap((record) =>
            record.measurements.bargeIn === 'unsupported'
              ? []
              : [record.measurements.bargeIn],
          ),
          selection.repetitions,
        );
        const report = {
          schemaVersion: 2,
          status: assessment.status,
          validation: assessment,
          benchmark: isGreeting
            ? 'playwright-voice-greeting-barge-in'
            : 'playwright-voice-barge-in',
          provider: 'openai-realtime',
          repetitions: selection.repetitions,
          policy: bargeInPolicy,
          context: {
            captureInitialization: {
              revision: 2,
              preparationMs: 100,
              policy:
                'Record once after connected inputs have continuous frames and stable supported formats; readiness requires processor acknowledgment. Preparation is excluded, early remote output may not be recorded but is passed through, and every recorded discontinuity still invalidates measurement.',
            },
            microphoneCapture:
              'Controlled Linux injected reference on the exact app-selected device; observed AEC/noise suppression/AGC disabled, app settings and enabled state checked unchanged across acquisition. Separate-stream settings checks do not prove unchanged acoustics. Not equivalent to prior app-processed captures.',
            humanOnset: {
              source: 'captured-reference VAD',
              threshold: vadThreshold,
              padding: vadPadding,
              refinement: 'none; no fixture or playback-time backdating',
            },
            capture: isGreeting
              ? 'Microphone and demo-local Web Audio greeting sidebranch on one sample clock; native speaker path unchanged, capture output silent. Cross-context tap buffering is included: this is tap cessation, not exact native-speaker cessation. Remote replies are separate in speaker-monitor WAV.'
              : 'Shared-clock browser PCM sent toward the output sink, not physical audibility.',
            attribution: isGreeting
              ? 'Demo-specific: exactly one long direct-to-destination source in the one-sample silent-unlock context. Native stop >=50ms before source-clock expected speech end (last decoded sample >=0.01, excluding trailing silence) corroborates truncation; natural completion stays ambiguous. Not a general greeting API.'
              : 'Matching OpenAI output clear or cancelled response corroborates the stop; quiet without that evidence is ambiguous and excluded.',
            selectedProvider:
              'realtime (selected and asserted via public UI before key bootstrap/connection)',
            ...(isGreeting
              ? {
                  trigger:
                    'No primer. Inject open-calendar with zero lead-in once greeting has >=300ms captured activity and <=30ms quiet tail; actual onset must overlap captured greeting.',
                  followup:
                    'Retain separate physical speaker monitor until changed assistant caption, listening state and 1s output quiet, or a 30s timeout. This is a bounded diagnostic, not proof of task success.',
                }
              : {
                  trigger:
                    'After the fixed greeting settles, play the unchanged primer once. Target only a fresh identified output after its marker; require >=300ms captured speech and <=30ms quiet tail, then mark and recheck the same response immediately before launching the full unchanged interruption fixture once. No observer/caption/fixture work between gate and launch.',
                }),
            eventClock: isGreeting
              ? 'Native greeting start/stop calls sample the capture AudioContext clock; early-stop versus natural end uses only the source context clock. Primary latency uses captured PCM samples.'
              : 'Playback lifecycle diagnostics use AudioContext.currentTime at browser event receipt; primary latency uses captured PCM samples only.',
            sampleOffsets:
              'Measurement samples address each attempt WAV; diagnostic event frames are absolute AudioContext positions.',
            failureRateDenominator:
              'Measured + failed + timeout attempts; invalid and ambiguous attempts are counted separately.',
          },
          summary: summarizeVoiceBenchmark(
            records,
            unsupportedLatency(
              'Response latency is measured separately in the fixed-scenario lane.',
            ),
            assessment.failedAttemptCount,
          ),
          attempts,
          records,
        };
        await completeBargeInReport(
          report,
          assessment,
          (value) =>
            testInfo.attach(
              isGreeting
                ? 'voice-greeting-barge-in-benchmark.json'
                : 'voice-barge-in-benchmark.json',
              {
                body: JSON.stringify(value, null, 2),
                contentType: 'application/json',
              },
            ),
          infrastructureError,
        );
      });
    });
  }
});
