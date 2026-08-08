import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import starlight from '@astrojs/starlight';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, fontProviders } from 'astro/config';
import mermaid from 'astro-mermaid';
import starlightLlmsTxt from 'starlight-llms-txt';
import { createStarlightTypeDocPlugin } from 'starlight-typedoc';

const [reactTypeDoc, reactTypeDocSidebarGroup] = createStarlightTypeDocPlugin();
const [clientTypeDoc, clientTypeDocSidebarGroup] =
  createStarlightTypeDocPlugin();
const [protocolTypeDoc, protocolTypeDocSidebarGroup] =
  createStarlightTypeDocPlugin();
const [engineTypeDoc, engineTypeDocSidebarGroup] =
  createStarlightTypeDocPlugin();
const [realtimeTypeDoc, realtimeTypeDocSidebarGroup] =
  createStarlightTypeDocPlugin();
const [reactRealtimeTypeDoc, reactRealtimeTypeDocSidebarGroup] =
  createStarlightTypeDocPlugin();
const [realtimeServerTypeDoc, realtimeServerTypeDocSidebarGroup] =
  createStarlightTypeDocPlugin();
const [realtimeLivekitTypeDoc, realtimeLivekitTypeDocSidebarGroup] =
  createStarlightTypeDocPlugin();
const [realtimeLivekitServerTypeDoc, realtimeLivekitServerTypeDocSidebarGroup] =
  createStarlightTypeDocPlugin();
const [realtimeLivekitAgentTypeDoc, realtimeLivekitAgentTypeDocSidebarGroup] =
  createStarlightTypeDocPlugin();

// TypeDoc emits {path} relative to its `basePath` setting. We pin basePath to
// the workspace root on every plugin call, so {path} carries the full
// repo-relative path (e.g. `packages/engine/src/lib/engine.ts`). One template
// for all packages keeps the URL space coherent.
const repoRoot = '../../';
const sourceLinkTemplate =
  'https://github.com/maelstrom-co/maelstrom/blob/main/{path}#L{line}';
const multiEntryTypeDocOptions = {
  entryPointStrategy: 'resolve' as const,
  excludeInternal: true,
  disableGit: true,
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
- \`@maelstrom-co/engine\` — LLM decision engine (createEngine, LLMProvider)
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
                'Interactive walkthrough of the runtime feedback loop between the browser client, the protocol contract, and the server engine, plus the load-bearing layout-before-actions apply order.',
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
        reactTypeDoc({
          entryPoints: ['../../packages/react/src/index.ts'],
          tsconfig: '../../packages/react/tsconfig.lib.json',
          output: 'reference/react',
          sidebar: { label: '@maelstrom-co/react', collapsed: true },
          typeDoc: {
            excludeInternal: true,
            disableGit: true,
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
            disableGit: true,
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
            disableGit: true,
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
            disableGit: true,
            basePath: repoRoot,
            sourceLinkTemplate,
          },
        }),
        realtimeTypeDoc({
          entryPoints: [
            '../../packages/realtime/src/index.ts',
            '../../packages/realtime/src/openai.ts',
          ],
          tsconfig: '../../packages/realtime/tsconfig.lib.json',
          output: 'reference/realtime',
          sidebar: { label: '@maelstrom-co/realtime', collapsed: true },
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
        realtimeServerTypeDoc({
          entryPoints: ['../../packages/realtime-server/src/index.ts'],
          tsconfig: '../../packages/realtime-server/tsconfig.lib.json',
          output: 'reference/realtime-server',
          sidebar: {
            label: '@maelstrom-co/realtime-server',
            collapsed: true,
          },
          typeDoc: multiEntryTypeDocOptions,
        }),
        realtimeLivekitTypeDoc({
          entryPoints: [
            '../../packages/realtime-livekit/src/index.ts',
            '../../packages/realtime-livekit/src/protocol.ts',
            '../../packages/realtime-livekit/src/livekit-token.ts',
            '../../packages/realtime-livekit/src/vad-assets.ts',
          ],
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
          label: 'Private Beta',
          items: [{ slug: 'getting-started/install-beta' }],
        },
        {
          label: 'Getting Started',
          items: [
            { slug: 'getting-started/introduction' },
            { slug: 'getting-started/quick-start' },
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
            {
              label: 'Voice',
              items: [
                { slug: 'guides/voice/overview' },
                { slug: 'guides/voice/openai-realtime' },
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
            clientTypeDocSidebarGroup,
            protocolTypeDocSidebarGroup,
            engineTypeDocSidebarGroup,
            {
              label: 'Voice',
              items: [
                realtimeTypeDocSidebarGroup,
                reactRealtimeTypeDocSidebarGroup,
                realtimeServerTypeDocSidebarGroup,
                realtimeLivekitTypeDocSidebarGroup,
                realtimeLivekitServerTypeDocSidebarGroup,
                realtimeLivekitAgentTypeDocSidebarGroup,
              ],
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
  },
  srcDir: './src',
  outDir: './dist',
  fonts: [
    {
      provider: fontProviders.google(),
      name: 'Inter',
      cssVariable: '--font-heading',
      weights: [400, 500, 600, 700],
      fallbacks: ['system-ui', 'sans-serif'],
    },
    {
      provider: fontProviders.google(),
      name: 'JetBrains Mono',
      cssVariable: '--font-code',
      weights: [400, 500],
      fallbacks: ['monospace'],
    },
  ],
});
