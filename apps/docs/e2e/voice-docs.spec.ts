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

const LIVEKIT_SERVER_README = readFileSync(
  new URL(
    '../../../packages/realtime-livekit-server/README.md',
    import.meta.url,
  ),
  'utf8',
);
const NORMALIZED_LIVEKIT_SERVER_README = LIVEKIT_SERVER_README.replace(
  /\s+/g,
  ' ',
);
const REALTIME_SERVER_README = readFileSync(
  new URL('../../../packages/realtime-server/README.md', import.meta.url),
  'utf8',
);
const NORMALIZED_REALTIME_SERVER_README = REALTIME_SERVER_README.replace(
  /\s+/g,
  ' ',
);
const REALTIME_VOICE_ARCHITECTURE = readFileSync(
  new URL('../../../docs/realtime-voice-architecture.md', import.meta.url),
  'utf8',
);
const ROOT_README = readFileSync(
  new URL('../../../README.md', import.meta.url),
  'utf8',
);

/**
 * Requires every marker to exist in the excerpt and appear in strict order.
 * Missing markers fail explicitly instead of letting `indexOf()` return `-1`
 * and accidentally satisfy a later ordering comparison. Empty marker strings
 * are invalid, while an empty marker list is a no-op. Each lookup uses
 * `indexOf()`, so it compares the first occurrence of each marker. Duplicate
 * marker entries therefore fail strict ordering even when the excerpt repeats
 * that text; distinct later markers can still follow repeated excerpt text.
 */
function expectMarkersInOrder(
  excerpt: string,
  markers: readonly string[],
): void {
  let previousMarker: string | undefined;
  let previousIndex = -1;

  for (const marker of markers) {
    expect(marker, 'Expected route marker to be non-empty').not.toBe('');
    const markerIndex = excerpt.indexOf(marker);
    expect(
      markerIndex,
      `Expected route excerpt to contain "${marker}"`,
    ).toBeGreaterThanOrEqual(0);

    if (previousMarker !== undefined) {
      expect(
        markerIndex,
        `Expected "${marker}" to follow "${previousMarker}"`,
      ).toBeGreaterThan(previousIndex);
    }

    previousMarker = marker;
    previousIndex = markerIndex;
  }
}

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

test('voice overview explains runtime ownership and control tradeoffs', async ({
  page,
}) => {
  await page.goto('/guides/voice/overview/');

  const openAIDiagram = page.getByRole('document', {
    name: 'OpenAI Realtime runtime ownership',
  });
  await expect(openAIDiagram).toBeVisible();
  await expect(openAIDiagram).toHaveAttribute('aria-labelledby', /\S/);
  await expect(openAIDiagram.locator('desc')).toHaveText(
    'Browser audio and session data travel directly to OpenAI after a stateless server route mints a short-lived client credential.',
  );

  const liveKitDiagram = page.getByRole('document', {
    name: 'LiveKit cascade runtime ownership',
  });
  await expect(liveKitDiagram).toBeVisible();
  await expect(liveKitDiagram).toHaveAttribute('aria-labelledby', /\S/);
  await expect(liveKitDiagram.locator('desc')).toHaveText(
    'A stateless authenticated route mints a room grant; the worker publishes final transcripts, and the browser routes intents and settled results.',
  );

  const prose = page.locator('main :is(p, li)');
  for (const fact of [
    'browser opens WebRTC directly to OpenAI',
    'Microphone audio and realtime session data flow between the browser and OpenAI',
    'stateless server token route uses its server-held OpenAI API key',
    'returns a short-lived client credential',
    'ends after each mint request',
    'OpenAI operates the long-running realtime model session',
    'browser LiveKit adapter joins a LiveKit room',
    'stateless authenticated token route uses server-held LiveKit credentials',
    'sign a short-lived room grant',
    'LiveKit room relays microphone audio and session data from the browser to a separate STT/TTS worker',
    'synthesized audio and session data back to the browser',
    'worker holds the speech-provider credentials',
    'stays attached for session work',
    'worker publishes each final transcript',
    'browser adapter turns that transcript into an ordinary Maelstrom intent',
    'successful UI updates wait for rendering to settle',
    'successful result returns through LiveKit for worker TTS',
    'Malformed tool arguments and genuine submission failures return failure results immediately',
  ]) {
    await expect(prose.filter({ hasText: fact })).not.toHaveCount(0);
  }

  await expect(
    prose.filter({ hasText: 'provider-managed model and turns' }),
  ).not.toHaveCount(0);
  await expect(
    prose.filter({ hasText: 'control over STT, TTS, and room participation' }),
  ).not.toHaveCount(0);
  await expect(
    prose.filter({ hasText: 'three runtime roles' }),
  ).not.toHaveCount(0);
  await expect(
    prose.filter({ hasText: 'Hold-to-talk is the current interaction mode' }),
  ).not.toHaveCount(0);
});

test('OpenAI guide follows the how-to contract', async ({ page }) => {
  await page.goto('/guides/voice/openai-realtime/');

  const guide = page.locator('main');
  const steps = guide.locator('.sl-steps > li');
  await expect(steps).toHaveCount(6);

  // Step titles are bold, not headings: the same titles head the H2 sections
  // below, and two headings with one title collide on a single anchor slug.
  const stepTitles = [
    'Add the server mint route',
    'Validate the browser grant',
    'Connect the adapter and React binding',
    'Render state and transcripts',
    'Preserve speak-after-render and grounding',
    'Harden the deployment',
  ];
  for (const [index, title] of stepTitles.entries()) {
    await expect(
      steps.nth(index).getByText(title, { exact: true }),
    ).toBeVisible();
    await expect(
      guide.getByRole('heading', { level: 2, name: title }),
    ).toBeVisible();
  }

  await expect(
    guide.getByRole('heading', { level: 2, name: 'Verify' }),
  ).toBeVisible();
  const verification = guide
    .getByRole('list')
    .filter({ hasText: 'schema-valid grant' })
    .filter({ hasText: 'rendering settle before assistant narration' });
  for (const outcome of [
    'schema-valid grant',
    'private, no-store',
    'connected',
    'user transcript',
    'rendering settle before assistant narration',
  ]) {
    await expect(
      verification.getByText(outcome, { exact: false }),
    ).toBeVisible();
  }
  await expect(guide).toContainText(
    'this example does not send OpenAI-Safety-Identifier',
  );
  await expect(guide).toContainText(
    'Malformed tool arguments and genuine submission failures return failure results immediately',
  );
  await expect(guide).toContainText(
    'OpenAI manages turn detection, model responses, and response audio',
  );
  await expect(guide).toContainText(
    'attaches the remote audio stream to an autoplay audio element',
  );
  for (const status of [
    '400 Bad Request',
    '401 Unauthorized',
    '403 Forbidden',
    '429 Too Many Requests',
    '500 Internal Server Error',
    '502 Bad Gateway',
  ]) {
    await expect(guide).toContainText(status);
  }
  await expect(
    guide.getByRole('link', { name: 'OpenAI Realtime WebRTC guide' }),
  ).toHaveAttribute(
    'href',
    'https://platform.openai.com/docs/guides/realtime-webrtc',
  );
  await expect(
    guide.getByRole('link', { name: 'OpenAI Realtime guide', exact: true }),
  ).toHaveAttribute('href', 'https://platform.openai.com/docs/guides/realtime');
  const hardeningChecklist = guide
    .getByRole('list')
    .filter({ hasText: 'bind the caller to an allowed Maelstrom session' })
    .filter({ hasText: 'avoid logging the API key' });
  await expect(hardeningChecklist).toContainText('validate the CSRF');
});

test('LiveKit guide follows server-owned three-role setup', async ({
  page,
}) => {
  await page.goto('/guides/voice/livekit-cascade/');

  const guide = page.locator('main');
  await expect(
    guide.getByRole('heading', { level: 2, name: 'The three runtime roles' }),
  ).toBeVisible();
  for (const roleContract of [
    'browser bundle',
    'stateless authenticated token route',
    'separately deployed long-running worker',
    'worker stays model-free',
    'final transcript returns through the browser as ordinary intent',
    'TTS starts only after rendering settles',
    'Malformed tool arguments and genuine submission failures return failure results immediately',
    'bounds the fallback when a flush-produced final transcript does not arrive',
    'emits buffered text when any is available',
    'An empty held turn produces no final transcript, no intent or Engine request, and no spoken response',
    'empty turn emits nothing',
    'bounded empty-turn fallback',
    'session returns to connected',
  ]) {
    await expect(guide).toContainText(roleContract);
  }

  await expect(
    guide.getByRole('heading', {
      level: 2,
      name: 'Run the checked-in demo locally',
    }),
  ).toBeVisible();
  const localDemoCommands = guide.locator('pre');
  await expect(
    localDemoCommands.filter({ hasText: 'livekit-server --dev' }),
  ).toHaveText('livekit-server --dev');
  await expect(
    guide.getByRole('link', { name: 'Install LiveKit Server' }),
  ).toHaveAttribute('href', 'https://docs.livekit.io/home/self-hosting/local');
  await expect(
    localDemoCommands.filter({ hasText: 'bunx nx dev-livekit demo' }),
  ).toHaveText('bunx nx dev-livekit demo');
  for (const localDemoBoundary of [
    'well-known insecure devkey / secret credentials',
    'checked-in demo mint route',
    'development-only and is not deployable',
  ]) {
    await expect(guide).toContainText(localDemoBoundary);
  }
  await expect(
    guide.getByRole('link', {
      name: 'production token and worker checkpoint',
    }),
  ).toHaveAttribute('href', '#add-the-server-token-route');
  expectMarkersInOrder((await guide.textContent()) ?? '', [
    'Run the checked-in demo locally',
    'Steps',
    'Add the server token route',
  ]);

  const steps = guide.locator('.sl-steps > li');
  // Step titles are bold, not headings: the same titles head the H2 sections
  // below, and two headings with one title collide on a single anchor slug.
  // Each title must name exactly one H2 — the demo checkpoint earlier on this
  // page covers the same ground, so its headings must stay distinct from these.
  const stepTitles = [
    'Add the server token route',
    'Start the STT/TTS worker',
    'Validate the token contract in the browser',
    'Connect the hardened browser adapter',
    'Use the protocol entry point',
    'Render a safe hold-to-talk control',
    'Harden the deployment',
  ];
  await expect(steps).toHaveCount(stepTitles.length);
  for (const [index, title] of stepTitles.entries()) {
    await expect(
      steps.nth(index).getByText(title, { exact: true }),
    ).toBeVisible();
    await expect(
      guide.getByRole('heading', { level: 2, name: title }),
    ).toBeVisible();
  }

  await expect(guide).toContainText('mintToken(roomName)');
  await expect(guide).toContainText(
    'deliberately ignores that browser-side callback argument',
  );
  await expect(guide).toContainText(
    'signed grant alone selects and authorizes the actual room',
  );

  const tokenRoute = guide
    .locator('pre')
    .filter({ hasText: 'export async function POST' });
  for (const serverOwnedControl of [
    'requireAuthenticatedVoiceSession',
    'isTrustedVoiceMintOrigin(request)',
    'isValidVoiceMintCsrf',
    'consumeVoiceMintRateLimit',
    'roomName: authenticated.roomName',
    'identity: authenticated.identity',
    "'Cache-Control': 'private, no-store'",
  ]) {
    await expect(tokenRoute).toContainText(serverOwnedControl);
  }

  const browserMint = guide.locator('pre').filter({
    hasText: 'export async function fetchAuthenticatedLiveKitToken',
  });
  await expect(browserMint).toContainText(/credentials:\s*["']same-origin["']/);
  await expect(browserMint).toContainText(
    /["']X-CSRF-Token["']:\s*getCsrfToken\(\)/,
  );
  const browserMintExcerpt =
    (await browserMint.textContent())?.split(
      'export async function fetchAuthenticatedLiveKitToken',
    )[1] ?? '';
  expect(browserMintExcerpt).not.toContain('roomName');
  expect(browserMintExcerpt).not.toContain('identity');

  await expect(
    guide.getByRole('heading', { level: 2, name: 'Verify' }),
  ).toBeVisible();
  const verification = guide
    .getByRole('list')
    .filter({ hasText: 'Token route' })
    .filter({ hasText: 'TTS follows settle' });
  for (const outcome of [
    'grant validates',
    'connected',
    'worker joins',
    'final transcript',
    'listening',
    'thinking',
    'speaking',
    'intent renders',
    'TTS follows settle',
  ]) {
    await expect(verification).toContainText(outcome);
  }
});

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

test('JSDoc contract lists published subpath examples', async ({ page }) => {
  await page.goto('/community/jsdoc-contract/');

  const listItems = page.getByRole('listitem');
  for (const mapping of [
    '@maelstrom-co/realtime/openai → src/openai.ts.',
    '@maelstrom-co/realtime-livekit/protocol → src/protocol.ts.',
    '@maelstrom-co/realtime-livekit/token → src/livekit-token.ts.',
  ]) {
    await expect(listItems.getByText(mapping, { exact: true })).toBeVisible();
  }
});

test('LiveKit hold-to-talk example renders its session and local-operation error contracts', async ({
  page,
}) => {
  await page.goto('/guides/voice/livekit-cascade/');

  const example = page
    .locator('pre')
    .filter({ hasText: 'export function HoldToTalk' });
  await expect(example).toContainText(
    'const { state, error, turnControl } = m.useVoice();',
  );
  await expect(example).toContainText(
    'import { RealtimeVoiceError } from "@maelstrom-co/realtime";',
  );
  await expect(example).toContainText(
    'const [operationFailure, setOperationFailure] = useState<string>();',
  );
  await expect(example).toContainText(
    'setOperationFailure(OPERATION_FAILURE_COPY);',
  );
  await expect(example).toContainText('setOperationFailure(undefined);');
  await expect(example).toContainText(
    'Voice control failed. Release the control, then try again.',
  );
  await expect(example).toContainText(
    'function voiceSessionErrorCopy(error: unknown): string',
  );
  await expect(example).toContainText('error instanceof RealtimeVoiceError');
  await expect(example).toContainText('case "MIC_PERMISSION_DENIED":');
  await expect(example).toContainText(
    'Microphone access was denied. Allow microphone access before reconnecting.',
  );
  await expect(example).toContainText('case "TOKEN_MINT_FAILED":');
  await expect(example).toContainText(
    'Voice credentials could not be issued. Check the voice server, then reconnect.',
  );
  for (const code of [
    'CONNECTION_FAILED',
    'DATA_CHANNEL_ERROR',
    'ALREADY_CONNECTED',
    'CONNECT_SUPERSEDED',
  ]) {
    await expect(example).toContainText(`case "${code}":`);
  }
  await expect(example).toContainText(
    'The voice connection failed. Reconnect voice to continue.',
  );
  await expect(example).toContainText('The voice session failed unexpectedly.');
  await expect(example).toContainText(
    'error === undefined ? undefined : voiceSessionErrorCopy(error)',
  );
  await expect(example).toContainText('disabled={!connected}');
  await expect(example).toContainText('aria-describedby={alertCopy');
  await expect(example).toContainText('role="alert"');
  await expect(example).toContainText('reconnect voice');
  await expect(example).toContainText('onLostPointerCapture');
  await expect(example).toContainText('reportHoldToTalkFailureSafely');
  await expect(example).toContainText('reportRedactedVoiceFailure');
  await expect(example).toContainText('try {');
  await expect(example).toContainText('await turnControl?.endTurn();');
  await expect(example).toContainText('finally {');
  await expect(example).toContainText('turnActive.current = false;');
  await expect(example).toContainText(
    'console.warn("Voice telemetry unavailable.")',
  );
  await expect(example).not.toContainText('console.error');
  await expect(example).not.toContainText('error.message');
  await expect(example).not.toContainText('error.stack');
  await expect(example).not.toContainText('error.cause');
  await expect(example).not.toContainText('error.diagnostics');
  await expect(example).not.toContainText('error.session');
  await expect(example).not.toContainText('error.credentials');
  await expect(example).toContainText('window.addEventListener("blur"');
  await expect(example).toContainText(
    'document.addEventListener("visibilitychange"',
  );
  await expect(page.locator('main')).toContainText(
    'This excerpt is illustrative rather than a standalone runnable unit; validate its behavior in your application integration.',
  );
});

test('voice guides state their integration and media-lifecycle boundaries', async ({
  page,
}) => {
  await page.goto('/guides/voice/openai-realtime/');
  const openAIGuide = page.locator('main');
  await expect(openAIGuide).toContainText('illustrative integration excerpts');
  await expect(openAIGuide).toContainText('begins microphone capture');
  await expect(openAIGuide).toContainText('until disconnect');
  const openAIControl = page
    .locator('pre')
    .filter({ hasText: 'export function VoiceControl' });
  await expect(openAIControl).toContainText('setOperationFailed');
  await expect(openAIControl).toContainText('role="alert"');
  await expect(openAIControl).toContainText('reportRedactedVoiceFailure');
  await expect(openAIControl).toContainText('reportVoiceFailureSafely');
  await expect(openAIControl).toContainText('Promise.resolve');
  await expect(openAIControl).toContainText(
    'console.warn("Voice telemetry unavailable.")',
  );
  await expect(openAIControl).not.toContainText('catch(() => {})');
  await expect(openAIControl).not.toContainText('console.warn(error)');
  await expect(openAIControl).not.toContainText('console.error(error)');
  await expect(openAIControl).not.toContainText('diagnostic.message');
  await expect(openAIControl).not.toContainText('Diagnostic details');

  const openAITokenRoute = openAIGuide
    .locator('pre')
    .filter({ hasText: 'const mint = createOpenAIMinter' });
  await expect(openAITokenRoute).toContainText('export async function POST');
  await expect(openAITokenRoute).toContainText(
    'requireAuthenticatedRealtimeSession',
  );
  await expect(openAITokenRoute).toContainText(
    'areRealtimeMintAuthAndCsrfCheapAndConstantTime',
  );
  await expect(openAITokenRoute).toContainText(
    'consumeRealtimeMintPreAuthRateLimit',
  );
  await expect(openAITokenRoute).toContainText(
    'resolveTrustedRealtimeMintClientAddress',
  );
  await expect(openAITokenRoute).toContainText(
    'isTrustedRealtimeMintOrigin(request)',
  );
  await expect(openAITokenRoute).toContainText('isValidRealtimeMintCsrf');
  await expect(openAITokenRoute).toContainText('consumeRealtimeMintRateLimit');
  await expect(openAITokenRoute).toContainText('resolveAllowedRealtimeModel');
  await expect(openAITokenRoute).toContainText(
    'reportRedactedRealtimeMintFailure',
  );
  for (const publicError of [
    'invalid-request',
    'request-denied',
    'unauthorized',
    'rate-limited',
    'mint-failed',
  ]) {
    await expect(openAITokenRoute).toContainText(
      new RegExp(`\\{\\s*error:\\s*["']${publicError}["']\\s*\\}`),
    );
  }
  await expect(openAITokenRoute).toContainText('status: 429');
  await expect(openAITokenRoute).toContainText('status: 500');
  await expect(openAITokenRoute).toContainText(/["']Retry-After["']/);
  await expect(openAITokenRoute).toContainText(
    'mintFailureHttpStatus(result.error.reason)',
  );
  await expect(openAITokenRoute).toContainText(
    /["']Cache-Control["']:\s*["']private, no-store["']/,
  );
  await expect(openAITokenRoute).not.toContainText(
    '{ error: result.error.reason }',
  );
  await expect(openAITokenRoute).not.toContainText('OpenAI-Safety-Identifier');
  const openAITokenRouteExcerpt =
    (await openAITokenRoute.textContent())?.split(
      'export async function POST',
    )[1] ?? '';
  expectMarkersInOrder(openAITokenRouteExcerpt, [
    'isTrustedRealtimeMintOrigin(request)',
    'areRealtimeMintAuthAndCsrfCheapAndConstantTime()',
    'consumeRealtimeMintPreAuthRateLimit(clientAddress)',
    'requireAuthenticatedRealtimeSession(request)',
    'isValidRealtimeMintCsrf(request, authenticated)',
    'consumeRealtimeMintRateLimit',
  ]);

  const openAIBrowserMint = openAIGuide
    .locator('pre')
    .filter({ hasText: 'export async function mintOpenAIToken' });
  await expect(openAIBrowserMint).toContainText('getCsrfToken');
  await expect(openAIBrowserMint).toContainText(/method:\s*["']POST["']/);
  await expect(openAIBrowserMint).toContainText(
    /credentials:\s*["']same-origin["']/,
  );
  await expect(openAIBrowserMint).toContainText(
    /["']X-CSRF-Token["']:\s*getCsrfToken\(\)/,
  );
  await expect(openAIBrowserMint).toContainText('JSON.stringify({})');
  await expect(openAIBrowserMint).not.toContainText('sessionId:');
  await expect(openAIBrowserMint).not.toContainText('model:');
  await expect(openAIBrowserMint).not.toContainText('allowedModels:');

  const openAIAdapterSetup = openAIGuide
    .locator('pre')
    .filter({ hasText: 'new OpenAIAdapter' });
  await expect(openAIAdapterSetup).toContainText(
    'createAdapter: createOpenAIAdapter',
  );
  await expect(openAIAdapterSetup).toContainText('mintToken: mintOpenAIToken');
  await expect(openAIAdapterSetup).not.toContainText(
    'mintOpenAIToken(sessionId)',
  );
  await expect(openAIGuide).toContainText(
    'The server derives the session, principal, and allowed model',
  );

  await page.goto('/guides/voice/livekit-cascade/');
  const liveKitGuide = page.locator('main');
  await expect(liveKitGuide).toContainText('illustrative integration excerpts');
  await expect(liveKitGuide).toContainText('setMicrophoneEnabled(true)');
  await expect(liveKitGuide).toContainText('setMicrophoneEnabled(false)');
  await expect(liveKitGuide).toContainText(
    'retains microphone access while the published track is muted',
  );
  await expect(liveKitGuide).toContainText(
    'Expiry alone does not disconnect an active participant or end the room',
  );
  await expect(liveKitGuide).toContainText(
    'Token expiry is checked for each initial or fresh room connection',
  );
  await expect(liveKitGuide).toContainText(
    'including an explicit connect() after disconnect()',
  );
  await expect(liveKitGuide).toContainText(
    'LiveKit pushes refreshed tokens to connected clients',
  );
  await expect(liveKitGuide).toContainText(
    'SDK uses the refreshed token for managed reconnects',
  );
  await expect(liveKitGuide).not.toContainText(
    'A reconnect can fail if no refresh arrived before the stored token expired',
  );
  await expect(liveKitGuide).not.toContainText(
    'Token expiration only affects the initial connection',
  );
  await expect(liveKitGuide).toContainText(
    'The repository demo mint route is development-only',
  );
  await expect(liveKitGuide).toContainText(
    'currently lacks production authentication, trusted scope derivation, and explicit no-store cache headers',
  );
  await expect(liveKitGuide).toContainText(
    'use the full bunx nx dev-livekit demo checkpoint above rather than launching only the worker role',
  );
  await expect(liveKitGuide).not.toContainText(
    'bun nx run @maelstrom-co/demo:dev-agent',
  );

  const tokenFetch = page.locator('pre').filter({
    hasText: 'export async function fetchAuthenticatedLiveKitToken',
  });
  await expect(tokenFetch).toContainText(/method:\s*["']POST["']/);
  await expect(tokenFetch).toContainText(/credentials:\s*["']same-origin["']/);
  await expect(tokenFetch).not.toContainText('JSON.stringify({ roomName })');

  const tokenRoute = page
    .locator('pre')
    .filter({ hasText: 'export async function POST' });
  await expect(tokenRoute).toContainText('requireAuthenticatedVoiceSession');
  await expect(tokenRoute).toContainText('isTrustedVoiceMintOrigin(request)');
  await expect(tokenRoute).toContainText('isValidVoiceMintCsrf');
  await expect(tokenRoute).toContainText('consumeVoiceMintRateLimit');
  await expect(tokenRoute).toContainText('reportRedactedVoiceMintFailure');
  for (const publicError of [
    'request-denied',
    'unauthorized',
    'rate-limited',
    'mint-failed',
  ]) {
    await expect(tokenRoute).toContainText(
      new RegExp(`\\{\\s*error:\\s*["']${publicError}["']\\s*\\}`),
    );
  }
  await expect(tokenRoute).toContainText('status: 429');
  await expect(tokenRoute).toContainText('status: 500');
  await expect(tokenRoute).toContainText('roomName: authenticated.roomName');
  await expect(tokenRoute).toContainText('identity: authenticated.identity');
  await expect(tokenRoute).toContainText(
    'mintFailureHttpStatus(result.error.reason)',
  );
  await expect(tokenRoute).not.toContainText('{ error: result.error.reason }');
  await expect(tokenRoute).not.toContainText('console.');
  await expect(tokenRoute).toContainText(
    "'Cache-Control': 'private, no-store'",
  );
  await expect(liveKitGuide).toContainText(
    'mandatory app-provided fail-closed controls',
  );
  await expect(liveKitGuide).toContainText('does not validate CSRF');
  await expect(liveKitGuide).toContainText(
    'is the only control in this example that validates CSRF',
  );
  await expect(liveKitGuide).toContainText(
    'Unexpected exceptions are reported only through the redacted telemetry boundary',
  );
});

test('voice guides state marker-ordering edge cases', () => {
  expect(() => expectMarkersInOrder('alpha omega', [])).not.toThrow();
  expect(() => expectMarkersInOrder('alpha omega', [''])).toThrow(/non-empty/);
  expect(() => expectMarkersInOrder('alpha alpha', ['alpha', 'alpha'])).toThrow(
    /follow/,
  );
  expect(() =>
    expectMarkersInOrder('alpha repeated alpha omega', ['alpha', 'omega']),
  ).not.toThrow();
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
  await expect(reference).toContainText('provider-defined');
  await expect(reference).toContainText('may be no-ops');
  await expect(reference).toContainText('may produce no transcript');
  await expect(reference).toContainText("state === 'error'");
  await expect(reference).toContainText('lastError');
  await expect(reference).toContainText('OpenAIAdapter omits turnControl');
});

test('minter references preserve bootstrap security and renewal contracts', async ({
  page,
}) => {
  await page.goto('/reference/realtime-server/functions/createopenaiminter/');
  const openAIReference = page.locator('main');
  await expect(openAIReference).toContainText('unauthenticated bootstrap');
  await expect(openAIReference).toContainText(
    'request model overrides the configured default',
  );
  await expect(openAIReference).toContainText(
    'authenticate and authorize callers',
  );
  await expect(openAIReference).toContainText('trusted model policy');
  await expect(openAIReference).toContainText('origin controls');
  await expect(openAIReference).toContainText('rate limits');
  await expect(openAIReference).toContainText('abuse controls');
  await expect(openAIReference).toContainText(
    'requireAuthenticatedRealtimeSession',
  );
  await expect(openAIReference).toContainText(
    'areRealtimeMintAuthAndCsrfCheapAndConstantTime()',
  );
  await expect(openAIReference).toContainText(
    'resolveTrustedRealtimeMintClientAddress(request)',
  );
  await expect(openAIReference).toContainText(
    'consumeRealtimeMintPreAuthRateLimit(clientAddress)',
  );
  await expect(openAIReference).toContainText(
    'When authentication and CSRF validation are not demonstrably cheap and constant-time',
  );
  await expect(openAIReference).toContainText(
    'trusted server- or proxy-derived IP-equivalent client address',
  );
  await expect(openAIReference).toContainText(
    'reject browser-controlled forwarding headers',
  );
  await expect(openAIReference).toContainText(
    'shared principal-keyed limit after authentication and CSRF validation',
  );
  await expect(openAIReference).toContainText('isValidRealtimeMintCsrf');
  await expect(openAIReference).toContainText('consumeRealtimeMintRateLimit');
  await expect(openAIReference).toContainText('resolveAllowedRealtimeModel');
  await expect(openAIReference).toContainText(
    'reportRedactedRealtimeMintFailure',
  );
  await expect(openAIReference).toContainText("{ error: 'invalid-request' }");
  await expect(openAIReference).toContainText("{ error: 'mint-failed' }");
  await expect(openAIReference).toContainText('status: 500');
  await expect(openAIReference).toContainText(
    "'Cache-Control': 'private, no-store'",
  );
  await expect(openAIReference).not.toContainText(
    '{ error: result.error.reason }',
  );
  const openAIReferenceExample = openAIReference
    .locator('pre')
    .filter({ hasText: 'export async function POST' });
  const openAIReferenceRoute =
    (await openAIReferenceExample.textContent())?.split(
      'export async function POST',
    )[1] ?? '';
  expectMarkersInOrder(openAIReferenceRoute, [
    'isTrustedRealtimeMintOrigin(request)',
    'areRealtimeMintAuthAndCsrfCheapAndConstantTime()',
    'consumeRealtimeMintPreAuthRateLimit(clientAddress)',
    'requireAuthenticatedRealtimeSession(request)',
    'isValidRealtimeMintCsrf(request, authenticated)',
    'consumeRealtimeMintRateLimit',
  ]);

  await page.goto(
    '/reference/realtime-livekit-server/functions/mintlivekittoken/',
  );
  const liveKitReference = page.locator('main');
  await expect(liveKitReference).toContainText('unauthenticated bootstrap');
  await expect(liveKitReference).toContainText(
    'authenticate and authorize callers',
  );
  await expect(liveKitReference).toContainText(
    'trusted room and identity policy',
  );
  await expect(liveKitReference).toContainText('origin controls');
  await expect(liveKitReference).toContainText('rate limits');
  await expect(liveKitReference).toContainText('abuse controls');
  await expect(liveKitReference).toContainText(
    'does not disconnect an active participant or end the room',
  );
  await expect(liveKitReference).toContainText(
    'Token expiry is checked for each such connection',
  );
  await expect(liveKitReference).toContainText(
    'including an explicit connect() after disconnect()',
  );
  await expect(liveKitReference).toContainText(
    'pushes refreshed tokens to connected clients',
  );
  await expect(liveKitReference).toContainText(
    'SDK uses the refreshed token for managed reconnects',
  );
  await expect(liveKitReference).not.toContainText(
    'A reconnect can fail if no refresh arrived before the stored token expired',
  );
  await expect(liveKitReference).not.toContainText(
    'Token expiration only affects the initial connection',
  );
  await expect(liveKitReference).toContainText('export async function POST');
  await expect(liveKitReference).toContainText(
    'requireAuthenticatedVoiceSession',
  );
  await expect(liveKitReference).toContainText(
    'isTrustedVoiceMintOrigin(request)',
  );
  await expect(liveKitReference).toContainText('isValidVoiceMintCsrf');
  await expect(liveKitReference).toContainText('consumeVoiceMintRateLimit');
  await expect(liveKitReference).toContainText(
    'reportRedactedVoiceMintFailure',
  );
  await expect(liveKitReference).toContainText('mintFailureHttpStatus');
  await expect(liveKitReference).toContainText(
    "'Cache-Control': 'private, no-store'",
  );
  await expect(liveKitReference).toContainText("{ error: 'unauthorized' }");
  await expect(liveKitReference).toContainText("{ error: 'request-denied' }");
  await expect(liveKitReference).toContainText("{ error: 'rate-limited' }");
  await expect(liveKitReference).toContainText("{ error: 'mint-failed' }");
  await expect(liveKitReference).toContainText('status: 500');
  await expect(liveKitReference).not.toContainText(
    '{ error: result.error.reason }',
  );
  await expect(liveKitReference).not.toContainText('console.');
  await expect(liveKitReference).not.toContainText(
    "createServerFn({ method: 'GET' })",
  );

  expect(NORMALIZED_LIVEKIT_SERVER_README).toContain(
    'request shape validation and local provider interaction',
  );
  expect(NORMALIZED_LIVEKIT_SERVER_README).toContain(
    'application transport owns authentication, authorization, CSRF, origin checks, shared rate limits, and trusted room scope',
  );
  expect(NORMALIZED_LIVEKIT_SERVER_README).toContain(
    'Token expiry is checked for each initial or fresh room connection, including an explicit `connect()` after `disconnect()`',
  );
  expect(NORMALIZED_LIVEKIT_SERVER_README).toContain(
    'LiveKit pushes refreshed tokens to connected clients, and the SDK uses the refreshed token for managed reconnects',
  );
  expect(NORMALIZED_LIVEKIT_SERVER_README).not.toContain(
    'A reconnect can fail if no refresh arrived before the stored token expired',
  );
  expect(NORMALIZED_LIVEKIT_SERVER_README).not.toContain(
    'Token expiration only affects the initial connection',
  );
  expect(NORMALIZED_LIVEKIT_SERVER_README).not.toContain(
    'trust boundary lives with the minter',
  );
  expect(NORMALIZED_REALTIME_SERVER_README).toContain(
    'mandatory app-provided fail-closed controls',
  );
  expect(NORMALIZED_REALTIME_SERVER_README).toContain(
    'When authentication and CSRF validation are not demonstrably cheap and constant-time',
  );
  expect(NORMALIZED_REALTIME_SERVER_README).toContain(
    'trusted server- or proxy-derived IP-equivalent client address',
  );
  expect(NORMALIZED_REALTIME_SERVER_README).toContain(
    'Reject browser-controlled forwarding headers',
  );
  expect(NORMALIZED_REALTIME_SERVER_README).toContain(
    'shared principal-keyed limit after authentication and CSRF validation',
  );
  expect(NORMALIZED_REALTIME_SERVER_README).toContain(
    'Both the pre-auth transport throttle and the retained principal throttle must deny on store failure',
  );
  const normalizedRealtimeServerRoute =
    NORMALIZED_REALTIME_SERVER_README.split('export async function POST')[1] ??
    '';
  expectMarkersInOrder(normalizedRealtimeServerRoute, [
    'isTrustedRealtimeMintOrigin(request)',
    'areRealtimeMintAuthAndCsrfCheapAndConstantTime()',
    'consumeRealtimeMintPreAuthRateLimit(clientAddress)',
    'requireAuthenticatedRealtimeSession(request)',
    'isValidRealtimeMintCsrf(request, authenticated)',
    'consumeRealtimeMintRateLimit',
  ]);
  expect(NORMALIZED_REALTIME_SERVER_README).toContain(
    'resolveAllowedRealtimeModel',
  );
  expect(NORMALIZED_REALTIME_SERVER_README).toContain(
    "'Cache-Control': 'private, no-store'",
  );
  expect(REALTIME_SERVER_README).not.toContain(
    '{ error: result.error.reason }',
  );
  expect(REALTIME_SERVER_README).toContain(
    'https://docs.maelstrom-ai.co/guides/voice/openai-realtime/',
  );
  expect(REALTIME_SERVER_README).toContain(
    'https://platform.openai.com/docs/guides/realtime-webrtc',
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
    'does not read expiresAt or schedule proactive renewal',
  );
  await expect(reference).toContainText(
    'cannot authenticate an initial or fresh room connection',
  );
  await expect(reference).toContainText(
    'Expiry alone does not disconnect an active participant or end the room',
  );
  await expect(reference).toContainText(
    'Token expiry is checked for each such connection',
  );
  await expect(reference).toContainText(
    'including an explicit connect() after disconnect()',
  );
  await expect(reference).toContainText(
    'LiveKit pushes refreshed tokens to connected clients',
  );
  await expect(reference).toContainText(
    'SDK uses the refreshed token for managed reconnects',
  );
  await expect(reference).not.toContainText(
    'A reconnect can fail if no refresh arrived before the stored token expired',
  );
  await expect(reference).not.toContainText(
    'Token expiration only affects the initial connection',
  );
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
  expect(controls, 'Expected the controls fixture region').toBeDefined();

  await page.goto('/guides/voice/overview/');
  const guide = page.locator('main');
  const renderedCode = (await guide.locator('pre').allTextContents())
    .join('\n')
    .replace(/\s+/g, '');
  expect(renderedCode).toContain((setup ?? '').replace(/\s+/g, ''));
  expect(renderedCode).toContain((controls ?? '').replace(/\s+/g, ''));
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
  const regionNames = ['server-minter', 'browser-grant', 'adapter-setup'];

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
});

test('LiveKit browser fixture covers turn control and renders verbatim', async ({
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
  const guideSource = readFileSync(
    new URL(
      '../src/content/docs/guides/voice/livekit-cascade.mdx',
      import.meta.url,
    ),
    'utf8',
  );
  const regionNames = ['adapter-setup', 'turn-control'];

  await page.goto('/guides/voice/livekit-cascade/');
  const renderedCode = (await page.locator('main pre').allTextContents())
    .join('\n')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n');

  for (const regionName of regionNames) {
    const region = fixture.match(
      new RegExp(
        `/\\* docs:livekit-${regionName}:start \\*/([\\s\\S]*?)/\\* docs:livekit-${regionName}:end \\*/`,
      ),
    )?.[1];
    expect(region, `Expected the ${regionName} fixture region`).toBeDefined();
    const normalizedRegion = (region ?? '')
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => line.trimEnd())
      .join('\n')
      .trim();
    expect(guideSource.replace(/\r\n/g, '\n')).toContain(normalizedRegion);
    expect(renderedCode.replace(/\s+/g, '')).toContain(
      normalizedRegion.replace(/\s+/g, ''),
    );
  }

  expect(fixture).toContain('turnControl.startTurn()');
  expect(fixture).toContain('turnControl.endTurn()');
  expect(fixture).not.toContain('startTalking');
  expect(fixture).not.toContain('stopTalking');
});

test('LiveKit production fixture is compile checked and rendered verbatim', async ({
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

  for (const regionName of ['token-boundary', 'worker-reference']) {
    const region = fixture.match(
      new RegExp(
        `/\\* docs:livekit-${regionName}:start \\*/([\\s\\S]*?)/\\* docs:livekit-${regionName}:end \\*/`,
      ),
    )?.[1];
    expect(region, `Expected the ${regionName} fixture region`).toBeDefined();
    const normalizedRegion = (region ?? '').trim();
    expect(guideSource).toContain(normalizedRegion);
    expect(renderedCode).toContain(normalizedRegion.replace(/\s+/g, ''));
  }
});

test('LiveKit token boundary keeps room authority and minimum grants on the server', () => {
  const fixture = readFileSync(
    new URL('./fixtures/voice/livekit-cascade.tsx', import.meta.url),
    'utf8',
  );
  const tokenBoundary = fixture.match(
    /\/\* docs:livekit-token-boundary:start \*\/([\s\S]*?)\/\* docs:livekit-token-boundary:end \*\//,
  )?.[1];

  expect(tokenBoundary).toBeDefined();
  expect(tokenBoundary).toContain('requireAuthenticatedVoiceSession(request)');
  expect(tokenBoundary).toContain('roomName: authenticated.roomName');
  expect(tokenBoundary).toContain('identity: authenticated.identity');
  expect(tokenBoundary).toContain("credentials: 'same-origin'");
  expect(tokenBoundary).toContain("'Cache-Control': 'private, no-store'");
  expect(tokenBoundary).not.toContain('JSON.stringify({ roomName');

  const minter = readFileSync(
    new URL(
      '../../../packages/realtime-livekit-server/src/lib/livekit-mint.ts',
      import.meta.url,
    ),
    'utf8',
  );
  expect(minter).toContain('roomJoin: true');
  expect(minter).toContain('canPublish: true');
  expect(minter).toContain('canSubscribe: true');
});

test('LiveKit worker reference separates speech work and links production guidance', () => {
  const fixture = readFileSync(
    new URL('./fixtures/voice/livekit-cascade.tsx', import.meta.url),
    'utf8',
  );
  const guide = readFileSync(
    new URL(
      '../src/content/docs/guides/voice/livekit-cascade.mdx',
      import.meta.url,
    ),
    'utf8',
  );
  const serverReadme = readFileSync(
    new URL(
      '../../../packages/realtime-livekit-server/README.md',
      import.meta.url,
    ),
    'utf8',
  );
  const agentReadme = readFileSync(
    new URL(
      '../../../packages/realtime-livekit-agent/README.md',
      import.meta.url,
    ),
    'utf8',
  );
  const workerReference = fixture.match(
    /\/\* docs:livekit-worker-reference:start \*\/([\s\S]*?)\/\* docs:livekit-worker-reference:end \*\//,
  )?.[1];

  expect(workerReference).toBeDefined();
  expect(workerReference).toContain('runVoiceAgent()');
  for (const document of [guide, agentReadme]) {
    expect(document).toContain('The worker has no planning LLM');
    expect(document).toContain('receives no UI grounding');
    expect(document).toContain('DEEPGRAM_API_KEY');
    expect(document).toContain('CARTESIA_API_KEY');
  }
  for (const url of [
    'https://docs.maelstrom-ai.co/guides/voice/overview/',
    'https://docs.maelstrom-ai.co/reference/realtime-livekit/packages/realtime-livekit/src/classes/livekitadapter/',
    'https://docs.maelstrom-ai.co/understanding/architecture/',
    'https://docs.livekit.io/home/server/generating-tokens/',
    'https://docs.livekit.io/agents/start/voice-ai/',
  ]) {
    expect(guide).toContain(url);
  }
  for (const readme of [serverReadme, agentReadme]) {
    expect(readme).toContain(
      'https://docs.maelstrom-ai.co/guides/voice/livekit-cascade/',
    );
    expect(readme).toContain(
      'https://docs.livekit.io/home/server/generating-tokens/',
    );
    expect(readme).toContain('https://docs.livekit.io/agents/start/voice-ai/');
  }
});

test('LiveKit local demo keeps exact commands and points production setup forward', () => {
  const guide = readFileSync(
    new URL(
      '../src/content/docs/guides/voice/livekit-cascade.mdx',
      import.meta.url,
    ),
    'utf8',
  );
  const demoReadme = readFileSync(
    new URL('../../../apps/demo/README.md', import.meta.url),
    'utf8',
  );
  const adapterReadme = readFileSync(
    new URL('../../../packages/realtime-livekit/README.md', import.meta.url),
    'utf8',
  );

  for (const document of [guide, demoReadme]) {
    expect(document).toContain('livekit-server --dev');
    expect(document).toContain('bunx nx dev-livekit demo');
  }
  expect(guide).toContain(
    'https://docs.maelstrom-ai.co/guides/voice/livekit-cascade/',
  );
  expect(adapterReadme).toContain(
    'https://docs.maelstrom-ai.co/guides/voice/livekit-cascade/',
  );
  expect(adapterReadme).toContain('@maelstrom-co/realtime-livekit-server');
  expect(adapterReadme).not.toContain('@maelstrom-co/realtime-livekit/server');
  expect(adapterReadme).not.toContain('startTalking');
  expect(adapterReadme).not.toContain('stopTalking');
});

test('voice overview documents the common session contract without a universal flow', async ({
  page,
}) => {
  await page.goto('/guides/voice/overview/');
  const guide = page.locator('main');

  for (const contract of [
    'createAdapter',
    'm.useVoice()',
    'state',
    'error',
    'userTranscript',
    'assistantTranscript',
    'connect',
    'disconnect',
    'turnControl',
    'VoiceOrb',
    'does not promise one universal state sequence',
    'does not define a universal retry policy',
    'A successful connect() means the provider session is ready',
    'A rejected connect() or an error state means the attempt failed',
  ]) {
    await expect(guide).toContainText(contract);
  }

  await expect(
    guide.getByRole('link', { name: 'Voice API reference', exact: true }),
  ).toHaveAttribute('href', '/reference/realtime/readme/');
  await expect(
    guide.getByRole('link', { name: 'React voice API reference' }),
  ).toHaveAttribute('href', '/reference/react-realtime/readme/');
  await expect(
    guide.getByRole('link', { name: 'voice architecture' }),
  ).toHaveAttribute('href', '/understanding/voice-architecture/');

  const reactLanding = readFileSync(
    new URL('../../../packages/react-realtime/README.md', import.meta.url),
    'utf8',
  );
  expect(reactLanding).toContain('Provider-neutral React binding');
  expect(reactLanding).toContain('`m.useVoice()`');
  expect(reactLanding).toContain('`m.VoiceOrb`');
});

test('Google adapter audit marks the reserved subpath as unimplemented', () => {
  expect(
    readFileSync(
      new URL('../../../packages/realtime/README.md', import.meta.url),
      'utf8',
    ),
  ).toContain(
    '`@maelstrom-co/realtime/google` is reserved but not implemented',
  );
});

test('semantic preservation inventory keeps the realtime voice boundaries explicit', () => {
  const invariants = [
    [
      'VOICE-SEM-01',
      "Never let the model's belief be the engine's planning input.",
    ],
    ['VOICE-SEM-02', 'only power is emitting a **natural-language intent**'],
    ['VOICE-SEM-03', '**The engine is untouched.**'],
    ['VOICE-SEM-04', 'OpenAI uses client-direct WebRTC'],
    ['VOICE-SEM-05', 'the only code that can read `OPENAI_API_KEY`'],
    ['VOICE-SEM-06', '**speak-after-render** rule'],
    ['VOICE-SEM-07', 'correlates a *specific* intent to *its own* settle'],
    ['VOICE-SEM-08', '**debounced (~1s) and latest-wins**'],
    ['VOICE-SEM-09', '**deterministic and model-free**'],
    [
      'VOICE-SEM-10',
      'Vessel domain data — props, contents — never reaches the realtime model',
    ],
    ['VOICE-SEM-11', 'queues the intent in a single latest-wins slot'],
    [
      'VOICE-SEM-12',
      'defers at most one `response.create` behind the active response',
    ],
  ] as const;

  for (const [id, invariant] of invariants) {
    expect(REALTIME_VOICE_ARCHITECTURE, id).toContain(invariant);
  }
});

test('architecture destination points implementers to the public voice guides', () => {
  for (const destination of [
    'https://docs.maelstrom-ai.co/guides/voice/overview/',
    'https://docs.maelstrom-ai.co/guides/voice/openai-realtime/',
    'https://docs.maelstrom-ai.co/guides/voice/livekit-cascade/',
  ]) {
    expect(REALTIME_VOICE_ARCHITECTURE).toContain(destination);
  }
  expect(REALTIME_VOICE_ARCHITECTURE).toContain(
    'Use the implementation guides first',
  );
  expect(REALTIME_VOICE_ARCHITECTURE).toContain(
    'secondary architecture reference',
  );
});

test('voice discovery exposes exact destinations and reference routes', () => {
  const voiceDiscovery = ROOT_README.match(
    /## Voice\n([\s\S]*?)\n## Packages/,
  )?.[1];
  expect(voiceDiscovery, 'Expected a root README voice section').toBeDefined();

  expectMarkersInOrder(voiceDiscovery ?? '', [
    'https://docs.maelstrom-ai.co/guides/voice/overview/',
    'https://docs.maelstrom-ai.co/guides/voice/openai-realtime/',
    'https://docs.maelstrom-ai.co/guides/voice/livekit-cascade/',
    'https://docs.maelstrom-ai.co/reference/',
    'https://github.com/maelstrom-co/maelstrom/blob/main/docs/realtime-voice-architecture.md',
  ]);

  const packagesSection = ROOT_README.match(
    /## Packages\n([\s\S]*?)(?:\n## |\s*$)/,
  )?.[1];
  expect(
    packagesSection,
    'Expected a root README packages section',
  ).toBeDefined();

  for (const packagePath of [
    './packages/realtime',
    './packages/react-realtime',
    './packages/realtime-server',
    './packages/realtime-livekit',
    './packages/realtime-livekit-server',
    './packages/realtime-livekit-agent',
  ]) {
    expect(packagesSection ?? '').toContain(packagePath);
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
