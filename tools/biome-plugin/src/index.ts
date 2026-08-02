import { dirname } from 'node:path';
import {
  type CreateNodes,
  type CreateNodesContext,
  createNodesFromFiles,
} from '@nx/devkit';

export interface BiomePluginOptions {
  lintTargetName?: string;
  formatTargetName?: string;
  checkTargetName?: string;
}

const defaultOptions: Required<BiomePluginOptions> = {
  lintTargetName: 'lint',
  formatTargetName: 'format',
  checkTargetName: 'check',
};

export const createNodes: CreateNodes<BiomePluginOptions> = [
  '**/biome.json',
  async (configFiles, options, context) => {
    return await createNodesFromFiles(
      (configFile, options, context) =>
        createNodesInternal(configFile, options, context),
      configFiles,
      options,
      context,
    );
  },
];

async function createNodesInternal(
  configFilePath: string,
  options: BiomePluginOptions | undefined,
  _context: CreateNodesContext,
) {
  const root = dirname(configFilePath);
  const opts = { ...defaultOptions, ...options };

  // Ignore the root biome.json - we only want to add targets to projects
  if (root === '.') {
    return {};
  }

  const baseInputs = [
    'default',
    '^default',
    '{workspaceRoot}/biome.json',
    '{projectRoot}/biome.json',
    {
      externalDependencies: ['@biomejs/biome'],
    },
  ];

  return {
    projects: {
      [root]: {
        targets: {
          // `--error-on-warnings` on every read-only target, so a warning
          // fails the same way locally as it does in CI. Without it the two
          // bars drift: warnings pile up unnoticed until someone runs the
          // flag by hand and finds a backlog.
          [opts.lintTargetName]: {
            command: 'biome lint {projectRoot} --error-on-warnings',
            cache: true,
            inputs: baseInputs,
            metadata: {
              description: 'Lint files with Biome',
              technologies: ['biome'],
            },
          },
          // The only writing target, and the reason it must never be what CI
          // runs: in CI it would rewrite the checkout and report success,
          // hiding exactly the drift it looks like it is guarding.
          [opts.formatTargetName]: {
            command: 'biome format {projectRoot} --write',
            cache: false,
            metadata: {
              description: 'Format files with Biome (writes)',
              technologies: ['biome'],
            },
          },
          // Supersets `lint`: formatter and assists (import ordering) too.
          // This is the CI gate.
          [opts.checkTargetName]: {
            command: 'biome check {projectRoot} --error-on-warnings',
            cache: true,
            inputs: baseInputs,
            metadata: {
              description: 'Check files with Biome (lint + format + assists)',
              technologies: ['biome'],
            },
          },
        },
      },
    },
  };
}
