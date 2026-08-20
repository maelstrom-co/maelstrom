import { describe, expect, test } from 'bun:test';
import {
  applyVersionOverrides,
  type SubstitutionContext,
  substituteManifest,
} from './publish-packages.ts';

describe('applyVersionOverrides', () => {
  test('rehearses the version and internal dependencies that Nx does not write during a dry run', () => {
    const ctx: SubstitutionContext = {
      catalog: { '@maelstrom-co/realtime': '^0.2.0' },
      workspaceVersions: new Map([
        ['@maelstrom-co/client', '0.0.0'],
        ['@maelstrom-co/engine', '0.0.0'],
        ['@maelstrom-co/protocol', '0.0.0'],
        ['@maelstrom-co/react', '0.0.0'],
        ['@maelstrom-co/realtime', '0.0.0'],
      ]),
    };
    const overrides = new Map([
      ['@maelstrom-co/client', '0.1.0-alpha.0'],
      ['@maelstrom-co/engine', '0.1.0-alpha.0'],
      ['@maelstrom-co/protocol', '0.1.0-alpha.0'],
      ['@maelstrom-co/react', '0.1.0-alpha.0'],
      ['@maelstrom-co/realtime', '0.1.0-alpha.0'],
    ]);
    const result = applyVersionOverrides(
      ctx,
      {
        name: '@maelstrom-co/client',
        version: '0.0.0',
        dependencies: {
          '@maelstrom-co/protocol': '0.0.0',
          '@maelstrom-co/react': 'workspace:^',
          '@maelstrom-co/engine': 'workspace:~',
          '@maelstrom-co/realtime': 'catalog:',
        },
      },
      overrides,
    );

    expect(substituteManifest(result.ctx, result.manifest)).toMatchObject({
      version: '0.1.0-alpha.0',
      dependencies: {
        '@maelstrom-co/protocol': '0.1.0-alpha.0',
        '@maelstrom-co/react': '^0.1.0-alpha.0',
        '@maelstrom-co/engine': '~0.1.0-alpha.0',
        '@maelstrom-co/realtime': '^0.2.0',
      },
    });
    expect(ctx.workspaceVersions.get('@maelstrom-co/protocol')).toBe('0.0.0');
  });
});
