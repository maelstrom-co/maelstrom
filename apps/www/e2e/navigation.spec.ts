import { expect, test } from '@playwright/test';
import { installPostHogRecorder } from './posthog';

const playgroundUrl =
  process.env.PUBLIC_PLAYGROUND_URL ?? 'https://demo.maelstrom-ai.co';

test('public visitors can find installation and GitHub without beta access instructions', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('link', { name: /Star on GitHub/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Star on GitHub/ }),
  ).toHaveAttribute('href', 'https://github.com/maelstrom-co/maelstrom');
  await expect(
    page.getByRole('link', { name: 'Get started →' }),
  ).toHaveAttribute(
    'href',
    'https://docs.maelstrom-ai.co/getting-started/installation/',
  );
  await expect(page.locator('body')).not.toContainText(
    /private beta|beta tester|request GitHub access/i,
  );
  await page.screenshot({ path: test.info().outputPath('public-launch.png') });
});

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
  for (const javaScriptEnabled of [false, true]) {
    for (const fragment of ['waitlist', 'community']) {
      test(`cold /#${fragment} navigation stays at the community after hydration at ${width}px (JavaScript: ${javaScriptEnabled})`, async ({
        browser,
        baseURL,
      }) => {
        const context = await browser.newContext({
          baseURL,
          javaScriptEnabled,
          viewport: { width, height: 812 },
        });
        try {
          const page = await context.newPage();
          const errors: string[] = [];
          page.on('pageerror', (error) => {
            errors.push(error.message);
          });
          await page.goto(`/#${fragment}`);
          if (javaScriptEnabled) {
            await expect(
              page.locator('.demo-shell-live .max-w-4xl'),
            ).toBeVisible();

            await expect(page.locator('.hero-dash').last()).toBeVisible();
            await page.evaluate(() => document.fonts.ready);
          }
          const community = page.locator('#community');
          await expect
            .poll(() =>
              community.evaluate((element) => {
                const sectionTop =
                  element.getBoundingClientRect().top + window.scrollY;
                const maximumScroll =
                  document.documentElement.scrollHeight - window.innerHeight;
                return Math.abs(
                  window.scrollY - Math.min(sectionTop, maximumScroll),
                );
              }),
            )
            .toBeLessThan(2);
          await expect(
            community.getByRole('heading', { name: 'Help shape Maelstrom' }),
          ).toBeInViewport({ ratio: 1 });
          expect(errors).toEqual([]);
        } finally {
          await context.close();
        }
      });
    }
  }

  test(`community access goes directly to Discord without email or Cloud signup at ${width}px`, async ({
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

    const sources = ['navigation', 'community_section', 'footer_community'];
    for (const source of sources) {
      const link = page.locator(`[data-discord-source="${source}"]`);
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute(
        'href',
        'https://maelstrom-ai.co/discord',
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
          event: 'community_discord_invite_clicked',
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

test('blog community invitation records its own source and opens Discord directly', async ({
  page,
}) => {
  const captures = await installPostHogRecorder(page);
  await page.goto('/blog/hello-maelstrom/');
  const link = page.locator('[data-discord-source="launch_blog"]');
  await expect(link).toHaveAttribute('href', 'https://maelstrom-ai.co/discord');
  await link.evaluate((element) => {
    element.addEventListener('click', (event) => event.preventDefault());
  });
  await link.focus();
  await page.keyboard.press('Enter');
  await expect
    .poll(() => captures)
    .toEqual([
      {
        event: 'community_discord_invite_clicked',
        properties: { source: 'launch_blog' },
      },
    ]);
});

test('community invitation works without JavaScript or an analytics client', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    javaScriptEnabled: false,
  });
  await context.route('https://maelstrom-ai.co/discord', (route) =>
    route.fulfill({ body: 'Discord invitation' }),
  );
  const page = await context.newPage();
  await page.goto('/');
  const opened = context.waitForEvent('page');
  await page.locator('[data-discord-source="community_section"]').click();
  const invitation = await opened;
  await expect(invitation).toHaveURL('https://maelstrom-ai.co/discord');
  await context.close();
});
