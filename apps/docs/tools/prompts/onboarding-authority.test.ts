import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parsePromptSource } from './library';

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
  expect(prompt.metadata.prompt_version).toBe('0.1.1');
});
