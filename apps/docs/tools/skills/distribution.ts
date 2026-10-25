import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { createSkillsBundle } from './bundle';
import { createReactStarter } from './starter-bundle';

const encode = (value: string) => new TextEncoder().encode(value);
const json = (value: unknown) => encode(`${JSON.stringify(value, null, 2)}\n`);

/** Creates standalone repositories from the reviewed starter and portable skill bundle. */
export async function createPublicDistributions(
  root: string,
  sourceRevision: string,
) {
  if (!/^[a-f0-9]{40}$/.test(sourceRevision))
    throw new Error('Use the full source commit SHA');
  const license = resolve(root, 'LICENSE');
  const source = {
    repository: 'https://github.com/maelstrom-co/maelstrom',
    revision: sourceRevision,
    workingDirectory: 'Maelstrom repository root',
    updateCommand:
      'bun apps/docs/tools/skills/export-distributions.ts <empty-output-directory> <source-commit-sha>',
  };
  const starter = unzipSync(
    await createReactStarter(
      resolve(root, 'apps/docs/starters/react'),
      license,
    ),
  );
  starter['SOURCE.json'] = json({
    ...source,
    directory: 'apps/docs/starters/react',
  });

  const bundle = unzipSync(
    await createSkillsBundle(
      resolve(root, 'apps/docs/skills'),
      resolve(root, 'docs'),
    ),
  );
  const skills: Record<string, Uint8Array> = {};
  for (const [path, bytes] of Object.entries(bundle)) {
    const relative = /^apps\/docs\/skills\/(maelstrom(?:-[a-z]+)*)\/(.+)$/.exec(
      path,
    );
    if (relative) skills[`skills/${relative[1]}/${relative[2]}`] = bytes;
  }
  const version = '0.2.0';
  const identity = {
    name: 'maelstrom',
    version,
    description:
      'Build and integrate Maelstrom dynamic interfaces with guided coding workflows.',
    author: { name: 'Maelstrom', url: 'https://maelstrom-ai.co' },
    homepage: 'https://docs.maelstrom-ai.co/agents/skills/',
    repository: 'https://github.com/maelstrom-co/skills',
    license: 'MIT',
    keywords: ['maelstrom', 'react', 'agent-skills', 'dynamic-ui'],
  };
  skills['plugin.json'] = json({
    $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
    ...identity,
    extensions: {
      'com.openai': {
        onboardingSkill: './skills/maelstrom/SKILL.md',
        requires_local_executor: true,
      },
    },
  });
  skills['.claude-plugin/plugin.json'] = json(identity);
  const marketplace = {
    name: 'maelstrom-skills',
    description:
      'Maelstrom workflows for starting and integrating dynamic interfaces.',
    owner: { name: 'Maelstrom' },
    plugins: [
      {
        name: 'maelstrom',
        source: '.',
        description: identity.description,
        version,
      },
    ],
  };
  skills['.claude-plugin/marketplace.json'] = json(marketplace);
  skills['.cursor-plugin/marketplace.json'] = json(marketplace);
  skills['.agents/plugins/marketplace.json'] = json({
    name: 'maelstrom-skills',
    interface: { displayName: 'Maelstrom skills' },
    plugins: [
      {
        name: 'maelstrom',
        source: { source: 'local', path: './' },
        policy: { installation: 'AVAILABLE', authentication: 'ON_USE' },
        category: 'Productivity',
      },
    ],
  });
  skills['package.json'] = json({
    name: '@maelstrom-co/skills',
    version,
    private: true,
    license: 'MIT',
    description: identity.description,
    repository: {
      type: 'git',
      url: 'https://github.com/maelstrom-co/skills.git',
    },
    pi: { skills: ['./skills'] },
  });
  skills['README.md'] = new Uint8Array(
    await readFile(
      resolve(root, 'apps/docs/tools/skills/distribution-readme.md'),
    ),
  );
  skills.LICENSE = new Uint8Array(await readFile(license));
  skills['SOURCE.json'] = json({
    ...source,
    directory: 'apps/docs/skills',
    pluginVersion: version,
  });
  return { starter, skills };
}
