import { existsSync, readFileSync } from 'node:fs';
import {
  OpenAIAdapter,
  OpenAITokenGrantSchema,
} from '@maelstrom-co/realtime/openai';
// The docs project already declares this package as an implicit dependency.
// nx-ignore-next-line
import {
  LiveKitTokenGrantSchema,
  SPEAK_TOPIC,
} from '@maelstrom-co/realtime-livekit';
import {
  SPEAK_TOPIC as PROTOCOL_SPEAK_TOPIC,
  TURN_TOPIC,
} from '@maelstrom-co/realtime-livekit/protocol';
import { LiveKitTokenGrantSchema as TokenEntryLiveKitTokenGrantSchema } from '@maelstrom-co/realtime-livekit/token';
import { expect, test } from '@playwright/test';
import { LIVEKIT_CASCADE_OWNERSHIP } from '../src/components/ownership/livekit-cascade';
import { OPENAI_REALTIME_OWNERSHIP } from '../src/components/ownership/openai-realtime';

// This suite checks that the voice docs are *alive and complete*, not that they
// are worded a particular way.
//
// It deliberately does NOT assert prose. An earlier version pinned 218 exact
// sentences, which inverted the job: editing a page meant editing its
// assertions first, so the tests decided the writing. Wording is reviewed by
// people; a test that fails when a sentence improves is a tax, not a guard.
//
// What stays here is what a reader would actually notice as broken:
//   - every documented route resolves and renders its heading
//   - every in-page link and fragment points at something real
//   - documented code matches source that compiles, verbatim
//   - documented import specifiers actually resolve
//
// Security and behavior belong in each package's own unit tests, against the
// code. Asserting that a *document describes* a control never verified the
// control.

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
    // The sidebar group is already labelled "Voice"; titling the page "Voice"
    // too rendered a "Voice > Voice" nesting.
    heading: 'Overview',
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

// Each ownership diagram is the only place its guide states some facts — which
// role holds the provider secret, which role the reader does not deploy. An
// Astro component that silently stopped rendering would take those with it, and
// no prose assertion would notice.
const OWNERSHIP_DIAGRAMS = [
  {
    name: 'OpenAI',
    path: '/guides/voice/openai-realtime/',
    model: OPENAI_REALTIME_OWNERSHIP,
    secret: 'OPENAI_API_KEY',
  },
  {
    name: 'LiveKit',
    path: '/guides/voice/livekit-cascade/',
    model: LIVEKIT_CASCADE_OWNERSHIP,
    secret: 'LIVEKIT_API_SECRET',
  },
] as const;

for (const diagram of OWNERSHIP_DIAGRAMS) {
  test(`the ${diagram.name} ownership diagram renders every role and path in its model`, async ({
    page,
  }) => {
    const { model } = diagram;
    await page.goto(diagram.path);
    await expect(page.locator('.own')).toBeVisible();

    // Assert against the drawing, not the whole figure: the text alternative
    // sits inside the figure too, so a figure-wide check would pass on a blank
    // canvas.
    const canvas = page.locator('.own-canvas');
    for (const node of model.nodes) {
      await expect(canvas).toContainText(node.label);
      if (node.holds) await expect(canvas).toContainText(node.holds);
      if (node.lifetime) await expect(canvas).toContainText(node.lifetime);
    }
    for (const edge of model.edges) {
      if (edge.label) await expect(canvas).toContainText(edge.label);
    }
    for (const band of model.bands) {
      await expect(canvas).toContainText(band.label);
    }

    // The drawing is aria-hidden throughout, so the alternative is the only
    // reading of it available to assistive technology and to /llms-full.txt.
    await expect(canvas).toHaveAttribute('aria-label', model.summary);
    await expect(page.locator('.own-sr')).toContainText(diagram.secret);
  });
}

test('voice consumer imports resolve from roots and documented subpaths', async ({
  page,
}) => {
  expect(SPEAK_TOPIC).toBe('speak');
  expect(PROTOCOL_SPEAK_TOPIC).toBe(SPEAK_TOPIC);
  expect(TURN_TOPIC).toBe('turn');
  expect(
    LiveKitTokenGrantSchema.safeParse({
      token: 'root-import-token',
      url: 'wss://livekit.example.test',
      expiresAt: 1,
    }).success,
  ).toBe(true);
  expect(
    TokenEntryLiveKitTokenGrantSchema.safeParse({
      token: 'token-entry-import-token',
      url: 'wss://livekit.example.test',
      expiresAt: 1,
    }).success,
  ).toBe(true);

  expect(typeof OpenAIAdapter).toBe('function');
  expect(
    OpenAITokenGrantSchema.safeParse({
      provider: 'openai',
      value: 'ephemeral-client-secret',
      expiresAt: 1,
      model: 'gpt-realtime-2',
    }).success,
  ).toBe(true);

  await page.goto('/reference/realtime-livekit/readme/');
  const rootReference = page.locator('main');
  await expect(
    rootReference.getByText('packages/realtime-livekit/src/protocol', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    rootReference.getByText('packages/realtime-livekit/src/livekit-token', {
      exact: true,
    }),
  ).toBeVisible();

  await page.goto(
    '/reference/realtime-livekit/packages/realtime-livekit/src/protocol/variables/speak_topic/',
  );
  const sidebar = page.getByRole('navigation', { name: 'Main' });
  await expect(
    sidebar.getByText('packages/realtime-livekit/src/protocol', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 1, name: 'SPEAK_TOPIC' }),
  ).toBeVisible();

  await page.goto(
    '/reference/realtime-livekit/packages/realtime-livekit/src/livekit-token/variables/livekittokengrantschema/',
  );
  await expect(
    sidebar.getByText('packages/realtime-livekit/src/livekit-token', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'LiveKitTokenGrantSchema',
    }),
  ).toBeVisible();
});

test('provider-neutral fixture is compile checked and rendered verbatim', async ({
  page,
}) => {
  const fixtureUrl = new URL(
    './fixtures/voice/provider-neutral.tsx',
    import.meta.url,
  );
  expect(
    existsSync(fixtureUrl),
    'Expected the provider-neutral source fixture to exist',
  ).toBe(true);

  const fixture = readFileSync(fixtureUrl, 'utf8');
  const setup = fixture.match(
    /\/\* docs:provider-neutral-setup:start \*\/([\s\S]*?)\/\* docs:provider-neutral-setup:end \*\//,
  )?.[1];
  const controls = fixture.match(
    /\/\* docs:provider-neutral-controls:start \*\/([\s\S]*?)\/\* docs:provider-neutral-controls:end \*\//,
  )?.[1];
  expect(setup, 'Expected the setup fixture region').toBeDefined();

  // The controls region is the only compile-checked `m.useVoice()` call in the
  // docs — the guides' own React components are unchecked prose. It no longer
  // renders anywhere (the overview routes rather than teaches), so this asserts
  // the type coverage still exists rather than where it appears. `docs:typecheck`
  // is what actually fails when a field on `UseVoiceResult` is renamed.
  expect(controls, 'Expected the controls fixture region').toBeDefined();
  for (const surface of ['m.useVoice()', 'm.VoiceOrb', 'turnControl']) {
    expect(controls).toContain(surface);
  }

  await page.goto('/guides/voice/overview/');
  const guide = page.locator('main');
  const renderedCode = (await guide.locator('pre').allTextContents())
    .join('\n')
    .replace(/\s+/g, '');
  expect(renderedCode).toContain((setup ?? '').replace(/\s+/g, ''));

  // The overview shows the one-line extension seam and nothing more; the full
  // control belongs to the provider guides, which teach it with imports.
  expect(renderedCode).not.toContain((controls ?? '').replace(/\s+/g, ''));
});

test('OpenAI fixture regions are compile checked and rendered verbatim', async ({
  page,
}) => {
  const fixtureUrl = new URL(
    './fixtures/voice/openai-realtime.tsx',
    import.meta.url,
  );
  expect(
    existsSync(fixtureUrl),
    'Expected the OpenAI source fixture to exist',
  ).toBe(true);

  const fixture = readFileSync(fixtureUrl, 'utf8');
  const regionNames = ['browser-grant', 'adapter-setup'];
  // The minimal route lives in its own fixture: it is the only route the guide
  // shows, and it exports `POST`, the name a reader actually types.
  const minimal = readFileSync(
    new URL('./fixtures/voice/openai-realtime-minimal.tsx', import.meta.url),
    'utf8',
  ).match(
    /\/\* docs:openai-minimal-minter:start \*\/([\s\S]*?)\/\* docs:openai-minimal-minter:end \*\//,
  )?.[1];
  expect(minimal, 'Expected the minimal minter fixture region').toBeDefined();
  // A first route a reader can ship by accident is the whole risk here, so the
  // minimal one authenticates and refuses to be cached even before hardening.
  expect(minimal).toContain('requireAuthenticatedRealtimeSession');
  expect(minimal).toContain("'Cache-Control': 'private, no-store'");

  await page.goto('/guides/voice/openai-realtime/');
  const renderedCode = (await page.locator('main pre').allTextContents())
    .join('\n')
    .replace(/\s+/g, '');

  for (const regionName of regionNames) {
    const region = fixture.match(
      new RegExp(
        `/\\* docs:openai-${regionName}:start \\*/([\\s\\S]*?)/\\* docs:openai-${regionName}:end \\*/`,
      ),
    )?.[1];
    expect(region, `Expected the ${regionName} fixture region`).toBeDefined();
    expect(renderedCode).toContain((region ?? '').replace(/\s+/g, ''));
  }
  expect(renderedCode).toContain((minimal ?? '').replace(/\s+/g, ''));

  const voiceControl = readFileSync(
    new URL('./fixtures/voice/openai-voice-control.tsx', import.meta.url),
    'utf8',
  ).match(
    /\/\* docs:openai-voice-control:start \*\/([\s\S]*?)\/\* docs:openai-voice-control:end \*\//,
  )?.[1];
  expect(
    voiceControl,
    'Expected the voice-control fixture region',
  ).toBeDefined();
  expect(renderedCode).toContain((voiceControl ?? '').replace(/\s+/g, ''));
});

function normalizeDocumentedCode(source: string): string {
  // Biome formats TypeScript fixtures with single quotes, while the MDX
  // formatter preserves double quotes in fenced examples. Quote style is the
  // only intentional difference between the compile-checked and rendered code.
  return source
    .replace(/\r\n/g, '\n')
    .replaceAll('"', "'")
    .replace(/\s+/g, '');
}

test('LiveKit browser fixture matches its source-backed examples', async ({
  page,
}) => {
  const fixtureUrl = new URL(
    './fixtures/voice/livekit-cascade.tsx',
    import.meta.url,
  );
  expect(
    existsSync(fixtureUrl),
    'Expected the LiveKit browser source fixture to exist',
  ).toBe(true);

  const fixture = readFileSync(fixtureUrl, 'utf8');
  const contracts = [
    {
      regionName: 'adapter-setup',
      source: '../src/content/docs/tutorials/run-voice-locally.mdx',
      route: '/tutorials/run-voice-locally/',
    },
    {
      regionName: 'turn-control',
      source: '../src/content/docs/guides/voice/livekit-cascade.mdx',
      route: '/guides/voice/livekit-cascade/',
    },
  ] as const;

  for (const contract of contracts) {
    const guideSource = readFileSync(
      new URL(contract.source, import.meta.url),
      'utf8',
    );
    const region = fixture.match(
      new RegExp(
        `/\\* docs:livekit-${contract.regionName}:start \\*/([\\s\\S]*?)/\\* docs:livekit-${contract.regionName}:end \\*/`,
      ),
    )?.[1];
    expect(
      region,
      `Expected the ${contract.regionName} fixture region`,
    ).toBeDefined();

    await page.goto(contract.route);
    const renderedCode = (await page.locator('main pre').allTextContents()).join(
      '\n',
    );
    const normalizedRegion = normalizeDocumentedCode((region ?? '').trim());
    expect(normalizeDocumentedCode(guideSource)).toContain(normalizedRegion);
    expect(normalizeDocumentedCode(renderedCode)).toContain(normalizedRegion);
  }

  expect(fixture).toContain('turnControl.startTurn()');
  expect(fixture).toContain('turnControl.endTurn()');
  expect(fixture).not.toContain('startTalking');
  expect(fixture).not.toContain('stopTalking');
});

test('LiveKit production fixture matches the rendered guide examples', async ({
  page,
}) => {
  const fixtureUrl = new URL(
    './fixtures/voice/livekit-cascade.tsx',
    import.meta.url,
  );
  const fixture = readFileSync(fixtureUrl, 'utf8');
  const guideSource = readFileSync(
    new URL(
      '../src/content/docs/guides/voice/livekit-cascade.mdx',
      import.meta.url,
    ),
    'utf8',
  );

  await page.goto('/guides/voice/livekit-cascade/');
  const renderedCode = (await page.locator('main pre').allTextContents())
    .join('\n')
    .replace(/\s+/g, '');

  // browser-grant is its own region because it is browser code. It used to sit
  // inside the server route's region, under a `server/livekit-token.ts`
  // filename, which told the reader to put a browser fetch in a server-only file.
  for (const regionName of [
    'minimal-minter',
    'browser-grant',
    'worker-reference',
  ]) {
    const region = fixture.match(
      new RegExp(
        `/\\* docs:livekit-${regionName}:start \\*/([\\s\\S]*?)/\\* docs:livekit-${regionName}:end \\*/`,
      ),
    )?.[1];
    expect(region, `Expected the ${regionName} fixture region`).toBeDefined();
    const normalizedRegion = normalizeDocumentedCode((region ?? '').trim());
    expect(normalizeDocumentedCode(guideSource)).toContain(normalizedRegion);
    expect(normalizeDocumentedCode(renderedCode)).toContain(normalizedRegion);
  }

  // These dedicated fixtures remain compile checked by the docs TypeScript
  // project, but the guide no longer renders them verbatim. Keep their safety
  // contracts explicit without pretending that they are current guide source.
  const sessionStateFixture = readFileSync(
    new URL('./fixtures/voice/livekit-session-state.tsx', import.meta.url),
    'utf8',
  );
  expect(sessionStateFixture).toContain("turnMode === 'manual'");
  expect(sessionStateFixture).toContain('turnModeError !== undefined');
  expect(sessionStateFixture).toContain(
    'Automatic voice detection is unavailable. Hold to talk instead.',
  );

  const holdToTalkFixture = readFileSync(
    new URL('./fixtures/voice/livekit-hold-to-talk.tsx', import.meta.url),
    'utf8',
  );
  for (const retainedSafetyContract of [
    'turnControl.startTurn()',
    'turnControl?.endTurn()',
    'onPointerCancel={endPress}',
    'onLostPointerCapture={cancelPress}',
    "addEventListener('visibilitychange'",
  ]) {
    expect(holdToTalkFixture).toContain(retainedSafetyContract);
  }
});

// Check only links directly present in the three guides. This intentionally
// does not recurse through the generated TypeDoc graph.
for (const guide of GUIDE_ROUTES) {
  test(`${guide.name} has valid same-origin links and fragments`, async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);

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
