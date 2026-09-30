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

function repetitions() {
  const value = Number(process.env.VOICE_BENCHMARK_REPETITIONS ?? '1');
  if (!Number.isInteger(value) || value < 1 || value > 100)
    throw new Error(
      'VOICE_BENCHMARK_REPETITIONS must be an integer from 1 to 100',
    );
  return value;
}

test('voice benchmark: fixed audio scenarios', async ({ page }, testInfo) => {
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

  const capture = recordReplies();
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
    const count = repetitions();
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
            () => {
              capture.check();
              const audio = capture.pcm(start);
              return nonSilentMs(audio) >= 150 && silentTailMs(audio) >= 600;
            },
            { timeout: 30_000 },
          )
          .toBe(true);
        const end = capture.pcm().length;
        records.push({
          scenario,
          repetition,
          assistantCapturedAudioActiveMs: nonSilentMs(
            capture.pcm(start).subarray(0, end - start),
          ),
          captureOffsetStartMs: Math.round(start / 96),
          captureOffsetEndMs: Math.round(end / 96),
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
      repetitions: process.env.VOICE_BENCHMARK_REPETITIONS ?? '1',
      context: {
        baseURL: new URL(baseURL).origin,
        browser: 'chromium',
        operatingSystem: process.platform,
        capture:
          'continuous PulseAudio monitor, offsets from capture start (not first human input)',
        audioThresholdRms: 0.01,
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
