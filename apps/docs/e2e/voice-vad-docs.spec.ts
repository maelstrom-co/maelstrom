import { expect, test } from '@playwright/test';
import { LIVEKIT_CASCADE_OWNERSHIP } from '../src/components/ownership/livekit-cascade';

test('LiveKit guide documents automatic turns and manual fallback', async ({
  page,
}) => {
  const response = await page.goto('/guides/voice/livekit-cascade/');

  expect(response?.ok()).toBe(true);
  const guide = page.locator('main');

  await expect(
    guide.getByRole('heading', { level: 2, name: 'Configure browser VAD' }),
  ).toBeVisible();
  await expect(
    guide.getByRole('heading', {
      level: 2,
      name: 'Delimit each manual turn',
    }),
  ).toBeVisible();

  const adapterExample = guide
    .locator('pre')
    .filter({ hasText: 'new LiveKitAdapter' })
    .first();
  await expect(adapterExample).toContainText('roomName');
  await expect(adapterExample).toContainText('mintToken');

  await expect(guide).toContainText('maelstrom-livekit-assets public/vad-web');
  await expect(guide).toContainText('/vad-web/');
  await expect(guide).toContainText('vad: false');
  await expect(guide).toContainText('turnControl.startTurn()');
  await expect(guide).toContainText('turnControl.endTurn()');

  await expect(
    page.getByRole('img', { name: LIVEKIT_CASCADE_OWNERSHIP.summary }),
  ).toBeVisible();
  await expect(
    guide
      .getByRole('link', { name: 'Browser VAD and barge-in', exact: true })
      .first(),
  ).toHaveAttribute('href', '/understanding/browser-vad-and-barge-in/');
  await expect(
    guide
      .getByRole('link', {
        name: 'Voice architecture: cascade vs realtime',
        exact: true,
      })
      .first(),
  ).toHaveAttribute('href', '/understanding/voice-architecture/');
});

test('browser VAD page documents configuration and ownership boundaries', async ({
  page,
}) => {
  const response = await page.goto('/understanding/browser-vad-and-barge-in/');

  expect(response?.ok()).toBe(true);
  const article = page.locator('main');
  await expect(
    article.getByRole('heading', {
      level: 1,
      name: 'Browser VAD and barge-in',
    }),
  ).toBeVisible();

  for (const heading of [
    'Why detection runs in the browser',
    'Why pre-roll is part of turn detection',
    'Configuration and operating details',
    'Failure becomes a capability change only when it is safe',
    'Why this does not configure OpenAI Realtime',
  ]) {
    await expect(article.getByRole('heading', { name: heading })).toBeVisible();
  }

  const vadForms = article
    .getByRole('table')
    .filter({ hasText: 'Enable automatic browser VAD' });
  await expect(vadForms).toContainText('/vad-web/');
  await expect(vadForms).toContainText('250');
  await expect(vadForms).toContainText('without loading VAD assets');

  const turnOwnershipDiagram = article
    .locator('svg[role~="document"]')
    .filter({ hasText: 'Browser-owned LiveKit turn detection' });
  await expect(turnOwnershipDiagram).toHaveAccessibleName(
    'Browser-owned LiveKit turn detection',
  );

  const bargeInDiagram = article
    .locator('svg[role~="document"]')
    .filter({ hasText: 'LiveKit browser barge-in sequence' });
  await expect(bargeInDiagram).toHaveAccessibleName(
    'LiveKit browser barge-in sequence',
  );

  const sidebar = page.getByRole('navigation', { name: 'Main' });
  await expect(
    sidebar.getByRole('link', {
      name: 'Browser VAD and barge-in',
      exact: true,
    }),
  ).toHaveAttribute('href', '/understanding/browser-vad-and-barge-in/');
  await expect(page).toHaveURL('/understanding/browser-vad-and-barge-in/');
});

test('voice architecture preserves distinct turn ownership', async ({
  page,
}) => {
  const response = await page.goto('/understanding/voice-architecture/');

  expect(response?.ok()).toBe(true);
  const article = page.locator('main');
  await expect(
    article.getByRole('heading', { level: 2, name: 'Compare the modes' }),
  ).toBeVisible();
  await expect(article).toContainText('Automatic VAD is enabled by default');
  await expect(article).toContainText('/vad-web/');
  await expect(article).toContainText('250 milliseconds of transport pre-roll');
  await expect(article).toContainText(
    'OpenAI owns voice activity and turn handling for this mode',
  );
  const cascadeDiagram = article
    .locator('svg[role~="document"]')
    .filter({ hasText: 'Cascade voice flow' });
  await expect(cascadeDiagram).toHaveAccessibleName('Cascade voice flow');
  await expect(
    article
      .getByRole('link', { name: 'Browser VAD and barge-in', exact: true })
      .first(),
  ).toHaveAttribute('href', '/understanding/browser-vad-and-barge-in/');
});
