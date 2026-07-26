import { expect, test } from '@playwright/test';

interface DocsRoute {
  /** Human-readable case name used in the generated Playwright title. */
  readonly name: string;
  /** Build-observed docs route to open. */
  readonly path: string;
  /** Accessible level-one heading that identifies the rendered page. */
  readonly heading: string;
  /** Source declaration rendered in the TypeDoc page body, when applicable. */
  readonly context?: string;
  /** Public entry-point group that must identify a multi-entry TypeDoc symbol. */
  readonly entryPoint?: string;
}

const GUIDE_ROUTES: readonly DocsRoute[] = [
  {
    name: 'voice overview',
    path: '/guides/voice/overview/',
    heading: 'Voice',
  },
  {
    name: 'OpenAI guide',
    path: '/guides/voice/openai-realtime/',
    heading: 'OpenAI Realtime',
  },
];

// These paths come from `docs:build` output. TypeDoc includes the configured
// source entry point in multi-entry package routes, so they must not be derived
// from a source filename or shortened by hand.
const REFERENCE_ROUTES: readonly DocsRoute[] = [
  {
    name: '@maelstrom-co/realtime landing',
    path: '/reference/realtime/readme/',
    heading: '@maelstrom-co/realtime',
  },
  {
    name: '@maelstrom-co/react-realtime landing',
    path: '/reference/react-realtime/readme/',
    heading: '@maelstrom-co/react-realtime',
  },
  {
    name: '@maelstrom-co/realtime-server landing',
    path: '/reference/realtime-server/readme/',
    heading: '@maelstrom-co/realtime-server',
  },
  {
    name: 'RealtimeSession',
    path: '/reference/realtime/packages/realtime/src/classes/realtimesession/',
    heading: 'RealtimeSession',
    context: 'packages/realtime/src',
  },
  {
    name: 'OpenAIAdapter',
    path: '/reference/realtime/packages/realtime/src/openai/classes/openaiadapter/',
    heading: 'OpenAIAdapter',
    context: 'packages/realtime/src/lib/openai/openai-adapter.ts',
    entryPoint: 'packages/realtime/src/openai',
  },
  {
    name: 'maelstromRealtime',
    path: '/reference/react-realtime/functions/maelstromrealtime/',
    heading: 'maelstromRealtime',
    context: 'packages/react-realtime/src/lib/maelstrom-realtime.ts',
  },
  {
    name: 'createOpenAIMinter',
    path: '/reference/realtime-server/functions/createopenaiminter/',
    heading: 'createOpenAIMinter',
    context: 'packages/realtime-server/src/lib/openai-mint.ts',
  },
];

for (const route of [...GUIDE_ROUTES, ...REFERENCE_ROUTES]) {
  test(`${route.name} renders`, async ({ page }) => {
    const response = await page.goto(route.path);

    expect(response?.ok()).toBe(true);
    await expect(
      page.getByRole('heading', { level: 1, name: route.heading }),
    ).toBeVisible();
    if (route.context) {
      await expect(page.locator('main')).toContainText(route.context);
    }
    if (route.entryPoint) {
      const sidebar = page.getByRole('navigation', { name: 'Main' });
      await expect(
        sidebar.getByText(route.entryPoint, { exact: true }),
      ).toBeVisible();
    }
  });
}

test('voice navigation exposes guides and API packages', async ({ page }) => {
  await page.goto('/guides/voice/overview/');

  const sidebar = page.getByRole('navigation', { name: 'Main' });
  await expect(
    sidebar.getByText('Voice', { exact: true }).first(),
  ).toBeVisible();
  await expect(
    sidebar.getByRole('link', { name: 'Voice', exact: true }),
  ).toHaveAttribute('href', '/guides/voice/overview/');
  await expect(
    sidebar.getByRole('link', { name: 'OpenAI Realtime' }),
  ).toBeVisible();
  await expect(
    sidebar.getByText('@maelstrom-co/realtime', { exact: true }),
  ).toBeVisible();
  await expect(
    sidebar.getByText('@maelstrom-co/react-realtime', { exact: true }),
  ).toBeVisible();
  await expect(
    sidebar.getByText('@maelstrom-co/realtime-server', { exact: true }),
  ).toBeVisible();
});
