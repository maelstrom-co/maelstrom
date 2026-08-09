import { describe, expect, test } from 'bun:test';
import {
  applyVersionOverrides,
  type SubstitutionContext,
  substituteManifest,
} from './publish-packages.ts';

describe('applyVersionOverrides', () => {
  test('rehearses the version and internal dependencies that Nx does not write during a dry run', () => {
    const ctx: SubstitutionContext = {
      catalog: {},
      workspaceVersions: new Map([
        ['@maelstrom-co/client', '0.0.0'],
        ['@maelstrom-co/protocol', '0.0.0'],
      ]),
    };
    const overrides = new Map([
      ['@maelstrom-co/client', '0.1.0-alpha.0'],
      ['@maelstrom-co/protocol', '0.1.0-alpha.0'],
    ]);
    const result = applyVersionOverrides(
      ctx,
      {
        name: '@maelstrom-co/client',
        version: '0.0.0',
        dependencies: { '@maelstrom-co/protocol': '0.0.0' },
      },
      overrides,
    );

    expect(substituteManifest(result.ctx, result.manifest)).toMatchObject({
      version: '0.1.0-alpha.0',
      dependencies: {
        '@maelstrom-co/protocol': '0.1.0-alpha.0',
      },
    });
    expect(ctx.workspaceVersions.get('@maelstrom-co/protocol')).toBe('0.0.0');
  });
});
