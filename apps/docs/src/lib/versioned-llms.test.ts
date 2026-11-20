import { expect, test } from 'bun:test';

import type { DocsVersions } from './docs-versions';
import {
  type VersionedLlmsConfig,
  absoluteMarkdownLinks,
  llmsIndex,
  llmsPageFilter,
  llmsSetSlug,
  versionSets,
} from './versioned-llms';

const docs: DocsVersions = {
  versions: ['dev', '0.3', '0.2'],
  defaultVersion: '0.3',
  pages: {
    dev: ['getting-started/introduction', 'reference/react/readme'],
    '0.3': ['getting-started/introduction'],
    '0.2': ['getting-started/introduction'],
  },
};

const config: VersionedLlmsConfig = {
  title: 'Maelstrom',
  description: 'Intent-driven apps.',
  abridgedDirectory: 'getting-started',
  sets: [
    {
      label: 'Getting Started',
      directory: 'getting-started',
      description: 'Start here',
      slug: llmsSetSlug('Getting Started'),
    },
    {
      label: 'API Reference',
      directory: 'reference',
      description: 'Every package',
      slug: llmsSetSlug('API Reference'),
    },
  ],
  optionalLinks: [],
  details: { '0.2': '- Frozen 0.2 notes', dev: '- Main notes' },
};

test('set labels publish under the slugs the plugin used', () => {
  expect(llmsSetSlug('Getting Started')).toBe('getting-started');
  expect(llmsSetSlug('API Reference')).toBe('api-reference');
});

test('a version lists only the sets it has pages for', () => {
  expect(versionSets(config, docs.pages.dev!).map((set) => set.slug)).toEqual([
    'getting-started',
    'api-reference',
  ]);
  expect(
    versionSets(config, docs.pages['0.2']!).map((set) => set.slug),
  ).toEqual(['getting-started']);
});

test('each corpus reads only its own version folder', () => {
  expect(llmsPageFilter(config, '0.2', 'llms-full')).toEqual({
    include: ['0.2/**'],
  });
  expect(llmsPageFilter(config, 'dev', 'llms-small')).toEqual({
    include: ['dev/**'],
    exclude: ['!dev/getting-started/**'],
  });
});

test('a version index links its own files, its notes, and every version', () => {
  const index = llmsIndex(config, docs, '0.2');
  expect(index).toStartWith('# Maelstrom 0.2\n');
  expect(index).toContain('- Frozen 0.2 notes');
  expect(index).not.toContain('Main notes');
  expect(index).toContain('(/0.2/llms-full.txt)');
  expect(index).toContain('(/0.2/_llms-txt/getting-started.txt)');
  expect(index).not.toContain('api-reference');
  expect(index).toContain('- [dev](/dev/llms.txt): built from main');
  expect(index).toContain(
    '- [0.3](/0.3/llms.txt): the latest release on npm, also served without a version prefix',
  );
  expect(index).toContain('- [0.2](/0.2/llms.txt): this file');
});

test('root-relative links become absolute and others stay', () => {
  expect(
    absoluteMarkdownLinks(
      '[a](/0.2/llms.txt) [b](https://x.test/) [c](//cdn.test/x) [d](#top)',
      new URL('https://docs.example/'),
    ),
  ).toBe(
    '[a](https://docs.example/0.2/llms.txt) [b](https://x.test/) [c](//cdn.test/x) [d](#top)',
  );
});
