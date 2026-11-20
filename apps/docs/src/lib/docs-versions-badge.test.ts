import { expect, test } from 'bun:test';

import { versionOptions } from './docs-versions';

const docs = {
  versions: ['dev', '0.3', '0.2'],
  defaultVersion: '0.3',
  pages: {
    dev: ['getting-started/introduction', 'guides/new'],
    '0.3': ['getting-started/introduction', 'guides/new'],
    '0.2': ['getting-started/introduction'],
  },
};

test('badge options label releases with v and tag latest and dev', () => {
  const options = versionOptions(docs, '0.3/guides/new');
  expect(
    options.map(({ version, label, tag, current }) => ({
      version,
      label,
      tag,
      current,
    })),
  ).toEqual([
    { version: 'dev', label: 'dev', tag: 'unstable', current: false },
    { version: '0.3', label: 'v0.3', tag: 'latest', current: true },
    { version: '0.2', label: 'v0.2', tag: undefined, current: false },
  ]);
});

test('badge options link to the same page or the version landing page', () => {
  const hrefs = versionOptions(docs, '0.3/guides/new').map((o) => o.href);
  expect(hrefs).toEqual([
    '/dev/guides/new/',
    '/0.3/guides/new/',
    '/0.2/getting-started/introduction/',
  ]);
});

test('a dev-only build tags dev as unstable, not latest', () => {
  const devOnly = {
    versions: ['dev'],
    defaultVersion: 'dev',
    pages: { dev: ['getting-started/introduction'] },
  };
  expect(versionOptions(devOnly, 'dev/getting-started/introduction')).toEqual([
    {
      version: 'dev',
      label: 'dev',
      tag: 'unstable',
      href: '/dev/getting-started/introduction/',
      current: true,
    },
  ]);
});
