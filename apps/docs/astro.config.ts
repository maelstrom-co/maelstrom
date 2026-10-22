import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import starlight from '@astrojs/starlight';
import { COMMUNITY_DISCORD_URL } from '@maelstrom-co/platform-infra/community-contract';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, fontProviders } from 'astro/config';
import mermaid from 'astro-mermaid';
import starlightLlmsTxt from 'starlight-llms-txt';
import { createStarlightTypeDocPlugin } from 'starlight-typedoc';
import {
  createGitHubSourceLinkTemplate,
  resolveDocsSourceRef,
} from './src/lib/docs-source-links.js';

const [devtoolsTypeDoc, devtoolsTypeDocSidebarGroup] =
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

export default defineConfig({
  site: 'https://docs.maelstrom-ai.co',
  output: 'static',
  // Pinned to Astro 6's behaviour — see the matching note in apps/www. Markdown
  // is immune to the 'jsx' rule, but the architecture page is hand-authored HTML
  // prose, and one silently glued word is worse than 0.38% of gzip.
  compressHTML: true,
  server: { port: 4322 },
  redirects: {
    '/': { destination: '/getting-started/introduction/', status: 301 },
  },
  integrations: [
    mermaid({
      autoTheme: true,
    }),
    starlight({
      title: 'Maelstrom',
      description:
        'AI-orchestrated dynamic UI framework. An LLM arranges, controls, and interacts with your components.',
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
        starlightLlmsTxt({
          projectName: 'Maelstrom',
          description:
            'AI-orchestrated dynamic UI framework. An LLM arranges, controls, and interacts with your UI components (Vessels) based on user intent and available screen space.',
          details: `
## Key Concepts
- **Vessels**: State machines representing UI components with variants and actions
- **Chart**: Layout surface in one of two modes — tiling (default: a preorder H/V split tree) or grid (integer cell coordinates)
- **Engine**: Server-side LLM decision core that returns execution plans
- **Protocol**: Shared types and message definitions between client and engine

## Packages
- \`@maelstrom-co/react\` — React bindings (createMaelstrom, vessel, Provider, Chart)
- \`@maelstrom-co/client\` — Framework-agnostic client (Orchestrator, Connectors, ChartManager)
- \`@maelstrom-co/protocol\` — Shared types, Zod schemas, message contract
- \`@maelstrom-co/telemetry\` — Opt-in operational facts and bounded application-owned sink delivery
- \`@maelstrom-co/engine\` — LLM decision engine (createEngine, LLMProvider)
- \`@maelstrom-co/react-devtools\` — Optional React diagnostics extension (devtools, m.Devtools)
- \`@maelstrom-co/devtools\` — Optional framework-independent collector, explicit capture, and shared browser panel

## DevTools
Use the DevTools guide for request, layout, voice, and recording inspection. Automatic activity contains metadata; content requires explicit recording. Default production entrypoints are inert. The /production entrypoints opt into browser tools in every build; Engine forwarding needs separate host authorization and stays disabled in production.
`,
          // The Architecture Overview is an interactive Astro island living at a
          // src/pages route (outside the docs content collection, so the island
          // doesn't crash the llms-full.txt container render). Surface it here so
          // LLM consumers still get a pointer to the runtime-loop walkthrough.
          optionalLinks: [
            {
              label: 'Architecture Overview',
              url: 'https://docs.maelstrom-ai.co/understanding/architecture/',
              description:
                'Interactive walkthrough of the browser, protocol, and Engine request loop, the layout-before-actions order, and optional DevTools evidence paths.',
            },
          ],
          customSets: [
            {
              label: 'Getting Started',
              paths: ['getting-started/**'],
              description:
                'Introduction, quick start, core concepts, and installation',
            },
            {
              label: 'Guides',
              paths: ['guides/**'],
              description:
                'Task-oriented how-tos for React, Engine, and Client',
            },
            {
              label: 'API Reference',
              paths: ['reference/**'],
              description: 'Complete API documentation for all packages',
            },
          ],
          promote: [
            'getting-started/introduction',
            'getting-started/quick-start',
            'getting-started/core-concepts',
          ],
          demote: ['community/changelog'],
        }),
        telemetryTypeDoc({
          entryPoints: [
            '../../packages/telemetry/src/index.ts',
            '../../packages/telemetry/src/integration.ts',
          ],
          tsconfig: '../../packages/telemetry/tsconfig.lib.json',
          output: 'reference/telemetry',
          sidebar: { label: '@maelstrom-co/telemetry', collapsed: true },
          typeDoc: multiEntryTypeDocOptions,
        }),
        devtoolsTypeDoc({
          entryPoints: ['../../packages/devtools/src/index.ts'],
          tsconfig: '../../packages/devtools/tsconfig.lib.json',
          output: 'reference/devtools',
          sidebar: { label: '@maelstrom-co/devtools', collapsed: true },
          typeDoc: multiEntryTypeDocOptions,
        }),
        reactDevtoolsTypeDoc({
          entryPoints: ['../../packages/react-devtools/src/index.ts'],
          tsconfig: '../../packages/react-devtools/tsconfig.lib.json',
          output: 'reference/react-devtools',
          sidebar: { label: '@maelstrom-co/react-devtools', collapsed: true },
          typeDoc: multiEntryTypeDocOptions,
        }),
        reactTypeDoc({
          entryPoints: ['../../packages/react/src/index.ts'],
          tsconfig: '../../packages/react/tsconfig.lib.json',
          output: 'reference/react',
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
          output: 'reference/client',
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
          output: 'reference/connectors',
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
          output: 'reference/protocol',
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
          output: 'reference/engine',
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
          output: 'reference/planner-llm',
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
          output: 'reference/realtime',
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
          output: 'reference/realtime-protocol',
          sidebar: {
            label: '@maelstrom-co/realtime-protocol',
            collapsed: true,
          },
          typeDoc: multiEntryTypeDocOptions,
        }),
        realtimeOpenaiTypeDoc({
          entryPoints: ['../../packages/realtime-openai/src/index.ts'],
          tsconfig: '../../packages/realtime-openai/tsconfig.lib.json',
          output: 'reference/realtime-openai',
          sidebar: { label: '@maelstrom-co/realtime-openai', collapsed: true },
          typeDoc: multiEntryTypeDocOptions,
        }),
        reactRealtimeTypeDoc({
          entryPoints: ['../../packages/react-realtime/src/index.ts'],
          tsconfig: '../../packages/react-realtime/tsconfig.lib.json',
          output: 'reference/react-realtime',
          sidebar: {
            label: '@maelstrom-co/react-realtime',
            collapsed: true,
          },
          typeDoc: multiEntryTypeDocOptions,
        }),
        realtimeOpenaiLiveTypeDoc({
          entryPoints: ['../../packages/realtime-openai-live/src/index.ts'],
          tsconfig: '../../packages/realtime-openai-live/tsconfig.lib.json',
          output: 'reference/realtime-openai-live',
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
          output: 'reference/realtime-openai-live-server',
          sidebar: {
            label: '@maelstrom-co/realtime-openai-live-server',
            collapsed: true,
          },
          typeDoc: multiEntryTypeDocOptions,
        }),
        realtimeOpenaiServerTypeDoc({
          entryPoints: ['../../packages/realtime-openai-server/src/index.ts'],
          tsconfig: '../../packages/realtime-openai-server/tsconfig.lib.json',
          output: 'reference/realtime-openai-server',
          sidebar: {
            label: '@maelstrom-co/realtime-openai-server',
            collapsed: true,
          },
          typeDoc: multiEntryTypeDocOptions,
        }),
        realtimeLivekitTypeDoc({
          entryPoints: ['../../packages/realtime-livekit/src/index.ts'],
          tsconfig: '../../packages/realtime-livekit/tsconfig.lib.json',
          output: 'reference/realtime-livekit',
          sidebar: {
            label: '@maelstrom-co/realtime-livekit',
            collapsed: true,
          },
          typeDoc: multiEntryTypeDocOptions,
        }),
        realtimeLivekitServerTypeDoc({
          entryPoints: ['../../packages/realtime-livekit-server/src/index.ts'],
          tsconfig: '../../packages/realtime-livekit-server/tsconfig.lib.json',
          output: 'reference/realtime-livekit-server',
          sidebar: {
            label: '@maelstrom-co/realtime-livekit-server',
            collapsed: true,
          },
          typeDoc: multiEntryTypeDocOptions,
        }),
        realtimeLivekitAgentTypeDoc({
          entryPoints: ['../../packages/realtime-livekit-agent/src/index.ts'],
          tsconfig: '../../packages/realtime-livekit-agent/tsconfig.lib.json',
          output: 'reference/realtime-livekit-agent',
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
          output: 'reference/realtime-vad',
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
      components: {
        Header: './src/components/Header.astro',
        Sidebar: './src/components/Sidebar.astro',
        ThemeSelect: './src/components/ThemeSelect.astro',
        Head: './src/components/Head.astro',
        Pagination: './src/components/Pagination.astro',
      },
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { slug: 'getting-started/introduction' },
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
          label: 'Understanding',
          items: [
            { slug: 'understanding/why-maelstrom' },
            { slug: 'understanding/comparison' },
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
        {
          label: 'API Reference',
          items: [
            reactTypeDocSidebarGroup,
            devtoolsTypeDocSidebarGroup,
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
          ],
        },
        {
          label: 'Coding agents',
          items: [
            { label: 'Prompts library', link: '/agents/prompts/' },
            { label: 'Agent skills', link: '/agents/skills/' },
            {
              label: 'Testing prompts and skills',
              link: '/agents/evaluations/',
            },
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
      ],
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
