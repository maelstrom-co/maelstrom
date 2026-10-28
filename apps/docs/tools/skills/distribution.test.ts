import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { skillTasks } from '../../src/lib/skill-onboarding';
import { createPublicDistributions } from './distribution';

const root = resolve(import.meta.dir, '../../../..');
const revision = '3887c3fedee38d549733f015daa330e864e17f1e';
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

test('standalone repositories include the runnable starter and every advertised skill with its local references', async () => {
  const { starter, skills } = await createPublicDistributions(root, revision);
  expect(JSON.parse(text(starter['package.json'])).scripts.start).toBe(
    'vite build && bun --no-env-file server.ts',
  );
  expect(starter['package.json.template']).toBeUndefined();
  expect(JSON.parse(text(starter['SOURCE.json'])).revision).toBe(revision);
  const leads = Object.keys(skills).filter((path) =>
    /^skills\/[^/]+\/SKILL\.md$/.test(path),
  );
  expect(leads.sort()).toEqual(
    [
      'skills/maelstrom/SKILL.md',
      ...skillTasks.map(({ id }) => `skills/${id}/SKILL.md`),
    ].sort(),
  );
  const documented = [
    ...text(skills['README.md']).matchAll(/^\| `([^`]+)` \|/gm),
  ].map((match) => match[1]);
  expect(documented.sort()).toEqual(
    leads.map((path) => path.split('/')[1]).sort(),
  );
  for (const lead of leads) {
    const folder = lead.slice(0, -'SKILL.md'.length);
    for (const [, target] of text(skills[lead]).matchAll(/\]\(([^)]+)\)/g)) {
      if (/^(?:[a-z][a-z\d+.-]*:|#)/i.test(target)) continue;
      expect(
        skills[resolve('/', folder, target).slice(1)],
        `${lead} -> ${target}`,
      ).toBeDefined();
    }
  }
  expect(
    Object.keys(skills).some((path) =>
      /trials|\.env|node_modules|^docs\//.test(path),
    ),
  ).toBe(false);
  expect(text(skills.LICENSE)).toContain('MIT License');
});

test('native hosts resolve the same skill tree and keep plugin versions aligned', async () => {
  const { skills } = await createPublicDistributions(root, revision);
  const plugin = JSON.parse(text(skills['plugin.json']));
  const claude = JSON.parse(text(skills['.claude-plugin/plugin.json']));
  expect(claude.version).toBe(plugin.version);
  const onboarding = plugin.extensions['com.openai'].onboardingSkill.replace(
    /^\.\//,
    '',
  );
  expect(skills[onboarding]).toBeDefined();
  const marketplace = JSON.parse(
    text(skills['.agents/plugins/marketplace.json']),
  );
  expect(marketplace.plugins[0].source).toEqual({
    source: 'local',
    path: './',
  });
  for (const path of [
    '.claude-plugin/marketplace.json',
    '.cursor-plugin/marketplace.json',
  ]) {
    const catalog = JSON.parse(text(skills[path]));
    expect(catalog.plugins[0].source).toBe('.');
    expect(catalog.plugins[0].version).toBe(plugin.version);
  }
  expect(JSON.parse(text(skills['package.json'])).pi.skills).toEqual([
    './skills',
  ]);
});

test('distribution provenance rejects ambiguous source revisions', async () => {
  await expect(createPublicDistributions(root, 'main')).rejects.toThrow(
    'full source commit SHA',
  );
});
