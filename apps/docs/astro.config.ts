import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import starlight from '@astrojs/starlight';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, fontProviders } from 'astro/config';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import starlightLlmsTxt from 'starlight-llms-txt';
import { createStarlightTypeDocPlugin } from 'starlight-typedoc';
import mermaid from 'astro-mermaid';

const [reactTypeDoc, reactTypeDocSidebarGroup] =
  createStarlightTypeDocPlugin();
const [clientTypeDoc, clientTypeDocSidebarGroup] =
  createStarlightTypeDocPlugin();
const [protocolTypeDoc, protocolTypeDocSidebarGroup] =
  createStarlightTypeDocPlugin();
const [engineTypeDoc, engineTypeDocSidebarGroup] =
  createStarlightTypeDocPlugin();

// TypeDoc emits {path} relative to its `basePath` setting. We pin basePath to
// the workspace root on every plugin call, so {path} carries the full
// repo-relative path (e.g. `packages/engine/src/lib/engine.ts`). One template
// for all packages keeps the URL space coherent.
const repoRoot = '../../';
const sourceLinkTemplate =
  'https://github.com/maelstrom-co/maelstrom/blob/main/{path}#L{line}';

const docsRoot = path.resolve(process.cwd(), 'apps/docs/src/content/docs/reference');
const distRoot = path.resolve(process.cwd(), 'apps/docs/dist/reference');
const prunedReferencePaths = [
  'voice',
  'voice-server',
  'react-voice',
  'client/classes/VoiceWebSocketConnector.md',
  'client/README.md',
  'client/interfaces/AudioChunk.md',
  'client/interfaces/ConnectorCapabilities.md',
  'client/interfaces/EngineConnector.md',
  'client/interfaces/PushConnector.md',
  'client/interfaces/VoiceConnector.md',
  'client/interfaces/VoiceWebSocketConnectorOptions.md',
  'client/functions/packAudioFrame.md',
  'client/functions/parseAudioFrame.md',
  'protocol/README.md',
  'protocol/classes/VoiceError.md',
  'protocol/interfaces/TranscriptMessage.md',
  'protocol/type-aliases/VoiceClientMessage.md',
  'protocol/type-aliases/VoiceErrorCode.md',
  'protocol/type-aliases/VoiceServerMessage.md',
  'protocol/variables/VoiceClientMessageSchema.md',
  'protocol/variables/VoiceServerMessageSchema.md',
  'react/type-aliases/MaelstromExtension.md',
];

const prunedOutputPaths = [
  'voice',
  'voice-server',
  'react-voice',
  'client/readme',
  'client/classes/voicewebsocketconnector',
  'client/functions/packaudioframe',
  'client/functions/parseaudioframe',
  'client/interfaces/audiochunk',
  'client/interfaces/connectorcapabilities',
  'client/interfaces/engineconnector',
  'client/interfaces/pushconnector',
  'client/interfaces/voiceconnector',
  'client/interfaces/voicewebsocketconnectoroptions',
  'protocol/readme',
  'protocol/classes/voiceerror',
  'protocol/interfaces/transcriptmessage',
  'protocol/type-aliases/voiceclientmessage',
  'protocol/type-aliases/voiceerrorcode',
  'protocol/type-aliases/voiceservermessage',
  'protocol/variables/voiceclientmessageschema',
  'protocol/variables/voiceservermessageschema',
  'react/type-aliases/maelstromextension',
];

function pruneReferenceDocs() {
  for (const relativePath of prunedReferencePaths) {
    const absolutePath = path.join(docsRoot, relativePath);
    if (existsSync(absolutePath)) {
      rmSync(absolutePath, { recursive: true, force: true });
    }
  }
}

function pruneBuiltDocs() {
  for (const relativePath of prunedOutputPaths) {
    const absolutePath = path.join(distRoot, relativePath);
    if (existsSync(absolutePath)) {
      rmSync(absolutePath, { recursive: true, force: true });
    }
  }
}

export default defineConfig({
  site: 'https://docs.maelstrom-ai.co',
  output: 'static',
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
- **Chart**: Grid-based layout system using integer coordinates
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
            { slug: 'getting-started/core-concepts' },
            { slug: 'getting-started/installation' },
          ],
        },
        {
          label: 'Tutorials',
          items: [
            { slug: 'tutorials/first-dashboard' },
            { slug: 'tutorials/deploy-to-production' },
          ],
        },
        {
          label: 'Guides',
          items: [
            {
              label: 'React',
              items: [
                { slug: 'guides/react/creating-vessels' },
                { slug: 'guides/react/variants-and-actions' },
                { slug: 'guides/react/lazy-loading' },
                { slug: 'guides/react/layout-modes' },
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
    {
      name: 'prune-reference-docs',
      hooks: {
        'astro:build:start': () => {
          pruneReferenceDocs();
        },
        'astro:build:done': () => {
          pruneReferenceDocs();
          pruneBuiltDocs();
        },
      },
    },
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
