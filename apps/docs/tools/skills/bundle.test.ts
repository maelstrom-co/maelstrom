import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { unzipSync } from 'fflate';
import { CANONICAL_VOICE_DOCUMENTS, createSkillsBundle } from './bundle';

async function bundleFromSources(sources: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'maelstrom-skill-sources-'));
  try {
    const files = {
      ...Object.fromEntries(
        CANONICAL_VOICE_DOCUMENTS.map((path) => [
          `docs/${path}`,
          '# Architecture\n',
        ]),
      ),
      ...sources,
    };
    for (const [path, content] of Object.entries(files)) {
      const destination = join(root, path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, content);
    }
    return unzipSync(
      await createSkillsBundle(join(root, 'skills'), join(root, 'docs')),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('individual skill resources', () => {
  test('includes transitive references once, preserving anchors and canonical source bytes', async () => {
    const guide = '[Details](nested/details.md#limits)\n';
    const details =
      '[Back](../guide.md)\n[External](https://example.com/guide)\n';
    const archive = await bundleFromSources({
      'skills/maelstrom-example/SKILL.md':
        'Read [`../references/guide.md`](../references/guide.md) and [details](../references/nested/details.md#limits).\n',
      'skills/references/guide.md': guide,
      'skills/references/nested/details.md': details,
      'skills/references/unrelated.md': 'Not needed by this procedure.\n',
    });
    const prefix = 'apps/docs/skills/maelstrom-example/';
    expect(
      Object.keys(archive)
        .filter((path) => path.startsWith(prefix))
        .sort(),
    ).toEqual([
      `${prefix}SKILL.md`,
      `${prefix}references/guide.md`,
      `${prefix}references/nested/details.md`,
    ]);
    expect(new TextDecoder().decode(archive[`${prefix}SKILL.md`])).toBe(
      'Read [`references/guide.md`](references/guide.md) and [details](references/nested/details.md#limits).\n',
    );
    expect(
      new TextDecoder().decode(archive[`${prefix}references/guide.md`]),
    ).toBe(guide);
    expect(
      new TextDecoder().decode(
        archive[`${prefix}references/nested/details.md`],
      ),
    ).toBe(details);
    expect(
      new TextDecoder().decode(archive['apps/docs/skills/references/guide.md']),
    ).toBe(guide);
  });

  test('rejects a missing transitive reference instead of shipping incomplete guidance', async () => {
    await expect(
      bundleFromSources({
        'skills/maelstrom-example/SKILL.md': '[Guide](../references/guide.md)',
        'skills/references/guide.md': '[Missing](missing.md)',
      }),
    ).rejects.toThrow(
      'Missing skill reference: apps/docs/skills/references/guide.md -> missing.md',
    );
  });

  test('rejects dependencies on another skill rather than hiding an installation requirement', async () => {
    await expect(
      bundleFromSources({
        'skills/maelstrom-example/SKILL.md':
          '[Another skill](../other/SKILL.md)',
        'skills/other/SKILL.md': 'Other procedure.',
      }),
    ).rejects.toThrow('Reference escapes skill resources');
  });

  test('rejects conflicting private and shared reference content instead of overwriting it', async () => {
    await expect(
      bundleFromSources({
        'skills/maelstrom-example/SKILL.md': '[Shared](../references/guide.md)',
        'skills/maelstrom-example/references/guide.md':
          'Skill-specific guidance.',
        'skills/references/guide.md': 'Shared guidance.',
      }),
    ).rejects.toThrow('Conflicting skill reference');
  });
});
