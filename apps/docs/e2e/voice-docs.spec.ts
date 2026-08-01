import { existsSync, readFileSync } from 'node:fs';
// The docs project already declares this package as an implicit dependency.
// nx-ignore-next-line
import {
  LiveKitTokenGrantSchema,
  SPEAK_TOPIC,
} from '@maelstrom-co/realtime-livekit';
import {
  OpenAIAdapter,
  OpenAITokenGrantSchema,
} from '@maelstrom-co/realtime-openai';
import { LiveKitTokenGrantSchema as TokenEntryLiveKitTokenGrantSchema } from '@maelstrom-co/realtime-protocol/livekit';
import {
  SPEAK_TOPIC as PROTOCOL_SPEAK_TOPIC,
  TURN_TOPIC,
} from '@maelstrom-co/realtime-protocol/livekit-wire';
import { expect, test } from '@playwright/test';
import { LIVEKIT_CASCADE_OWNERSHIP } from '../src/components/ownership/livekit-cascade';
import { LIVEKIT_TURN_OWNERSHIP } from '../src/components/ownership/livekit-turn-ownership';
import { OPENAI_REALTIME_OWNERSHIP } from '../src/components/ownership/openai-realtime';
import { VOICE_BOUNDARY } from '../src/components/ownership/voice-boundary';
import { LIVEKIT_BARGE_IN } from '../src/components/sequence/livekit-barge-in';

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

/** Reads one compile-checked fixture that sits beside this spec. */
function readFixture(name: string): string {
  const url = new URL(`./fixtures/voice/${name}.tsx`, import.meta.url);
  expect(existsSync(url), `Expected the ${name} source fixture to exist`).toBe(
    true,
  );
  return readFileSync(url, 'utf8');
}

/** Body of one `docs:<name>` region. A missing region fails here, not later. */
function region(fixture: string, name: string): string {
  const body = fixture.match(
    new RegExp(
      `/\\* docs:${name}:start \\*/([\\s\\S]*?)/\\* docs:${name}:end \\*/`,
    ),
  )?.[1];
  expect(body, `Expected the ${name} fixture region`).toBeDefined();
  return body ?? '';
}

// Two comparisons, two normalizations, and which one applies is not a matter of
// taste. MDX source keeps the fixture's own line breaks, so only trailing
// whitespace may legitimately differ, and asserting on it there is what catches
// a hand-edited snippet. Rendered `<pre>` text has been through the highlighter,
// which reflows it, so nothing but the non-whitespace characters survives.
// Mixing the two lets drift pass in whichever copy happened to be laxer.
const asSource = (text: string) =>
  text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
const asRendered = (text: string) => text.replace(/\s+/g, '');

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
  {
    name: 'voice boundary explanation',
    path: '/understanding/voice-architecture/',
    heading: 'The voice boundary',
  },
  {
    name: 'turn detection explanation',
    path: '/understanding/browser-vad-and-barge-in/',
    heading: 'Turn detection in the browser',
  },
  {
    name: 'realtime voice tutorial',
    path: '/tutorials/run-voice-locally/',
    heading: 'Run the voice demo locally',
  },
  {
    name: 'cascade voice tutorial',
    path: '/tutorials/run-the-cascade-locally/',
    heading: 'Run the cascade demo locally',
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
    name: '@maelstrom-co/realtime-openai-server landing',
    path: '/reference/realtime-openai-server/readme/',
    heading: '@maelstrom-co/realtime-openai-server',
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
    path: '/reference/realtime-openai/classes/openaiadapter/',
    heading: 'OpenAIAdapter',
    context: 'packages/realtime-openai/src/openai-adapter.ts',
  },
  {
    name: 'OpenAITokenGrantSchema',
    path: '/reference/realtime-protocol/packages/realtime-protocol/src/openai/variables/openaitokengrantschema/',
    heading: 'OpenAITokenGrantSchema',
    context: 'packages/realtime-protocol/src/lib/openai-token.ts',
    entryPoint: 'packages/realtime-protocol/src/openai',
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
    path: '/reference/realtime-openai-server/functions/createopenaiminter/',
    heading: 'createOpenAIMinter',
    context: 'packages/realtime-openai-server/src/lib/openai-mint.ts',
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
    path: '/reference/realtime-protocol/packages/realtime-protocol/src/livekit-wire/variables/speak_topic/',
    heading: 'SPEAK_TOPIC',
    context: 'packages/realtime-protocol/src/livekit-wire.ts',
    entryPoint: 'packages/realtime-protocol/src/livekit-wire',
  },
  {
    name: 'TtsDoneMessage',
    path: '/reference/realtime-protocol/packages/realtime-protocol/src/livekit-wire/interfaces/ttsdonemessage/',
    heading: 'TtsDoneMessage',
    context: 'packages/realtime-protocol/src/livekit-wire.ts',
    entryPoint: 'packages/realtime-protocol/src/livekit-wire',
  },
  {
    name: 'LiveKitTokenGrantSchema',
    path: '/reference/realtime-protocol/packages/realtime-protocol/src/livekit/variables/livekittokengrantschema/',
    heading: 'LiveKitTokenGrantSchema',
    context: 'packages/realtime-protocol/src/lib/livekit-token.ts',
    entryPoint: 'packages/realtime-protocol/src/livekit',
  },
  {
    // The README tells readers to import from `./assets`, so it needs a
    // reference page. A published subpath missing from the TypeDoc entry points
    // documents an import that lands nowhere.
    name: 'copyBrowserVadAssets',
    path: '/reference/realtime-vad/packages/realtime-vad/src/vad-assets/functions/copybrowservadassets/',
    heading: 'copyBrowserVadAssets',
    context: 'packages/realtime-vad/src/vad-assets.ts',
    entryPoint: 'packages/realtime-vad/src/vad-assets',
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

// The sidebar is hand-curated, not generated from the content collection, so a
// new page renders perfectly and is reachable only by whoever already knows its
// URL. Nothing else in the build notices.
for (const route of GUIDE_ROUTES) {
  test(`${route.name} is reachable from the sidebar`, async ({ page }) => {
    await page.goto(route.path);
    const sidebar = page.getByRole('navigation', { name: 'Main' });
    await expect(sidebar.locator(`a[href="${route.path}"]`)).toHaveCount(1);
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
  {
    name: 'voice boundary',
    path: '/understanding/voice-architecture/',
    model: VOICE_BOUNDARY,
    // Not a credential here: the claim this page turns on is an absence, and a
    // struck path is invisible to a screen reader unless the text says so.
    secret: 'has no path to Engine',
  },
  {
    name: 'turn ownership',
    path: '/understanding/browser-vad-and-barge-in/',
    model: LIVEKIT_TURN_OWNERSHIP,
    secret: 'has no path to LiveKit room',
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

// The barge-in drawing's whole claim is ordering, and the SVG is aria-hidden,
// so the ordered text alternative is the only version of that claim most tools
// can read. A component that stopped emitting it would take the argument with
// it while the picture still looked fine.
test('the barge-in sequence renders every participant, step, and its order', async ({
  page,
}) => {
  await page.goto('/understanding/browser-vad-and-barge-in/');
  const canvas = page.locator('.seq-canvas');
  await expect(canvas).toBeVisible();

  for (const participant of LIVEKIT_BARGE_IN.participants) {
    await expect(canvas).toContainText(participant.label);
  }
  for (const step of LIVEKIT_BARGE_IN.steps) {
    await expect(canvas).toContainText(step.label);
  }
  // The drawing is hidden from assistive technology, so the alternative has to
  // carry the summary as well as the steps. Asserting the summary here rather
  // than as the SVG's aria-label is the point: two labelled representations of
  // one diagram get announced back to back.
  await expect(canvas).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('.seq-sr')).toContainText(LIVEKIT_BARGE_IN.summary);

  const steps = page.locator('.seq-sr li');
  await expect(steps).toHaveCount(LIVEKIT_BARGE_IN.steps.length);

  // Concurrent steps share a number. Muting playback and dropping the utterance
  // id are one instant of local work, and numbering them 3 and 4 would tell a
  // reader to expect a delay between them. The cancel that follows is a
  // published message and deliberately keeps its own later number.
  const numbered = await steps.allTextContents();
  const shared = numbered.filter((text) => text.startsWith('3.'));
  expect(shared.length).toBe(2);
  expect(numbered.some((text) => text.startsWith('4. LiveKitAdapter'))).toBe(
    true,
  );
});

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
  await expect(
    rootReference.getByText('packages/realtime-livekit/src/vad-assets', {
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
  const fixture = readFixture('provider-neutral');
  const setup = region(fixture, 'provider-neutral-setup');
  const controls = region(fixture, 'provider-neutral-controls');

  // The controls region is the only compile-checked `m.useVoice()` call in the
  // docs — the guides' own React components are unchecked prose. It no longer
  // renders anywhere (the overview routes rather than teaches), so this asserts
  // the type coverage still exists rather than where it appears. `docs:typecheck`
  // is what actually fails when a field on `UseVoiceResult` is renamed; deleting
  // the region as unused is the drift this catches.
  for (const surface of ['m.useVoice()', 'm.VoiceOrb', 'turnControl']) {
    expect(controls).toContain(surface);
  }

  await page.goto('/guides/voice/overview/');
  const rendered = (await page.locator('main pre').allTextContents()).join(
    '\n',
  );
  expect(asRendered(rendered)).toContain(asRendered(setup));

  // The overview shows the one-line extension seam and nothing more; the full
  // control belongs to the provider guides, which teach it with imports.
  expect(asRendered(rendered)).not.toContain(asRendered(controls));
});

test('OpenAI fixture regions are compile checked and rendered verbatim', async ({
  page,
}) => {
  const fixture = readFixture('openai-realtime');
  // The minimal route lives in its own fixture: it is the only route the guide
  // shows, and it exports `POST`, the name a reader actually types.
  const minimal = region(
    readFixture('openai-realtime-minimal'),
    'openai-minimal-minter',
  );
  // A first route a reader can ship by accident is the whole risk here, so the
  // minimal one authenticates and refuses to be cached even before hardening.
  expect(minimal).toContain('requireAuthenticatedRealtimeSession');
  expect(minimal).toContain("'Cache-Control': 'private, no-store'");

  const voiceControl = region(
    readFixture('openai-voice-control'),
    'openai-voice-control',
  );

  await page.goto('/guides/voice/openai-realtime/');
  const rendered = asRendered(
    (await page.locator('main pre').allTextContents()).join('\n'),
  );

  for (const name of ['browser-grant', 'adapter-setup']) {
    expect(rendered).toContain(asRendered(region(fixture, `openai-${name}`)));
  }
  expect(rendered).toContain(asRendered(minimal));
  expect(rendered).toContain(asRendered(voiceControl));
});

test('LiveKit browser fixture covers turn control and renders verbatim', async ({
  page,
}) => {
  const fixture = readFixture('livekit-cascade');
  // The adapter and held-turn excerpts teach a first working turn, so they live
  // on the tutorial. The guide's own adapter section is the hardened variant.
  const tutorialSource = asSource(
    readFileSync(
      new URL(
        '../src/content/docs/tutorials/run-the-cascade-locally.mdx',
        import.meta.url,
      ),
      'utf8',
    ),
  );

  await page.goto('/tutorials/run-the-cascade-locally/');
  const rendered = asRendered(
    (await page.locator('main pre').allTextContents()).join('\n'),
  );

  for (const name of ['adapter-setup', 'turn-control']) {
    const body = region(fixture, `livekit-${name}`);
    expect(tutorialSource).toContain(asSource(body));
    expect(rendered).toContain(asRendered(body));
  }

  expect(fixture).toContain('turnControl.startTurn()');
  expect(fixture).toContain('turnControl.endTurn()');
  expect(fixture).not.toContain('startTalking');
  expect(fixture).not.toContain('stopTalking');
});

test('LiveKit production fixture is compile checked and rendered verbatim', async ({
  page,
}) => {
  const fixture = readFixture('livekit-cascade');
  const guideSource = asSource(
    readFileSync(
      new URL(
        '../src/content/docs/guides/voice/livekit-cascade.mdx',
        import.meta.url,
      ),
      'utf8',
    ),
  );

  await page.goto('/guides/voice/livekit-cascade/');
  const rendered = asRendered(
    (await page.locator('main pre').allTextContents()).join('\n'),
  );

  // browser-grant is its own region because it is browser code. It used to sit
  // inside the server route's region, under a `server/livekit-token.ts`
  // filename, which told the reader to put a browser fetch in a server-only file.
  // guide-adapter is the production variant, distinct from the tutorial's
  // adapter-setup region. Leaving it uncovered is how the guide came to import
  // from a filename it never creates while the suite still claimed the code
  // here compiles.
  //
  // The session-state and hold-to-talk controls live in their own fixtures.
  // Hold-to-talk is the largest component in the voice docs and was previously
  // prose nobody compiled.
  const bodies = [
    ...[
      'minimal-minter',
      'browser-grant',
      'guide-adapter',
      // Both `vad` forms. The guide's default path depends on automatic mode
      // working, and an unaccepted key here is a type error rather than a
      // setting that quietly does nothing — so the examples have to compile.
      'vad-tuning',
      'vad-off',
      'worker-reference',
    ].map((name) => region(fixture, `livekit-${name}`)),
    region(readFixture('livekit-session-state'), 'livekit-session-state'),
    region(readFixture('livekit-hold-to-talk'), 'livekit-hold-to-talk'),
  ];

  for (const body of bodies) {
    expect(guideSource).toContain(asSource(body));
    expect(rendered).toContain(asRendered(body));
  }
});

// Check only links directly present in the authored voice pages. This
// intentionally does not recurse through the generated TypeDoc graph.
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
