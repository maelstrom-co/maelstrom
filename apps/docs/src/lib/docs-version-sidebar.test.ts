import { describe, expect, test } from 'bun:test';

import { sidebarNeighbors, withCurrentEntry } from './docs-version-sidebar';

type Entries = Parameters<typeof withCurrentEntry>[0];

function link(href: string, isCurrent = false): Entries[number] {
  return {
    type: 'link',
    label: href,
    href,
    isCurrent,
    badge: undefined,
    attrs: {},
  };
}

function group(label: string, entries: Entries): Entries[number] {
  return { type: 'group', label, entries, collapsed: false, badge: undefined };
}

describe('withCurrentEntry', () => {
  test('marks the link for an unversioned page that Starlight left unmarked', () => {
    const entries = [
      link('/0.2/getting-started/introduction/'),
      group('Coding agents', [
        link('/agents/prompts/'),
        link('/agents/skills/'),
        link('/0.2/agents/evaluations/'),
      ]),
    ];

    const marked = withCurrentEntry(entries, '/agents/skills/');

    expect(sidebarNeighbors(marked)).toMatchObject({
      prev: { href: '/agents/prompts/' },
      next: { href: '/0.2/agents/evaluations/' },
    });
    expect(JSON.stringify(entries)).not.toContain('"isCurrent":true');
  });

  test('keeps the entries when Starlight already marked one', () => {
    const entries = [link('/0.2/a/', true), link('/0.2/b/')];

    expect(withCurrentEntry(entries, '/0.2/b/')).toBe(entries);
  });

  test('marks only the first of two links to the same page', () => {
    const marked = withCurrentEntry(
      [link('/agents/skills/'), link('/a/'), link('/agents/skills/')],
      '/agents/skills',
    );

    expect(
      marked.map((entry) => entry.type === 'link' && entry.isCurrent),
    ).toEqual([true, false, false]);
  });
});

describe('sidebarNeighbors', () => {
  test('has no neighbor past either end of the version', () => {
    expect(sidebarNeighbors([link('/0.2/a/', true)])).toEqual({
      prev: undefined,
      next: undefined,
    });
  });

  test('has no neighbors for a page the sidebar does not list', () => {
    expect(sidebarNeighbors([link('/0.2/a/'), link('/0.2/b/')])).toEqual({
      prev: undefined,
      next: undefined,
    });
  });
});
