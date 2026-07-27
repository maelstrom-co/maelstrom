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
  {
    name: 'LiveKit guide',
    path: '/guides/voice/livekit-cascade/',
    heading: 'LiveKit cascade',
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
    name: 'AdapterTurnControl',
    path: '/reference/realtime/packages/realtime/src/interfaces/adapterturncontrol/',
    heading: 'AdapterTurnControl',
    context:
      'packages/realtime/src/lib/realtime-session/provider-adapter.types.ts',
  },
  {
    name: 'OpenAIAdapter',
    path: '/reference/realtime/packages/realtime/src/openai/classes/openaiadapter/',
    heading: 'OpenAIAdapter',
    context: 'packages/realtime/src/lib/openai/openai-adapter.ts',
    entryPoint: 'packages/realtime/src/openai',
  },
  {
    name: 'OpenAITokenGrantSchema',
    path: '/reference/realtime/packages/realtime/src/openai/variables/openaitokengrantschema/',
    heading: 'OpenAITokenGrantSchema',
    context: 'packages/realtime/src/lib/openai/openai-token.ts',
    entryPoint: 'packages/realtime/src/openai',
  },
  {
    name: 'maelstromRealtime',
    path: '/reference/react-realtime/functions/maelstromrealtime/',
    heading: 'maelstromRealtime',
    context: 'packages/react-realtime/src/lib/maelstrom-realtime.ts',
  },
  {
    name: 'UseVoiceResult',
    path: '/reference/react-realtime/interfaces/usevoiceresult/',
    heading: 'UseVoiceResult',
    context: 'packages/react-realtime/src/lib/maelstrom-realtime.ts',
  },
  {
    name: 'createOpenAIMinter',
    path: '/reference/realtime-server/functions/createopenaiminter/',
    heading: 'createOpenAIMinter',
    context: 'packages/realtime-server/src/lib/openai-mint.ts',
  },
  {
    name: '@maelstrom-co/realtime-livekit landing',
    path: '/reference/realtime-livekit/readme/',
    heading: '@maelstrom-co/realtime-livekit',
  },
  {
    name: '@maelstrom-co/realtime-livekit-server landing',
    path: '/reference/realtime-livekit-server/readme/',
    heading: '@maelstrom-co/realtime-livekit-server',
  },
  {
    name: '@maelstrom-co/realtime-livekit-agent landing',
    path: '/reference/realtime-livekit-agent/readme/',
    heading: '@maelstrom-co/realtime-livekit-agent',
  },
  {
    name: 'LiveKitAdapter',
    path: '/reference/realtime-livekit/packages/realtime-livekit/src/classes/livekitadapter/',
    heading: 'LiveKitAdapter',
    context: 'packages/realtime-livekit/src/livekit-adapter.ts',
    entryPoint: 'packages/realtime-livekit/src',
  },
  {
    name: 'SPEAK_TOPIC',
    path: '/reference/realtime-livekit/packages/realtime-livekit/src/protocol/variables/speak_topic/',
    heading: 'SPEAK_TOPIC',
    context: 'packages/realtime-livekit/src/protocol.ts',
    entryPoint: 'packages/realtime-livekit/src/protocol',
  },
  {
    name: 'TtsDoneMessage',
    path: '/reference/realtime-livekit/packages/realtime-livekit/src/protocol/interfaces/ttsdonemessage/',
    heading: 'TtsDoneMessage',
    context: 'packages/realtime-livekit/src/protocol.ts',
    entryPoint: 'packages/realtime-livekit/src/protocol',
  },
  {
    name: 'LiveKitTokenGrantSchema',
    path: '/reference/realtime-livekit/packages/realtime-livekit/src/livekit-token/variables/livekittokengrantschema/',
    heading: 'LiveKitTokenGrantSchema',
    context: 'packages/realtime-livekit/src/livekit-token.ts',
    entryPoint: 'packages/realtime-livekit/src/livekit-token',
  },
  {
    name: 'mintLiveKitToken',
    path: '/reference/realtime-livekit-server/functions/mintlivekittoken/',
    heading: 'mintLiveKitToken',
    context: 'packages/realtime-livekit-server/src/lib/livekit-mint.ts',
  },
  {
    name: 'LiveKitTokenRequestSchema',
    path: '/reference/realtime-livekit-server/variables/livekittokenrequestschema/',
    heading: 'LiveKitTokenRequestSchema',
    context: 'packages/realtime-livekit-server/src/lib/livekit-mint.ts',
  },
  {
    name: 'runVoiceAgent',
    path: '/reference/realtime-livekit-agent/functions/runvoiceagent/',
    heading: 'runVoiceAgent',
    context: 'packages/realtime-livekit-agent/src/agent.ts',
  },
  {
    name: 'default LiveKit agent definition',
    path: '/reference/realtime-livekit-agent/variables/default/',
    heading: 'default',
    context: 'packages/realtime-livekit-agent/src/agent.ts',
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
    sidebar.getByRole('link', { name: 'LiveKit cascade' }),
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
  await expect(
    sidebar.getByText('@maelstrom-co/realtime-livekit', { exact: true }),
  ).toBeVisible();
  await expect(
    sidebar.getByText('@maelstrom-co/realtime-livekit-server', { exact: true }),
  ).toBeVisible();
  await expect(
    sidebar.getByText('@maelstrom-co/realtime-livekit-agent', { exact: true }),
  ).toBeVisible();
});

test('LiveKit hold-to-talk example renders its session-error contract', async ({
  page,
}) => {
  await page.goto('/guides/voice/livekit-cascade/');

  const example = page
    .locator('pre')
    .filter({ hasText: 'export function HoldToTalk' });
  await expect(example).toContainText(
    'const { state, error, turnControl } = m.useVoice();',
  );
  await expect(example).toContainText('if (error !== undefined)');
  await expect(example).toContainText('disabled={!connected}');
  await expect(example).toContainText('aria-describedby={sessionError');
  await expect(example).toContainText('role="alert"');
  await expect(example).toContainText('reconnect voice');
});

test('turn-control reference distinguishes explicit and speech-native turns', async ({
  page,
}) => {
  await page.goto(
    '/reference/realtime/packages/realtime/src/interfaces/adapterturncontrol/',
  );

  const reference = page.locator('main');
  await expect(reference).toContainText(
    'RealtimeSession NEVER calls these methods',
  );
  await expect(reference).toContainText('startTurn');
  await expect(reference).toContainText('endTurn');
  await expect(reference).toContainText('Speech-native providers');
});

test('LiveKit reference preserves planning and credential-expiry boundaries', async ({
  page,
}) => {
  await page.goto(
    '/reference/realtime-livekit/packages/realtime-livekit/src/classes/livekitadapter/',
  );
  await expect(page.locator('main')).toContainText(
    'The companion worker has no LLM and receives no UI grounding',
  );
  await expect(page.locator('main')).toContainText(
    'the Maelstrom Engine, which remains the planning LLM',
  );

  await page.goto(
    '/reference/realtime-livekit/packages/realtime-livekit/src/livekit-token/interfaces/livekittokengrant/',
  );
  const reference = page.locator('main');
  await expect(reference).toContainText(
    'cannot authenticate a new room connection',
  );
  await expect(reference).toContainText(
    'Expiry does not end an established room',
  );
  await expect(reference).toContainText('LiveKit’s subsequent reconnects');
  await expect(reference).toContainText(
    'does not read this value or schedule an automatic',
  );
  await expect(reference).toContainText(
    'callers must disconnect and call connect() again',
  );
  await expect(reference).toContainText(
    'that call invokes mintToken before rejoining the room',
  );
});

// Check only links directly present in the three guides. This intentionally
// does not recurse through the generated TypeDoc graph.
for (const guide of GUIDE_ROUTES) {
  test(`${guide.name} has valid same-origin links and fragments`, async ({
    page,
    request,
  }) => {
    await page.goto(guide.path);
    const sourceUrl = page.url();
    const sourceOrigin = new URL(sourceUrl).origin;
    const hrefs = await page
      .locator('main a[href]')
      .evaluateAll((anchors) =>
        [
          ...new Set(anchors.map((anchor) => anchor.getAttribute('href'))),
        ].filter((href): href is string => href !== null),
      );

    for (const href of hrefs) {
      if (href.startsWith('mailto:')) continue;

      const target = new URL(href, sourceUrl);
      if (target.origin !== sourceOrigin) continue;
      if (/\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(target.pathname)) continue;

      const fragment = target.hash.slice(1);
      target.hash = '';
      const response = await request.get(target.href);
      expect(response.ok(), `${href} from ${guide.path}`).toBe(true);

      if (fragment) {
        await page.goto(target.href);
        const decodedFragment = decodeURIComponent(fragment);
        const fragmentExists = await page
          .locator('[id]')
          .evaluateAll(
            (elements, id) => elements.some((element) => element.id === id),
            decodedFragment,
          );
        expect(fragmentExists, `${href} from ${guide.path}`).toBe(true);
      }
    }
  });
}
