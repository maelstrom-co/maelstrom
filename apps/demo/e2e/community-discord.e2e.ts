import { gunzipSync } from 'node:zlib';
import { expect, test } from '@playwright/test';

test('production invitation sends a click event and opens Discord without submitting a signup', async ({
  context,
  page,
  baseURL,
}) => {
  // Exercise human click capture; the SDK filters automation and headless client hints.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'userAgentData', { get: () => undefined });
  });
  const captures: { event: string; properties: Record<string, unknown> }[] = [];
  const requests: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  context.on('request', (request) => requests.push(request.url()));
  await context.route('https://demo.maelstrom-ai.co/**', async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({
      url: `${baseURL}${url.pathname}${url.search}`,
    });
    await route.fulfill({ response });
  });
  await context.route('https://us.i.posthog.com/**', async (route) => {
    const request = route.request();
    const body = request.postDataBuffer();
    if (body) {
      const text =
        body[0] === 0x1f && body[1] === 0x8b
          ? gunzipSync(body).toString()
          : body.toString();
      const payload = JSON.parse(text);
      captures.push(...payload.batch);
    }
    await route.fulfill({ json: { status: 1 } });
  });
  await context.route('https://maelstrom-ai.co/discord', (route) =>
    route.fulfill({ body: 'Discord invitation' }),
  );

  await page.goto('https://demo.maelstrom-ai.co/');
  const link = page.getByRole('link', { name: 'Join Discord' });
  await expect(link).toBeVisible();
  expect(requests.some((url) => url.includes('posthog.com'))).toBe(false);
  const popup = page.waitForEvent('popup');
  await link.click();
  const invitation = await popup;
  await expect(invitation).toHaveURL('https://maelstrom-ai.co/discord');
  await expect
    .poll(() => ({ events: captures.map(({ event }) => event), errors }))
    .toEqual({ events: ['community_discord_invite_clicked'], errors: [] });
  expect(captures[0]?.properties.source).toBe('demo_header');
  expect(captures[0]?.properties.$process_person_profile).toBe(false);
  expect(requests.some((url) => url.includes('/api/waitlist'))).toBe(false);
});
