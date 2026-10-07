import { expect, test } from '@playwright/test';
import { installPostHogRecorder } from './posthog';

const playgroundUrl =
  process.env.PUBLIC_PLAYGROUND_URL ?? 'https://demo.maelstrom-ai.co';

test('main navigation links to the configured Playground', async ({ page }) => {
  await page.goto('/');

  const navigation = page.getByRole('navigation', {
    name: 'Main navigation',
  });
  await expect(
    navigation.getByRole('link', { name: 'Playground', exact: true }),
  ).toHaveAttribute('href', playgroundUrl);

  const footer = page.getByRole('contentinfo');
  await expect(
    footer.getByRole('link', { name: 'Playground', exact: true }),
  ).toHaveAttribute('href', playgroundUrl);
});

test('demo presents a visible Playground call to action', async ({ page }) => {
  await page.goto('/');

  const playgroundCta = page.getByRole('link', {
    name: 'Try the Playground',
    exact: true,
  });
  await expect(playgroundCta).toBeVisible();
  await expect(playgroundCta).toHaveAttribute('href', playgroundUrl);
});

for (const width of [1280, 375]) {
  test(`beta access goes directly to Discord without email or Cloud signup at ${width}px`, async ({
    page,
  }) => {
    const captures = await installPostHogRecorder(page);
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await page.setViewportSize({ width, height: 812 });
    await page.goto('/');

    await expect(page.locator('input[type="email"]')).toHaveCount(0);
    await expect(
      page.getByText('Managed Orchestration', { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.locator('script[src*="challenges.cloudflare.com"]'),
    ).toHaveCount(0);

    const sources = ['navigation', 'beta_section', 'footer_community'];
    for (const source of sources) {
      const link = page.locator(`[data-beta-discord-source="${source}"]`);
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute(
        'href',
        'https://discord.gg/XAjJqrF2u3',
      );
      await expect(link).toHaveAttribute('target', '_blank');
      await link.evaluate((element) => {
        element.addEventListener('click', (event) => event.preventDefault());
      });
      await link.click();
    }

    await expect
      .poll(() => captures)
      .toEqual(
        sources.map((source) => ({
          event: 'beta_discord_invite_clicked',
          properties: { source },
        })),
      );
    expect(requests.some((url) => url.includes('/api/waitlist'))).toBe(false);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
}

test('blog beta invitation records its own source and opens Discord directly', async ({
  page,
}) => {
  const captures = await installPostHogRecorder(page);
  await page.goto('/blog/hello-maelstrom/');
  const link = page.locator('[data-beta-discord-source="launch_blog"]');
  await expect(link).toHaveAttribute('href', 'https://discord.gg/XAjJqrF2u3');
  await link.evaluate((element) => {
    element.addEventListener('click', (event) => event.preventDefault());
  });
  await link.focus();
  await page.keyboard.press('Enter');
  await expect
    .poll(() => captures)
    .toEqual([
      {
        event: 'beta_discord_invite_clicked',
        properties: { source: 'launch_blog' },
      },
    ]);
});

test('beta invitation works without JavaScript or an analytics client', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    javaScriptEnabled: false,
  });
  await context.route('https://discord.gg/**', (route) =>
    route.fulfill({ body: 'Discord invitation' }),
  );
  const page = await context.newPage();
  await page.goto('/');
  const opened = context.waitForEvent('page');
  await page.locator('[data-beta-discord-source="beta_section"]').click();
  const invitation = await opened;
  await expect(invitation).toHaveURL('https://discord.gg/XAjJqrF2u3');
  await context.close();
});
