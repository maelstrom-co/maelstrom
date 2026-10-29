import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parsePromptSource, sdkVersionMatches } from './library';

test('copying the onboarding prompt does not grant implementation authority by default', async () => {
  const prompt = parsePromptSource(
    await readFile(
      resolve(
        import.meta.dir,
        '../../prompts/library/maelstrom-project-onboarding.md',
      ),
      'utf8',
    ),
  );
  expect(prompt.body).toContain(
    'Requested authority: [PLAN ONLY | IMPLEMENT THE BOUNDED INTEGRATION]',
  );
  expect(prompt.body).toContain(
    'If authority is omitted or the placeholder is unchanged, use PLAN ONLY.',
  );
  expect(prompt.body).toContain(
    'For PLAN ONLY, make no edits or installations.',
  );
});

test('integration prompts admit the frozen starter SDK and reject the next breaking line', async () => {
  const lock = Bun.JSONC.parse(
    await readFile(
      resolve(import.meta.dir, '../../starters/react/bun.lock.template'),
      'utf8',
    ),
  );
  for (const name of [
    'maelstrom-project-onboarding',
    'maelstrom-sdk-scaffold',
  ]) {
    const prompt = parsePromptSource(
      await readFile(
        resolve(import.meta.dir, `../../prompts/library/${name}.md`),
        'utf8',
      ),
    );
    for (const [sdk, range] of Object.entries(
      prompt.metadata.compatibility.sdk,
    )) {
      const resolution = lock.packages[sdk]?.[0];
      expect(typeof resolution).toBe('string');
      expect(resolution.startsWith(`${sdk}@`)).toBe(true);
      const version = resolution.slice(sdk.length + 1);
      expect(
        sdkVersionMatches(version, range),
        `${name}: ${sdk}@${version}`,
      ).toBe(true);
      expect(sdkVersionMatches('0.1.0', range)).toBe(true);
      expect(sdkVersionMatches('0.2.0', range)).toBe(false);
      expect(sdkVersionMatches('0.1.1-alpha.1', range)).toBe(false);
    }
  }
});
