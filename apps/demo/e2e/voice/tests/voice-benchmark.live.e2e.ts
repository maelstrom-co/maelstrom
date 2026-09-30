import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import { initialNavigationURL } from '../runner-target.ts';
import {
  summarizeVoiceBenchmark,
  type VoiceBenchmarkRecord,
} from './benchmark-metrics.ts';
import { enterAndSubmitApiKey, hasKeyEntryControl } from './key-bootstrap.ts';
import {
  nonSilentMs,
  recordReplies,
  replyWav,
  silentTailMs,
} from './reply-recorder.ts';

const exec = promisify(execFile);
const scenarios = ['only-tasks', 'open-calendar', 'put-it-back'] as const;
const fixture = (name: string) =>
  fileURLToPath(new URL(`../audio/${name}.wav`, import.meta.url));

const maxRepetitions = 3;
const perScenarioBudgetMs = 80_000;
const setupBudgetMs = 60_000;

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

  const baseURL = process.env.MAELSTROM_BASE_URL || 'http://localhost:3000';
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
            responseLatency: 'unsupported',
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
    const output = {
      benchmark: 'playwright-voice',
      repetitions: count,
      context: {
        baseURL: new URL(baseURL).origin,
        browser: 'chromium',
        operatingSystem: process.platform,
        capture: 'continuous assistant-output PulseAudio monitor',
        audioThresholdRms: 0.01,
        turnBoundary:
          'voice UI returned to connected/listening with at least 1 second below the audio threshold; brief pauses can still make the boundary ambiguous',
      },
      summary: summarizeVoiceBenchmark(records, failures),
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
    await testInfo.attach('voice-benchmark-session.wav', {
      body: replyWav(capture.pcm()),
      contentType: 'audio/wav',
    });
    await testInfo.attach('voice-benchmark-recorder.log', {
      body: capture.diagnostics(),
      contentType: 'text/plain',
    });
  }
});
