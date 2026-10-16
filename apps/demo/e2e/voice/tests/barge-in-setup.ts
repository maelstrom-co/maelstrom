import { expect, type Page } from '@playwright/test';

export async function selectRealtimeBeforeVoiceConnection(page: Page) {
  const selector = page.getByRole('combobox', {
    name: 'Voice provider',
    exact: true,
  });
  await expect(selector).toBeVisible({ timeout: 30_000 });
  const orb = page.locator('button.voice-orb');
  if (await orb.count()) {
    const state = await orb.getAttribute('data-state');
    if (state !== 'idle' && state !== 'error')
      throw new Error(
        'Barge-in provider selection requires an unconnected voice session.',
      );
  }
  await selector.selectOption('realtime');
  await expect(selector).toHaveValue('realtime');
  await expect(selector).toBeEnabled();
}

export async function waitForFixedGreetingSettlement(
  page: Page,
  timeoutMs = 30_000,
) {
  await expect(
    page.getByRole('status').filter({ hasText: /^Listening$/ }),
  ).toBeVisible({ timeout: timeoutMs });
  await expect(
    page.getByRole('button', { name: 'Skip greeting', exact: true }),
  ).toHaveCount(0, { timeout: timeoutMs });
  await expect(page.locator('button.voice-orb')).toHaveAttribute(
    'data-state',
    /^(?:connected|listening)$/,
    { timeout: timeoutMs },
  );
}
