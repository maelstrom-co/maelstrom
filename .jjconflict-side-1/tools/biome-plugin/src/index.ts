import { dirname } from 'node:path';
import {
  type CreateNodesContextV2,
  type CreateNodesV2,
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

export const createNodesV2: CreateNodesV2<BiomePluginOptions> = [
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
  _context: CreateNodesContextV2,
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
          [opts.lintTargetName]: {
            command: 'biome lint {projectRoot}',
            cache: true,
            inputs: baseInputs,
            metadata: {
              description: 'Lint files with Biome',
              technologies: ['biome'],
            },
          },
          [opts.formatTargetName]: {
            command: 'biome format {projectRoot} --write',
            cache: false,
            metadata: {
              description: 'Format files with Biome',
              technologies: ['biome'],
            },
          },
          [opts.checkTargetName]: {
            command: 'biome check {projectRoot}',
            cache: true,
            inputs: baseInputs,
            metadata: {
              description: 'Check files with Biome (lint + format)',
              technologies: ['biome'],
            },
          },
        },
      },
    },
  };
}
