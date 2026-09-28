import { expect, test } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { nonSilentMs, recordReplies, replyWav } from './reply-recorder';
import { CALENDAR_WORD, TASK_WORD, observeProtocol } from './evidence.mjs';

const exec = promisify(execFile);
const input = fileURLToPath(new URL('./audio/only-tasks.wav', import.meta.url));

test('spoken request closes the calendar and keeps only the existing tasks', async ({ page }, testInfo) => {
  const binary = process.env.TTS2MIC_BIN;
  if (!binary) throw new Error('Set TTS2MIC_BIN to the compiled tts2mic-mcp executable');
  if (process.platform !== 'linux') throw new Error('This reply recorder requires Linux/PulseAudio');
  if (!process.env.PULSE_SERVER) throw new Error('Run this test through tts2mic ci/with-audio.sh');
  await testInfo.attach('input.wav', { path: input, contentType: 'audio/wav' });

  // Observe before navigation: the uploaded trace already failed on initial layout requests.
  const protocol = observeProtocol(page);
  const calendar = page.locator('[data-instance-id="calendar-main"]');
  const tasks = page.locator('[data-instance-id="tasks-main"]');
  const listening = page.getByRole('status').filter({ hasText: /^Listening$/ });
  const assistant = page.getByTestId('captions').locator('[data-role="assistant"]');
  const reply = recordReplies();
  let turnOffset: number | undefined;
  let primaryError: unknown;

  try {
    await page.goto('/');
    await expect(calendar).toBeVisible();
    await expect(tasks).toBeVisible();
    protocol.assertHealthy('initial workspace');

    // Requires the real demo with its server-side key and seeded workspace.
    await page.getByRole('button', { name: 'Start voice', exact: true }).click();

    // Do not let the greeting satisfy the reply-audio or new-caption assertions.
    await expect(listening).toBeVisible();
    protocol.assertHealthy('voice startup');
    await expect.poll(() => { reply.check(); return reply.pcm().length; }).toBeGreaterThanOrEqual(24_000);
    await expect.poll(() => { reply.check(); return nonSilentMs(reply.pcm().subarray(-24_000)); }).toBe(0);
    const previousCaption = (await assistant.allTextContents()).join('').trim();
    const turnStart = reply.pcm().length;
    turnOffset = turnStart;

    // Preserve real microphone capture. Only the input audio is prerecorded.
    const hold = page.getByRole('button', { name: 'Hold to talk', exact: true });
    const manual = await hold.isVisible();
    if (manual) { await hold.focus(); await page.keyboard.down('Space'); }
    let stdout: string;
    try {
      ({ stdout } = await exec(binary, ['play', '--target', 'pipewire', '--file', input], {
        timeout: 20_000,
        encoding: 'utf8',
        killSignal: 'SIGTERM',
        maxBuffer: 1024 * 1024,
      }));
    } finally {
      if (manual) await page.keyboard.up('Space');
    }
    expect(JSON.parse(stdout).status).toBe('completed'); // Injection only, not the verdict.
    protocol.assertHealthy('fixture injection');

    const userCaption = page.getByTestId('captions').locator('[data-role="user"]');
    await expect(userCaption).toContainText(CALENDAR_WORD);
    await expect(userCaption).toContainText(TASK_WORD); // task and tasks are equivalent here.
    protocol.assertHealthy('transcribed request');
    await expect(calendar).toHaveCount(0);
    await expect(tasks).toBeVisible();
    await expect(page.locator('[data-instance-id]')).toHaveCount(1);
    await expect.poll(async () => {
      const text = (await assistant.allTextContents()).join('').trim();
      return text.length > 0 && text !== previousCaption;
    }).toBe(true);
    await expect.poll(() => {
      reply.check();
      return nonSilentMs(reply.pcm(turnStart));
    }).toBeGreaterThanOrEqual(150);
    await expect(listening).toBeVisible();
    protocol.assertHealthy('completed turn');
  } catch (error) {
    primaryError = error;
    // Prefer the underlying protocol failure, but preserve the assertion as its cause.
    protocol.assertHealthy('failed test step', error);
    throw error;
  } finally {
    const cleanupProblems: string[] = [];
    const preserve = async (work: () => Promise<unknown>) => {
      try { await work(); } catch (error) {
        cleanupProblems.push(error instanceof Error ? error.message : String(error));
      }
    };
    // Playwright's automatic failure screenshot happens after this finally block.
    // Save the real failing state *before* Stop voice clears captions and labels.
    await preserve(async () => testInfo.attach('before-cleanup.png', {
      body: await page.screenshot(), contentType: 'image/png',
    }));
    await preserve(async () => {
      const state = await page.evaluate(() => ({
        statuses: [...document.querySelectorAll('[role="status"]')]
          .map(element => element.textContent),
        userCaption: document.querySelector('[data-testid="captions"] [data-role="user"]')?.textContent,
        assistantCaption: document.querySelector('[data-testid="captions"] [data-role="assistant"]')?.textContent,
        instances: [...document.querySelectorAll('[data-instance-id]')]
          .map(element => element.getAttribute('data-instance-id')),
      }));
      await testInfo.attach('before-cleanup.json', {
        body: JSON.stringify(state, null, 2), contentType: 'application/json',
      });
    });
    await preserve(async () => testInfo.attach('protocol-evidence.json', {
      body: JSON.stringify(protocol.snapshot(), null, 2), contentType: 'application/json',
    }));
    protocol.dispose();
    await page.getByRole('button', { name: 'Stop voice', exact: true })
      .click({ timeout: 1500 }).catch(() => {});
    await preserve(() => reply.stop());
    if (turnOffset !== undefined) {
      await preserve(() => testInfo.attach('reply.wav', { body: replyWav(reply.pcm(turnOffset!)), contentType: 'audio/wav' }));
    }
    await preserve(() => testInfo.attach('capture-session.wav', { body: replyWav(reply.pcm()), contentType: 'audio/wav' }));
    await preserve(() => testInfo.attach('recorder.log', { body: reply.diagnostics(), contentType: 'text/plain' }));
    if (cleanupProblems.length) {
      console.error('Voice-test cleanup diagnostics:', cleanupProblems.join('\n'));
      if (!primaryError) throw new Error(cleanupProblems.join('\n'));
    }
  }
});
