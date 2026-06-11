import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import starlight from '@astrojs/starlight';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, fontProviders } from 'astro/config';
import starlightLlmsTxt from 'starlight-llms-txt';
import { createStarlightTypeDocPlugin } from 'starlight-typedoc';

const [reactTypeDoc, reactTypeDocSidebarGroup] =
  createStarlightTypeDocPlugin();
const [clientTypeDoc, clientTypeDocSidebarGroup] =
  createStarlightTypeDocPlugin();
const [protocolTypeDoc, protocolTypeDocSidebarGroup] =
  createStarlightTypeDocPlugin();
const [engineTypeDoc, engineTypeDocSidebarGroup] =
  createStarlightTypeDocPlugin();
const [voiceTypeDoc, voiceTypeDocSidebarGroup] =
  createStarlightTypeDocPlugin();
const [voiceServerTypeDoc, voiceServerTypeDocSidebarGroup] =
  createStarlightTypeDocPlugin();
const [reactVoiceTypeDoc, reactVoiceTypeDocSidebarGroup] =
  createStarlightTypeDocPlugin();

// TypeDoc emits {path} relative to its `basePath` setting. We pin basePath to
// the workspace root on every plugin call, so {path} carries the full
// repo-relative path (e.g. `packages/engine/src/lib/engine.ts`). One template
// for all packages keeps the URL space coherent.
const repoRoot = '../../';
const sourceLinkTemplate =
  'https://github.com/maelstrom-co/maelstrom/blob/main/{path}#L{line}';

export default defineConfig({
  site: 'https://docs.maelstrom-ai.co',
  output: 'static',
  server: { port: 4322 },
  redirects: {
    '/': { destination: '/getting-started/introduction/', status: 301 },
  },
  markdown: {
    shikiConfig: {
      themes: {
        light: 'github-light',
        dark: 'github-dark',
      },
      defaultColor: false,
      transformers: [
        {
          // Extract title="..." from code fence meta and set as data attribute
          name: 'meta-title',
          pre(node) {
            const raw = this.options.meta?.__raw;
            if (!raw) return;
            const match = raw.match(/title="([^"]+)"/);
            if (match) {
              node.properties['data-title'] = match[1];
            }
          },
        },
      ],
    },
  },
  integrations: [
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
                'Task-oriented how-tos for React, Engine, Client, and Voice',
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
        voiceTypeDoc({
          entryPoints: ['../../packages/voice/src/index.ts'],
          tsconfig: '../../packages/voice/tsconfig.lib.json',
          output: 'reference/voice',
          sidebar: { label: '@maelstrom-co/voice', collapsed: true },
          typeDoc: {
            excludeInternal: true,
            disableGit: true,
            basePath: repoRoot,
            sourceLinkTemplate,
          },
        }),
        voiceServerTypeDoc({
          entryPoints: ['../../packages/voice-server/src/index.ts'],
          tsconfig: '../../packages/voice-server/tsconfig.lib.json',
          output: 'reference/voice-server',
          sidebar: { label: '@maelstrom-co/voice-server', collapsed: true },
          typeDoc: {
            excludeInternal: true,
            disableGit: true,
            basePath: repoRoot,
            sourceLinkTemplate,
          },
        }),
        reactVoiceTypeDoc({
          entryPoints: ['../../packages/react-voice/src/index.ts'],
          tsconfig: '../../packages/react-voice/tsconfig.lib.json',
          output: 'reference/react-voice',
          sidebar: { label: '@maelstrom-co/react-voice', collapsed: true },
          typeDoc: {
            excludeInternal: true,
            disableGit: true,
            basePath: repoRoot,
            sourceLinkTemplate,
          },
        }),
      ],
      customCss: ['./src/styles/custom.css'],
      expressiveCode: false,
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
            { slug: 'tutorials/voice-control' },
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
            {
              label: 'Voice',
              items: [
                { slug: 'guides/voice/voice-integration' },
                { slug: 'guides/voice/vad-configuration' },
              ],
            },
          ],
        },
        {
          label: 'API Reference',
          items: [
            reactTypeDocSidebarGroup,
            clientTypeDocSidebarGroup,
            protocolTypeDocSidebarGroup,
            engineTypeDocSidebarGroup,
            voiceTypeDocSidebarGroup,
            voiceServerTypeDocSidebarGroup,
            reactVoiceTypeDocSidebarGroup,
          ],
        },
        {
          label: 'Understanding',
          items: [
            { slug: 'understanding/why-maelstrom' },
            { slug: 'understanding/architecture' },
            { slug: 'understanding/voice-architecture' },
            { slug: 'understanding/engine' },
            { slug: 'understanding/protocol' },
            { slug: 'understanding/llm-orchestration' },
            { slug: 'understanding/vessel-state-machine' },
            { slug: 'understanding/connectors' },
            { slug: 'understanding/grid-vs-tiling' },
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
