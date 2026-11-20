import { fileURLToPath } from 'node:url';

import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import starlight from '@astrojs/starlight';
import { COMMUNITY_DISCORD_URL } from '@maelstrom-co/platform-infra/community-contract';
import tailwindcss from '@tailwindcss/vite';
import mermaid from 'astro-mermaid';
import { defineConfig, fontProviders } from 'astro/config';
import starlightLlmsTxt from 'starlight-llms-txt';
import { createStarlightTypeDocPlugin } from 'starlight-typedoc';

import {
  docsRevision,
  docsSourceRef,
  sdkVersions,
} from './src/lib/docs-build-info';
import {
  createGitHubSourceLinkTemplate,
  resolveDocsSourceRef,
} from './src/lib/docs-source-links.js';
import {
  DEV_VERSION,
  bareTarget,
  versionHref,
  versionLanding,
} from './src/lib/docs-versions';
import {
  docsVersions,
  readDocsVersions,
} from './src/lib/docs-versions-integration';
import { llmDocs } from './src/lib/llm-docs-integration';
import { versionedLlmsTxt } from './src/lib/versioned-llms-integration';
import { versionSidebar } from './src/lib/versioned-sidebar';

const [devtoolsTypeDoc, devtoolsTypeDocSidebarGroup] =
  createStarlightTypeDocPlugin();
const [devtoolsBridgeTypeDoc, devtoolsBridgeTypeDocSidebarGroup] =
  createStarlightTypeDocPlugin();
const [devtoolsMcpTypeDoc, devtoolsMcpTypeDocSidebarGroup] =
  createStarlightTypeDocPlugin();
const [devtoolsProtocolTypeDoc, devtoolsProtocolTypeDocSidebarGroup] =
  createStarlightTypeDocPlugin();
const [reactDevtoolsTypeDoc, reactDevtoolsTypeDocSidebarGroup] =
  createStarlightTypeDocPlugin();
const [reactTypeDoc, reactTypeDocSidebarGroup] = createStarlightTypeDocPlugin();
const [clientTypeDoc, clientTypeDocSidebarGroup] =
  createStarlightTypeDocPlugin();
const [connectorsTypeDoc, connectorsTypeDocSidebarGroup] =
  createStarlightTypeDocPlugin();
const [protocolTypeDoc, protocolTypeDocSidebarGroup] =
  createStarlightTypeDocPlugin();
const [telemetryTypeDoc, telemetryTypeDocSidebarGroup] =
  createStarlightTypeDocPlugin();
const [engineTypeDoc, engineTypeDocSidebarGroup] =
  createStarlightTypeDocPlugin();
const [plannerLlmTypeDoc, plannerLlmTypeDocSidebarGroup] =
  createStarlightTypeDocPlugin();
const [realtimeTypeDoc, realtimeTypeDocSidebarGroup] =
  createStarlightTypeDocPlugin();
const [realtimeProtocolTypeDoc, realtimeProtocolTypeDocSidebarGroup] =
  createStarlightTypeDocPlugin();
const [realtimeOpenaiTypeDoc, realtimeOpenaiTypeDocSidebarGroup] =
  createStarlightTypeDocPlugin();
const [realtimeOpenaiLiveTypeDoc, realtimeOpenaiLiveTypeDocSidebarGroup] =
  createStarlightTypeDocPlugin();
const [
  realtimeOpenaiLiveServerTypeDoc,
  realtimeOpenaiLiveServerTypeDocSidebarGroup,
] = createStarlightTypeDocPlugin();
const [reactRealtimeTypeDoc, reactRealtimeTypeDocSidebarGroup] =
  createStarlightTypeDocPlugin();
const [realtimeOpenaiServerTypeDoc, realtimeOpenaiServerTypeDocSidebarGroup] =
  createStarlightTypeDocPlugin();
const [realtimeLivekitTypeDoc, realtimeLivekitTypeDocSidebarGroup] =
  createStarlightTypeDocPlugin();
const [realtimeLivekitServerTypeDoc, realtimeLivekitServerTypeDocSidebarGroup] =
  createStarlightTypeDocPlugin();
const [realtimeLivekitAgentTypeDoc, realtimeLivekitAgentTypeDocSidebarGroup] =
  createStarlightTypeDocPlugin();
const [realtimeVadTypeDoc, realtimeVadTypeDocSidebarGroup] =
  createStarlightTypeDocPlugin();

// Git discovery makes TypeDoc's {path} repository-relative. `basePath` remains
// the workspace root for displayed paths and relative documentation assets.
const repoRoot = '../../';
const sourceLinkTemplate = createGitHubSourceLinkTemplate(
  resolveDocsSourceRef(process.env),
);
const multiEntryTypeDocOptions = {
  entryPointStrategy: 'resolve' as const,
  plugin: ['./src/lib/typedoc-module-index.ts'],
  router: 'module-index',
  excludeInternal: true,
  basePath: repoRoot,
  sourceLinkTemplate,
};

// A `prunedReferencePaths` list used to sit here and delete generated reference
// pages before the content collection loaded. It is gone on purpose, and the
// reason is the JSDoc contract rather than the build. All four surviving entries
// were exported from their package's root barrel, which is what makes a symbol
// public here, so each was owed a reference page rather than denied one.
//
// The build agreed. TypeDoc links a symbol's page from every signature that
// mentions it, so deleting the page strands the links — `HttpConnector` renders
// `implements EngineConnector` as a link whether or not the target exists. No
// build phase avoids that, which is why this is not a timing fix.
//
// The list had also never run: it resolved against process.cwd(), and Nx sets
// that to the project directory. So the pages had always shipped, and nothing
// was broken until the resolution was corrected.

const docsSite = process.env.DOCS_SITE_URL ?? 'https://docs.maelstrom-ai.co';

const docsRoot = fileURLToPath(new URL('./src/content/docs/', import.meta.url));
const versions = readDocsVersions(docsRoot);
const defaultVersion = versions.defaultVersion;
// DOCS_DEFAULT_VERSION moves bare URLs without changing what npm serves.
const latestRelease = versions.versions.find(
  (version) => version !== DEV_VERSION,
);
const rootLanding = versionLanding(versions, defaultVersion);
const legacyEvaluations = bareTarget(
  'evals/architecture',
  versions.versions,
  defaultVersion,
  (version, rest) => versions.pages[version]?.includes(rest) ?? false,
);

const llmsTitle = 'Maelstrom';
const llmsDescription =
  'Maelstrom is an open-source framework for building intent-driven apps. Users express goals through voice or text. Maelstrom coordinates developer-defined Vessels, their Actions, and the Chart layout to help users complete tasks.';
// The Architecture Overview is an interactive Astro island living at a
// src/pages route (outside the docs content collection, so the island
// doesn't crash the llms-full.txt container render). Surface it here so
// LLM consumers still get a pointer to the runtime-loop walkthrough.
const llmsOptionalLinks = [
  {
    label: 'Architecture Overview',
    url: `${docsSite}/understanding/architecture/`,
    description:
      'Interactive walkthrough of the browser, protocol, and Engine request loop, the layout-before-actions order, and optional DevTools evidence paths.',
  },
];
const llmsSets = [
  {
    label: 'Getting Started',
    directory: 'getting-started',
    description: 'Introduction, quick start, core concepts, and installation',
  },
  {
    label: 'Guides',
    directory: 'guides',
    description: 'Task-oriented how-tos for React, Engine, and Client',
  },
  {
    label: 'Evals',
    directory: 'evals',
    description:
      'Evaluation architecture, Langfuse workflow, cases, and coverage limits',
  },
  {
    label: 'API Reference',
    directory: 'reference',
    description: 'Complete API documentation for all packages',
  },
];

// Root-relative links stay inside the version that serves the llms.txt. The
// overview sections describe main, so frozen versions leave them out.
function llmsDetails(version: string): string {
  const versionNote =
    version === DEV_VERSION
      ? `- This is the development documentation, built from main at source revision ${docsRevision}. Core SDK manifests: ${sdkVersions}. It can describe APIs that are not published to npm yet.${latestRelease === undefined ? '' : ` For the published packages, use the [${latestRelease} documentation](/${latestRelease}/llms.txt).`}`
      : `- This is the documentation for Maelstrom ${version}, frozen at its latest release. Use it when the installed \`@maelstrom-co/*\` packages are ${version}.x. The installed package manifest and exported API are the authority for your application.`;
  const overview = `
## Key Concepts
- **Vessels**: State machines representing UI components with variants and actions
- **Chart**: Layout surface in one of two modes — tiling (default: a preorder H/V split tree) or grid (integer cell coordinates)
- **Engine**: Coordinates the configured Planner and validates its proposed layout and Actions; history is optional
- **Planner**: Proposes a layout and execution plan from Chart state, update reasons, and available history
- **Protocol**: Shared types and message definitions between client and engine

## Packages
- \`@maelstrom-co/react\` — React bindings (createMaelstrom, vessel, Provider, Chart)
- \`@maelstrom-co/client\` — Framework-agnostic client (Orchestrator, Connectors, ChartManager)
- \`@maelstrom-co/protocol\` — Shared types, Zod schemas, message contract
- \`@maelstrom-co/telemetry\` — Opt-in operational facts and bounded application-owned sink delivery
- \`@maelstrom-co/engine\`: Planning coordination and validation (createEngine, Engine, Planner)
- \`@maelstrom-co/planner-llm\`: Reference LLM Planner (llmPlanner, prompt construction, provider adapter calls)
- \`@maelstrom-co/react-devtools\` — Optional React diagnostics extension (devtools, m.Devtools)
- \`@maelstrom-co/devtools\` — Optional framework-independent collector, explicit capture, and shared browser panel

## DevTools
Use the DevTools guide for request, layout, voice, and recording inspection. Automatic activity contains metadata; content requires explicit recording. Default production entrypoints are inert. The /production entrypoints opt into browser tools in every build; Engine forwarding needs separate host authorization and stays disabled in production.
`;
  return `
## Choose context for your task
${versionNote}
- Start a project or plan an integration with [Build with an agent](/agents/skills/).
- Use [standalone prompts](/agents/prompts/) for a single task without installing skills.
- Run the [React starter](/getting-started/starter/) to check the local client-to-Engine path without a provider key.
- Inspect [SDK guide coverage](https://github.com/maelstrom-co/maelstrom/blob/${docsSourceRef}/apps/docs/skills/README.md#sdk-guide-coverage) before loading an installed package guide.
- Prefer the Getting Started set or one page over the complete API corpus. Each HTML page links to a Markdown sibling: replace its trailing slash with .md.
- The abridged corpus contains complete Getting Started pages, with a 48,000-byte build budget. Use the focused sets below for other topics.
${version === DEV_VERSION ? overview : ''}`;
}

type SidebarItem = NonNullable<
  Parameters<typeof starlight>[0]['sidebar']
>[number];

// Dev's reference is generated on every build by the starlight-typedoc plugins.
const generatedApiReference: SidebarItem[] = [
  reactTypeDocSidebarGroup,
  devtoolsTypeDocSidebarGroup,
  devtoolsBridgeTypeDocSidebarGroup,
  devtoolsMcpTypeDocSidebarGroup,
  devtoolsProtocolTypeDocSidebarGroup,
  reactDevtoolsTypeDocSidebarGroup,
  clientTypeDocSidebarGroup,
  connectorsTypeDocSidebarGroup,
  protocolTypeDocSidebarGroup,
  telemetryTypeDocSidebarGroup,
  engineTypeDocSidebarGroup,
  plannerLlmTypeDocSidebarGroup,
  {
    label: 'Voice',
    items: [
      realtimeTypeDocSidebarGroup,
      realtimeProtocolTypeDocSidebarGroup,
      realtimeOpenaiTypeDocSidebarGroup,
      realtimeOpenaiLiveTypeDocSidebarGroup,
      realtimeOpenaiLiveServerTypeDocSidebarGroup,
      reactRealtimeTypeDocSidebarGroup,
      realtimeOpenaiServerTypeDocSidebarGroup,
      realtimeLivekitTypeDocSidebarGroup,
      realtimeLivekitServerTypeDocSidebarGroup,
      realtimeLivekitAgentTypeDocSidebarGroup,
      realtimeVadTypeDocSidebarGroup,
    ],
  },
];

const frozenReferencePackages = [
  ['react', '@maelstrom-co/react'],
  ['devtools', '@maelstrom-co/devtools'],
  ['devtools-bridge', '@maelstrom-co/devtools/mcp-bridge'],
  ['devtools-mcp-server', '@maelstrom-co/devtools-mcp-server'],
  ['devtools-protocol', '@maelstrom-co/devtools-protocol'],
  ['react-devtools', '@maelstrom-co/react-devtools'],
  ['client', '@maelstrom-co/client'],
  ['connectors', '@maelstrom-co/connectors'],
  ['protocol', '@maelstrom-co/protocol'],
  ['telemetry', '@maelstrom-co/telemetry'],
  ['engine', '@maelstrom-co/engine'],
  ['planner-llm', '@maelstrom-co/planner-llm'],
] as const;

const frozenVoiceReferencePackages = [
  'realtime',
  'realtime-protocol',
  'realtime-openai',
  'realtime-openai-live',
  'realtime-openai-live-server',
  'react-realtime',
  'realtime-openai-server',
  'realtime-livekit',
  'realtime-livekit-server',
  'realtime-livekit-agent',
  'realtime-vad',
].map((directory) => [directory, `@maelstrom-co/${directory}`] as const);

// A frozen version keeps the reference generated for its release in
// <version>/reference/<package>/, so its groups come from those folders.
function frozenApiReference(pages: readonly string[]): SidebarItem[] {
  const present = new Set(
    pages
      .filter((page) => page.startsWith('reference/'))
      .map((page) => page.split('/')[1] ?? ''),
  );
  const known = new Set(
    [...frozenReferencePackages, ...frozenVoiceReferencePackages].map(
      ([directory]) => directory,
    ),
  );
  const groups = (packages: ReadonlyArray<readonly [string, string]>) =>
    packages
      .filter(([directory]) => present.has(directory))
      .map(([directory, label]) => ({
        label,
        collapsed: true,
        items: [
          {
            autogenerate: {
              directory: `reference/${directory}`,
              collapsed: true,
            },
          },
        ],
      }));
  const unknown = [...present]
    .filter((directory) => !known.has(directory))
    .sort()
    .map((directory) => [directory, `@maelstrom-co/${directory}`] as const);
  const voice = groups(frozenVoiceReferencePackages);
  return [
    ...groups([...frozenReferencePackages, ...unknown]),
    ...(voice.length > 0 ? [{ label: 'Voice', items: voice }] : []),
  ];
}

// Written with unversioned slugs; versionSidebar points it at each folder.
function docsSidebar(apiReference: SidebarItem[]): SidebarItem[] {
  return [
    {
      label: 'Getting Started',
      items: [
        { slug: 'getting-started/introduction' },
        { slug: 'getting-started/starter' },
        { slug: 'getting-started/quick-start' },
        { label: 'Build with an agent', link: '/agents/skills/' },
        { slug: 'getting-started/core-concepts' },
        { slug: 'getting-started/installation' },
      ],
    },
    {
      label: 'Tutorials',
      items: [
        { slug: 'tutorials/first-dashboard' },
        { slug: 'tutorials/run-voice-locally' },
        { slug: 'tutorials/run-the-cascade-locally' },
        { slug: 'tutorials/deploy-to-production' },
      ],
    },
    {
      label: 'Guides',
      items: [
        { slug: 'guides/devtools' },
        { slug: 'guides/devtools-mcp' },
        {
          label: 'Voice',
          items: [
            { slug: 'guides/voice/overview' },
            { slug: 'guides/voice/openai-realtime' },
            { slug: 'guides/voice/live-opening-recovery' },
            { slug: 'guides/voice/livekit-cascade' },
          ],
        },
        {
          label: 'React',
          items: [
            { slug: 'guides/react/creating-vessels' },
            { slug: 'guides/react/variants-and-actions' },
            { slug: 'guides/react/lazy-loading' },
            { slug: 'guides/react/layout-modes' },
            { slug: 'guides/react/default-screen' },
            { slug: 'guides/react/error-handling' },
          ],
        },
        {
          label: 'Engine',
          items: [
            { slug: 'guides/engine/custom-llm-providers' },
            { slug: 'guides/engine/system-prompt' },
            { slug: 'guides/engine/conversation-history' },
          ],
        },
        {
          label: 'Client',
          items: [
            { slug: 'guides/client/custom-connectors' },
            { slug: 'guides/client/programmatic-layout' },
          ],
        },
      ],
    },
    {
      label: 'Evals',
      items: [
        { label: 'Architecture', slug: 'evals/architecture' },
        { label: 'Langfuse', slug: 'evals/langfuse' },
        { label: 'Cases', slug: 'evals/cases' },
      ],
    },
    {
      label: 'Understanding',
      items: [
        { slug: 'understanding/why-maelstrom' },
        { slug: 'understanding/comparison' },
        { slug: 'understanding/devtools-mcp' },
        {
          label: 'Architecture Overview',
          link: '/understanding/architecture/',
        },
        { slug: 'understanding/voice-architecture' },
        { slug: 'understanding/browser-vad-and-barge-in' },
        { slug: 'understanding/engine' },
        { slug: 'understanding/protocol' },
        { slug: 'understanding/llm-orchestration' },
        { slug: 'understanding/vessel-state-machine' },
        { slug: 'understanding/connectors' },
        { slug: 'understanding/grid-vs-tiling' },
      ],
    },
    ...(apiReference.length > 0
      ? [{ label: 'API Reference', items: apiReference }]
      : []),
    {
      label: 'Coding agents',
      items: [
        { label: 'Prompts library', link: '/agents/prompts/' },
        { label: 'Agent skills', link: '/agents/skills/' },
        { label: 'Testing prompts and skills', slug: 'agents/evaluations' },
      ],
    },
    {
      label: 'Community',
      items: [
        { slug: 'community/contributing' },
        { slug: 'community/jsdoc-contract' },
        { slug: 'community/changelog' },
      ],
    },
  ];
}

export default defineConfig({
  site: docsSite,
  output: 'static',
  // Pinned to Astro 6's behaviour — see the matching note in apps/www. Markdown
  // is immune to the 'jsx' rule, but the architecture page is hand-authored HTML
  // prose, and one silently glued word is worse than 0.38% of gzip.
  compressHTML: true,
  server: { port: 4322 },
  redirects: {
    ...(rootLanding === undefined
      ? {}
      : {
          '/': {
            destination: versionHref(defaultVersion, rootLanding),
            status: 302,
          },
        }),
    ...(legacyEvaluations === undefined
      ? {}
      : {
          '/guides/engine/evaluations/': {
            destination: legacyEvaluations,
            status: 301,
          },
        }),
    // A version folder without pages gets no root redirect.
    ...Object.fromEntries(
      versions.versions.flatMap((version) => {
        const landing = versionLanding(versions, version);
        return landing === undefined
          ? []
          : [
              [
                `/${version}/`,
                { destination: versionHref(version, landing), status: 302 },
              ],
            ];
      }),
    ),
  },
  integrations: [
    // Markdown pages exist before docsVersions copies them to bare paths.
    llmDocs(),
    docsVersions(docsRoot),
    versionedLlmsTxt({
      root: docsRoot,
      title: llmsTitle,
      description: llmsDescription,
      abridgedDirectory: 'getting-started',
      sets: llmsSets,
      optionalLinks: llmsOptionalLinks,
      details: llmsDetails,
    }),
    mermaid({
      autoTheme: true,
    }),
    starlight({
      title: 'Maelstrom',
      description:
        'An open-source framework for building intent-driven apps. Users express goals through voice or text; Maelstrom coordinates your components and actions.',
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/maelstrom-co/maelstrom',
        },
        {
          icon: 'discord',
          label: 'Discord',
          href: COMMUNITY_DISCORD_URL,
        },
        {
          icon: 'x.com',
          label: 'X',
          href: 'https://x.com/maelstrom_co',
        },
      ],
      editLink: {
        baseUrl:
          'https://github.com/maelstrom-co/maelstrom/edit/main/apps/docs/',
      },
      plugins: [
        // Renders the pages for versionedLlmsTxt, which serves each version's
        // files and replaces this plugin's unprefixed ones at build end.
        starlightLlmsTxt({
          projectName: llmsTitle,
          description: llmsDescription,
          details: llmsDetails(defaultVersion),
          optionalLinks: llmsOptionalLinks,
          customSets: [],
          promote: [
            '*/getting-started/introduction',
            '*/getting-started/quick-start',
            '*/getting-started/core-concepts',
          ],
          demote: ['*/community/changelog'],
          exclude: [`!${defaultVersion}/getting-started/**`],
          minify: {
            note: false,
            tip: false,
            caution: false,
            danger: false,
            details: false,
            whitespace: false,
          },
        }),
        telemetryTypeDoc({
          entryPoints: [
            '../../packages/telemetry/src/index.ts',
            '../../packages/telemetry/src/integration.ts',
          ],
          tsconfig: '../../packages/telemetry/tsconfig.lib.json',
          output: 'dev/reference/telemetry',
          sidebar: { label: '@maelstrom-co/telemetry', collapsed: true },
          typeDoc: multiEntryTypeDocOptions,
        }),
        devtoolsTypeDoc({
          entryPoints: ['../../packages/devtools/src/index.ts'],
          tsconfig: '../../packages/devtools/tsconfig.lib.json',
          output: 'dev/reference/devtools',
          sidebar: { label: '@maelstrom-co/devtools', collapsed: true },
          typeDoc: multiEntryTypeDocOptions,
        }),
        devtoolsBridgeTypeDoc({
          entryPoints: ['../../packages/devtools/src/mcp-bridge.ts'],
          tsconfig: '../../packages/devtools/tsconfig.lib.json',
          output: 'dev/reference/devtools-bridge',
          sidebar: {
            label: '@maelstrom-co/devtools/mcp-bridge',
            collapsed: true,
          },
          typeDoc: multiEntryTypeDocOptions,
        }),
        reactDevtoolsTypeDoc({
          entryPoints: ['../../packages/react-devtools/src/index.ts'],
          tsconfig: '../../packages/react-devtools/tsconfig.lib.json',
          output: 'dev/reference/react-devtools',
          sidebar: { label: '@maelstrom-co/react-devtools', collapsed: true },
          typeDoc: multiEntryTypeDocOptions,
        }),
        devtoolsMcpTypeDoc({
          entryPoints: ['../../packages/devtools-mcp-server/src/index.ts'],
          tsconfig: '../../packages/devtools-mcp-server/tsconfig.lib.json',
          output: 'dev/reference/devtools-mcp-server',
          sidebar: {
            label: '@maelstrom-co/devtools-mcp-server',
            collapsed: true,
          },
          typeDoc: multiEntryTypeDocOptions,
        }),
        devtoolsProtocolTypeDoc({
          entryPoints: ['../../packages/devtools-protocol/src/index.ts'],
          tsconfig: '../../packages/devtools-protocol/tsconfig.lib.json',
          output: 'dev/reference/devtools-protocol',
          sidebar: {
            label: '@maelstrom-co/devtools-protocol',
            collapsed: true,
          },
          typeDoc: multiEntryTypeDocOptions,
        }),
        reactTypeDoc({
          entryPoints: ['../../packages/react/src/index.ts'],
          tsconfig: '../../packages/react/tsconfig.lib.json',
          output: 'dev/reference/react',
          sidebar: { label: '@maelstrom-co/react', collapsed: true },
          typeDoc: {
            excludeInternal: true,
            basePath: repoRoot,
            sourceLinkTemplate,
          },
        }),
        clientTypeDoc({
          entryPoints: ['../../packages/client/src/index.ts'],
          tsconfig: '../../packages/client/tsconfig.lib.json',
          output: 'dev/reference/client',
          sidebar: { label: '@maelstrom-co/client', collapsed: true },
          typeDoc: {
            excludeInternal: true,
            basePath: repoRoot,
            sourceLinkTemplate,
          },
        }),
        connectorsTypeDoc({
          entryPoints: ['../../packages/connectors/src/index.ts'],
          tsconfig: '../../packages/connectors/tsconfig.lib.json',
          output: 'dev/reference/connectors',
          sidebar: { label: '@maelstrom-co/connectors', collapsed: true },
          typeDoc: {
            excludeInternal: true,
            basePath: repoRoot,
            sourceLinkTemplate,
          },
        }),
        protocolTypeDoc({
          entryPoints: ['../../packages/protocol/src/index.ts'],
          tsconfig: '../../packages/protocol/tsconfig.lib.json',
          output: 'dev/reference/protocol',
          sidebar: { label: '@maelstrom-co/protocol', collapsed: true },
          typeDoc: {
            excludeInternal: true,
            basePath: repoRoot,
            sourceLinkTemplate,
          },
        }),
        engineTypeDoc({
          entryPoints: ['../../packages/engine/src/index.ts'],
          tsconfig: '../../packages/engine/tsconfig.lib.json',
          output: 'dev/reference/engine',
          sidebar: { label: '@maelstrom-co/engine', collapsed: true },
          typeDoc: {
            excludeInternal: true,
            basePath: repoRoot,
            sourceLinkTemplate,
          },
        }),
        plannerLlmTypeDoc({
          entryPoints: ['../../packages/planner-llm/src/index.ts'],
          tsconfig: '../../packages/planner-llm/tsconfig.lib.json',
          output: 'dev/reference/planner-llm',
          sidebar: { label: '@maelstrom-co/planner-llm', collapsed: true },
          typeDoc: {
            excludeInternal: true,
            basePath: repoRoot,
            sourceLinkTemplate,
          },
        }),
        realtimeTypeDoc({
          entryPoints: ['../../packages/realtime/src/index.ts'],
          tsconfig: '../../packages/realtime/tsconfig.lib.json',
          output: 'dev/reference/realtime',
          sidebar: { label: '@maelstrom-co/realtime', collapsed: true },
          typeDoc: multiEntryTypeDocOptions,
        }),
        realtimeProtocolTypeDoc({
          entryPoints: [
            '../../packages/realtime-protocol/src/index.ts',
            '../../packages/realtime-protocol/src/openai.ts',
            '../../packages/realtime-protocol/src/openai-live.ts',
            '../../packages/realtime-protocol/src/livekit.ts',
            '../../packages/realtime-protocol/src/livekit-wire.ts',
          ],
          tsconfig: '../../packages/realtime-protocol/tsconfig.lib.json',
          output: 'dev/reference/realtime-protocol',
          sidebar: {
            label: '@maelstrom-co/realtime-protocol',
            collapsed: true,
          },
          typeDoc: multiEntryTypeDocOptions,
        }),
        realtimeOpenaiTypeDoc({
          entryPoints: ['../../packages/realtime-openai/src/index.ts'],
          tsconfig: '../../packages/realtime-openai/tsconfig.lib.json',
          output: 'dev/reference/realtime-openai',
          sidebar: { label: '@maelstrom-co/realtime-openai', collapsed: true },
          typeDoc: multiEntryTypeDocOptions,
        }),
        reactRealtimeTypeDoc({
          entryPoints: ['../../packages/react-realtime/src/index.ts'],
          tsconfig: '../../packages/react-realtime/tsconfig.lib.json',
          output: 'dev/reference/react-realtime',
          sidebar: {
            label: '@maelstrom-co/react-realtime',
            collapsed: true,
          },
          typeDoc: multiEntryTypeDocOptions,
        }),
        realtimeOpenaiLiveTypeDoc({
          entryPoints: ['../../packages/realtime-openai-live/src/index.ts'],
          tsconfig: '../../packages/realtime-openai-live/tsconfig.lib.json',
          output: 'dev/reference/realtime-openai-live',
          sidebar: {
            label: '@maelstrom-co/realtime-openai-live',
            collapsed: true,
          },
          typeDoc: multiEntryTypeDocOptions,
        }),
        realtimeOpenaiLiveServerTypeDoc({
          entryPoints: [
            '../../packages/realtime-openai-live-server/src/index.ts',
          ],
          tsconfig:
            '../../packages/realtime-openai-live-server/tsconfig.lib.json',
          output: 'dev/reference/realtime-openai-live-server',
          sidebar: {
            label: '@maelstrom-co/realtime-openai-live-server',
            collapsed: true,
          },
          typeDoc: multiEntryTypeDocOptions,
        }),
        realtimeOpenaiServerTypeDoc({
          entryPoints: ['../../packages/realtime-openai-server/src/index.ts'],
          tsconfig: '../../packages/realtime-openai-server/tsconfig.lib.json',
          output: 'dev/reference/realtime-openai-server',
          sidebar: {
            label: '@maelstrom-co/realtime-openai-server',
            collapsed: true,
          },
          typeDoc: multiEntryTypeDocOptions,
        }),
        realtimeLivekitTypeDoc({
          entryPoints: ['../../packages/realtime-livekit/src/index.ts'],
          tsconfig: '../../packages/realtime-livekit/tsconfig.lib.json',
          output: 'dev/reference/realtime-livekit',
          sidebar: {
            label: '@maelstrom-co/realtime-livekit',
            collapsed: true,
          },
          typeDoc: multiEntryTypeDocOptions,
        }),
        realtimeLivekitServerTypeDoc({
          entryPoints: ['../../packages/realtime-livekit-server/src/index.ts'],
          tsconfig: '../../packages/realtime-livekit-server/tsconfig.lib.json',
          output: 'dev/reference/realtime-livekit-server',
          sidebar: {
            label: '@maelstrom-co/realtime-livekit-server',
            collapsed: true,
          },
          typeDoc: multiEntryTypeDocOptions,
        }),
        realtimeLivekitAgentTypeDoc({
          entryPoints: ['../../packages/realtime-livekit-agent/src/index.ts'],
          tsconfig: '../../packages/realtime-livekit-agent/tsconfig.lib.json',
          output: 'dev/reference/realtime-livekit-agent',
          sidebar: {
            label: '@maelstrom-co/realtime-livekit-agent',
            collapsed: true,
          },
          typeDoc: multiEntryTypeDocOptions,
        }),
        realtimeVadTypeDoc({
          entryPoints: [
            '../../packages/realtime-vad/src/index.ts',
            '../../packages/realtime-vad/src/vad-assets.ts',
          ],
          tsconfig: '../../packages/realtime-vad/tsconfig.lib.json',
          output: 'dev/reference/realtime-vad',
          sidebar: { label: '@maelstrom-co/realtime-vad', collapsed: true },
          typeDoc: multiEntryTypeDocOptions,
        }),
      ],
      customCss: ['./src/styles/custom.css'],
      // Code blocks render through Expressive Code: native title frames
      // (title="..."), copy button, and line/word highlighting. The glass
      // visual treatment is layered on in src/styles/code-blocks.css —
      // backgrounds/borders are overridden there rather than via theme.
      expressiveCode: {
        themes: ['github-dark', 'github-light'],
        styleOverrides: {
          borderRadius: '0.5rem',
          codeFontFamily: "var(--font-code, 'JetBrains Mono'), monospace",
          codeFontSize: '0.875rem',
          codeLineHeight: '1.7',
          // Strip EC's editor-tab chrome so the title renders as a plain
          // full-width header bar (styled in code-blocks.css), matching the
          // previous bespoke design rather than EC's default tab look.
          frames: {
            editorActiveTabBackground: 'transparent',
            editorActiveTabBorderColor: 'transparent',
            editorActiveTabIndicatorTopColor: 'transparent',
            editorActiveTabIndicatorBottomColor: 'transparent',
            editorTabBarBackground: 'transparent',
            editorTabBarBorderBottomColor: 'transparent',
            frameBoxShadowCssValue: 'none',
          },
        },
      },
      routeMiddleware: './src/lib/docs-version-route.ts',
      components: {
        Header: './src/components/Header.astro',
        Sidebar: './src/components/Sidebar.astro',
        ThemeSelect: './src/components/ThemeSelect.astro',
        Head: './src/components/Head.astro',
        Pagination: './src/components/Pagination.astro',
        Search: './src/components/Search.astro',
      },
      // One group per version folder; docs-version-route shows the page's own.
      sidebar: versions.versions.map((version) => ({
        label: version,
        items:
          version === DEV_VERSION
            ? versionSidebar(docsSidebar(generatedApiReference), version)
            : versionSidebar(
                docsSidebar(frozenApiReference(versions.pages[version] ?? [])),
                version,
                new Set(versions.pages[version]),
              ),
      })),
      lastUpdated: true,
      pagination: true,
    }),
    react(),
    sitemap(),
  ],
  vite: {
    plugins: [tailwindcss()],
    environments: {
      prerender: {
        build: { rolldownOptions: { external: ['satteri'] } },
      },
    },
  },
  srcDir: './src',
  outDir: './dist',
  fonts: [
    {
      provider: fontProviders.local(),
      name: 'Inter',
      cssVariable: '--font-heading',
      fallbacks: ['system-ui', 'sans-serif'],
      options: {
        variants: [
          {
            weight: 400,
            style: 'normal',
            src: [
              './node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2',
            ],
          },
          {
            weight: 400,
            style: 'italic',
            src: [
              './node_modules/@fontsource/inter/files/inter-latin-400-italic.woff2',
            ],
          },
          {
            weight: 500,
            style: 'normal',
            src: [
              './node_modules/@fontsource/inter/files/inter-latin-500-normal.woff2',
            ],
          },
          {
            weight: 500,
            style: 'italic',
            src: [
              './node_modules/@fontsource/inter/files/inter-latin-500-italic.woff2',
            ],
          },
          {
            weight: 600,
            style: 'normal',
            src: [
              './node_modules/@fontsource/inter/files/inter-latin-600-normal.woff2',
            ],
          },
          {
            weight: 600,
            style: 'italic',
            src: [
              './node_modules/@fontsource/inter/files/inter-latin-600-italic.woff2',
            ],
          },
          {
            weight: 700,
            style: 'normal',
            src: [
              './node_modules/@fontsource/inter/files/inter-latin-700-normal.woff2',
            ],
          },
          {
            weight: 700,
            style: 'italic',
            src: [
              './node_modules/@fontsource/inter/files/inter-latin-700-italic.woff2',
            ],
          },
        ],
      },
    },
    {
      provider: fontProviders.local(),
      name: 'JetBrains Mono',
      cssVariable: '--font-code',
      fallbacks: ['monospace'],
      options: {
        variants: [
          {
            weight: 400,
            style: 'normal',
            src: [
              './node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2',
            ],
          },
          {
            weight: 400,
            style: 'italic',
            src: [
              './node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-italic.woff2',
            ],
          },
          {
            weight: 500,
            style: 'normal',
            src: [
              './node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2',
            ],
          },
          {
            weight: 500,
            style: 'italic',
            src: [
              './node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-italic.woff2',
            ],
          },
        ],
      },
    },
  ],
});
