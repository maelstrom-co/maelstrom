import type { TilingTreeNode } from '@maelstrom-co/client';
import { parseTilingTree } from '@maelstrom-co/client';
import { describe, expect, it } from 'vitest';
import { MAIL_DEFAULT_LAYOUT, MAIL_NARROW_LAYOUT } from './default-layout';

describe('mail layouts', () => {
  it('puts the inbox left of the open email in a 2 to 3 split', () => {
    const root = parseTilingTree(MAIL_DEFAULT_LAYOUT.tree);
    expect(root?.type).toBe('split');
    expect(leafIds(root)).toEqual(['inbox-main', 'message-main']);
    if (root?.type !== 'split') return;
    expect(root.children.map((child) => child.weight)).toEqual([2, 3]);
  });

  it('stacks the inbox above the open email on narrow screens', () => {
    expect(MAIL_NARROW_LAYOUT.tree[0]).toBe('H');
    expect(leafIds(parseTilingTree(MAIL_NARROW_LAYOUT.tree))).toEqual([
      'inbox-main',
      'message-main',
    ]);
  });

  it('starts with the inbox list and the message reader only', () => {
    expect(
      MAIL_DEFAULT_LAYOUT.instances.map(({ vesselId, variant }) => [
        vesselId,
        variant,
      ]),
    ).toEqual([
      ['inbox', 'list'],
      ['message', 'read'],
    ]);
  });
});

function leafIds(node: TilingTreeNode | null): string[] {
  if (node === null) return [];
  if (node.type === 'leaf') return node.instanceId ? [node.instanceId] : [];
  return node.children.flatMap(({ node: child }) =>
    child ? leafIds(child) : [],
  );
}
