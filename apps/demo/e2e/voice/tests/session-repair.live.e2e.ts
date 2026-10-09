import { fileURLToPath } from 'node:url';
import { test as base, expect, type Page } from '@playwright/test';
import { enterAndSubmitApiKey, hasKeyEntryControl } from './key-bootstrap.ts';
import { nonSilentMs, recordReplies, silentTailMs } from './reply-recorder';
import { sessionAudioArtifacts } from './session-audio-artifacts.ts';
import { createVoiceTestDriver } from './voice-test-driver.ts';

const fixture = (name: string) =>
  fileURLToPath(new URL(`../audio/${name}.wav`, import.meta.url));

type VoiceTestFixtures = {
  readonly voice: {
    readonly page: Page;
    readonly protocol: ReturnType<typeof createVoiceTestDriver>['protocol'];
    readonly driver: ReturnType<typeof createVoiceTestDriver>;
  };
};

type VoiceWorkerFixtures = {
  readonly voiceConfig: {
    readonly openAIApiKey: string | undefined;
    readonly baseURL: string | undefined;
  };
};

const test = base.extend<VoiceTestFixtures, VoiceWorkerFixtures>({
  voiceConfig: [
    async ({ browser: _browser }, use) => {
      await use({
        openAIApiKey: process.env.MAELSTROM_E2E_OPENAI_API_KEY,
        baseURL: process.env.MAELSTROM_BASE_URL,
      });
    },
    { scope: 'worker' },
  ],
  voice: async ({ browser, voiceConfig }, use, testInfo) => {
    const context = await browser.newContext({ permissions: ['microphone'] });
    const page = await context.newPage();
    const driver = createVoiceTestDriver(page);
    const protocol = driver.protocol;
    try {
      await driver.navigate(voiceConfig.baseURL);
      const keyInput = page.locator('#playground-api-key');
      const calendar = page.locator('[data-instance-id="calendar-main"]');
      const tasks = page.locator('[data-instance-id="tasks-main"]');
      const isKeylessPreview = async () =>
        (await page
          .getByRole('button', {
            name: 'Start interactive demo',
            exact: true,
          })
          .count()) > 0;
      try {
        await expect
          .poll(
            async () =>
              (await keyInput.isVisible().catch(() => false)) ||
              (await hasKeyEntryControl(page)) ||
              (await calendar.count()) > 0,
          )
          .toBe(true);
      } catch {
        throw new Error(
          'The configured app exposed neither its API-key entry flow nor the seeded calendar. Check MAELSTROM_BASE_URL and the app configuration.',
        );
      }

      const keyInputVisible = await keyInput.isVisible().catch(() => false);
      const hasKeyControl = await hasKeyEntryControl(page);
      const needsKey =
        keyInputVisible || hasKeyControl || (await isKeylessPreview());
      if (needsKey && !voiceConfig.openAIApiKey)
        throw new Error(
          'BYOK voice E2E requires MAELSTROM_E2E_OPENAI_API_KEY; set it in your environment (do not put it in a file).',
        );

      if (voiceConfig.openAIApiKey && (keyInputVisible || hasKeyControl)) {
        await enterAndSubmitApiKey(page, voiceConfig.openAIApiKey);
      }

      await expect(calendar).toBeVisible({ timeout: 30_000 });
      await expect(tasks).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('ai-voice-disclosure')).toBeVisible({
        timeout: 30_000,
      });
      const voiceControl = page.locator('button.voice-orb');
      await expect(voiceControl).toHaveCount(1, { timeout: 30_000 });
      await expect(voiceControl).toBeVisible({ timeout: 30_000 });

      protocol.assertHealthy('fresh page navigation and key setup');
      await use({ page, protocol, driver });
    } finally {
      try {
        const evidence = await driver.evidence();
        await testInfo.attach('voice-driver-final-evidence.json', {
          body: JSON.stringify(evidence, null, 2),
          contentType: 'application/json',
        });
        await testInfo.attach('protocol-evidence.json', {
          body: JSON.stringify(evidence.protocol, null, 2),
          contentType: 'application/json',
        });
      } catch {
        console.error('Unable to attach voice driver evidence.');
      }
      await driver.dispose();
      await context.close();
    }
  },
});

async function runTwoTurnRepair(
  page: Page,
  driver: ReturnType<typeof createVoiceTestDriver>,
  secondInput: string,
) {
  const binary = process.env.TTS2MIC_BIN;
  if (!binary)
    throw new Error('Set TTS2MIC_BIN to the compiled tts2mic-mcp executable');
  if (process.platform !== 'linux' || !process.env.PULSE_SERVER)
    throw new Error(
      'Run this test through tts2mic scripts/with-audio.sh on Linux/PulseAudio',
    );

  const protocol = driver.protocol;
  const calendar = page.locator('[data-instance-id="calendar-main"]');
  const tasks = page.locator('[data-instance-id="tasks-main"]');
  const user = page.getByTestId('captions').locator('[data-role="user"]');
  const assistant = page
    .getByTestId('captions')
    .locator('[data-role="assistant"]');
  const audio = recordReplies();
  try {
    const voiceOrb = page.locator('button.voice-orb');
    const initialVoiceState = await voiceOrb.getAttribute('data-state');
    if (initialVoiceState === 'idle' || initialVoiceState === 'error')
      await voiceOrb.click();
    await expect(voiceOrb).toHaveAttribute(
      'data-state',
      /^(?:connected|listening|thinking|speaking)$/,
      { timeout: 30_000 },
    );
    protocol.assertHealthy('voice startup');
    await expect(
      page.locator('[role="status"][aria-live="polite"]'),
    ).toHaveText('Listening', { timeout: 30_000 });
    await expect
      .poll(() => {
        audio.check();
        return audio.pcm().length;
      })
      .toBeGreaterThanOrEqual(24_000);
    await expect.poll(() => nonSilentMs(audio.pcm().subarray(-24_000))).toBe(0);

    for (const name of ['only-tasks', secondInput] as const) {
      const input = fixture(name);
      const hold = page.getByRole('button', {
        name: 'Hold to talk',
        exact: true,
      });
      const manual = await hold.isVisible();
      if (manual) {
        await hold.focus();
        await page.keyboard.down('Space');
        await expect(voiceOrb).toHaveAttribute('data-state', 'listening', {
          timeout: 10_000,
        });
        await page.waitForTimeout(500);
      }
      const observationCursor = driver.cursor();
      const assistantBefore = await assistant.allTextContents();
      const turnStart = audio.pcm().length;
      let stdout: string;
      try {
        stdout = await driver.action(`playback:${name}`, async () => {
          const playback = driver.startPlayback(binary, input, {
            delayMs: 3_000,
            timeoutMs: 20_000,
            maxOutputBytes: 1024 * 1024,
          });
          return (await playback.completed()).stdout;
        });
      } finally {
        if (manual) await page.keyboard.up('Space');
      }
      expect(JSON.parse(stdout).status).toBe('completed');
      protocol.assertHealthy(`${name} fixture injection`);
      await driver.waitForObservation((event) => event.type === 'captions', {
        after: observationCursor,
        timeoutMs: 30_000,
        signal: driver.signal,
      });
      await expect
        .poll(
          async () => {
            const current = await assistant.allTextContents();
            return (
              current.length !== assistantBefore.length ||
              current.some((text, index) => text !== assistantBefore[index])
            );
          },
          { timeout: 30_000 },
        )
        .toBe(true);
      await expect
        .poll(() => {
          audio.check();
          const turnPcm = audio.pcm(turnStart);
          return nonSilentMs(turnPcm) >= 150 && silentTailMs(turnPcm) >= 600;
        })
        .toBe(true);
      if (name === 'only-tasks') {
        const evidence = JSON.stringify({
          user: await user.allTextContents(),
          assistant: await assistant.allTextContents(),
          instances: await page
            .locator('[data-instance-id]')
            .evaluateAll((nodes) =>
              nodes.map((node) => node.getAttribute('data-instance-id')),
            ),
        });
        await expect(calendar, `First-turn evidence: ${evidence}`).toHaveCount(
          0,
        );
        await expect(tasks).toBeVisible();
      } else {
        const evidence = JSON.stringify({
          user: await user.allTextContents(),
          assistant: await assistant.allTextContents(),
          instances: await page
            .locator('[data-instance-id]')
            .evaluateAll((nodes) =>
              nodes.map((node) => node.getAttribute('data-instance-id')),
            ),
        });
        await expect(
          calendar,
          `Second-turn evidence: ${evidence}`,
        ).toBeVisible();
        await expect(tasks).toBeVisible();
      }
      await expect(voiceOrb).toHaveAttribute(
        'data-state',
        /^(?:connected|listening)$/,
      );
    }
    await driver.waitForAudioReady();
    protocol.assertHealthy('completed two-turn scenario');
  } catch (error) {
    protocol.assertHealthy('failed test step', error);
    throw error;
  } finally {
    const preserve = async (work: () => Promise<unknown>) => {
      try {
        await work();
      } catch (error) {
        console.error(
          'Voice-test cleanup diagnostic:',
          error instanceof Error ? error.message : String(error),
        );
      }
    };
    await preserve(async () =>
      test.info().attach('voice-driver-before-cleanup.json', {
        body: JSON.stringify(await driver.evidence(), null, 2),
        contentType: 'application/json',
      }),
    );
    await preserve(async () =>
      test.info().attach('before-cleanup.png', {
        body: await page.screenshot(),
        contentType: 'image/png',
      }),
    );
    await preserve(async () =>
      test.info().attach('before-cleanup.json', {
        body: JSON.stringify(
          {
            statuses: await page.locator('[role="status"]').allTextContents(),
            userCaption: await user.allTextContents(),
            assistantCaption: await assistant.allTextContents(),
            instances: await page
              .locator('[data-instance-id]')
              .evaluateAll((nodes) =>
                nodes.map((node) => node.getAttribute('data-instance-id')),
              ),
          },
          null,
          2,
        ),
        contentType: 'application/json',
      }),
    );
    await page
      .getByRole('button', { name: 'Stop voice', exact: true })
      .click({ timeout: 1500 })
      .catch(() => {});
    await preserve(() => audio.stop());
    try {
      const snapshot = await driver.snapshotAudio();
      const artifacts = sessionAudioArtifacts(snapshot);
      expect(artifacts).toHaveLength(2);
      for (const artifact of artifacts)
        await test.info().attach(artifact.name, {
          body: artifact.body,
          contentType: artifact.contentType,
        });
    } catch (error) {
      await preserve(() =>
        test.info().attach('voice-session-reply-recorder.pcm', {
          body: audio.pcm(),
          contentType: 'application/octet-stream',
        }),
      );
      await preserve(() =>
        test.info().attach('session-audio-limitation.json', {
          body: JSON.stringify(
            {
              scenario: 'two-turn session audio capture',
              limitation:
                error instanceof Error ? error.message : String(error),
            },
            null,
            2,
          ),
          contentType: 'application/json',
        }),
      );
      expect
        .soft(
          false,
          `Unable to attach aligned complete-session audio WAVs: ${error instanceof Error ? error.message : String(error)}`,
        )
        .toBe(true);
    }
    await preserve(async () =>
      test.info().attach('recorder.log', {
        body: audio.diagnostics(),
        contentType: 'text/plain',
      }),
    );
  }
}

test('calendar repair by putting it back shares one voice conversation', async ({
  voice,
}) => {
  await runTwoTurnRepair(voice.page, voice.driver, 'put-it-back');
});

test('calendar repair by explicitly opening it shares one voice conversation', async ({
  voice,
}) => {
  await runTwoTurnRepair(voice.page, voice.driver, 'open-calendar');
});
