import { dirname, join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import {
  type CreateNodesContextV2,
  type CreateNodesV2,
  type TargetConfiguration,
  createNodesFromFiles,
  joinPathFragments,
} from '@nx/devkit';

export interface AstroPluginOptions {
  buildTargetName?: string;
  devTargetName?: string;
  previewTargetName?: string;
  typecheckTargetName?: string;
}

const defaultOptions: Required<AstroPluginOptions> = {
  buildTargetName: 'build',
  devTargetName: 'dev',
  previewTargetName: 'preview',
  typecheckTargetName: 'typecheck',
};

export const createNodesV2: CreateNodesV2<AstroPluginOptions> = [
  '**/astro.config.{ts,mjs}',
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

function createNodesInternal(
  configFilePath: string,
  options: AstroPluginOptions | undefined,
  context: CreateNodesContextV2,
) {
  const projectRoot = dirname(configFilePath);
  const opts = { ...defaultOptions, ...options };

  // Validate that this is a project directory (has package.json or project.json)
  const siblingFiles = readdirSync(
    join(context.workspaceRoot, projectRoot),
  );
  if (
    !siblingFiles.includes('package.json') &&
    !siblingFiles.includes('project.json')
  ) {
    return {};
  }

  // Try to extract srcDir, publicDir, outDir from config file
  let srcDir = 'src';
  let publicDir = 'public';
  let outDir = 'dist';

  try {
    const configContent = readFileSync(
      join(context.workspaceRoot, configFilePath),
    ).toString();

    const srcDirMatch = configContent.match(/srcDir:\s*['"](.+?)['"]/);
    if (srcDirMatch) srcDir = srcDirMatch[1].replace(/^\.\//, '');

    const publicDirMatch = configContent.match(/publicDir:\s*['"](.+?)['"]/);
    if (publicDirMatch) publicDir = publicDirMatch[1].replace(/^\.\//, '');

    const outDirMatch = configContent.match(/outDir:\s*['"](.+?)['"]/);
    if (outDirMatch) outDir = outDirMatch[1].replace(/^\.\//, '');
  } catch (err) {
    console.warn(
      `[@maelstrom-co/astro-plugin] Could not read Astro config at ${configFilePath}, using default directories (src/, public/, dist/).`,
      err,
    );
  }

  const baseInputs = [
    `{projectRoot}/${configFilePath.split('/').pop()}`,
    joinPathFragments('{projectRoot}', srcDir, '**', '*'),
    joinPathFragments('{projectRoot}', publicDir, '**', '*'),
    {
      externalDependencies: ['astro'],
    },
  ];

  const buildTarget: TargetConfiguration = {
    command: 'astro build',
    options: { cwd: projectRoot },
    cache: true,
    dependsOn: ['^build'],
    inputs: [...baseInputs, 'production', '^production'],
    outputs: [joinPathFragments('{projectRoot}', outDir)],
    metadata: {
      description: 'Build the Astro application',
      technologies: ['astro'],
    },
  };

  const devTarget: TargetConfiguration = {
    command: 'astro dev',
    options: { cwd: projectRoot },
    cache: false,
    metadata: {
      description: 'Start the Astro development server',
      technologies: ['astro'],
    },
  };

  const previewTarget: TargetConfiguration = {
    command: 'astro preview',
    options: { cwd: projectRoot },
    cache: false,
    dependsOn: [opts.buildTargetName],
    metadata: {
      description: 'Preview the built Astro application',
      technologies: ['astro'],
    },
  };

  const typecheckTarget: TargetConfiguration = {
    command: 'astro check',
    options: { cwd: projectRoot },
    cache: true,
    inputs: [...baseInputs, '^production'],
    metadata: {
      description: 'Type-check the Astro application',
      technologies: ['astro'],
    },
  };

  return {
    projects: {
      [projectRoot]: {
        targets: {
          [opts.buildTargetName]: buildTarget,
          [opts.devTargetName]: devTarget,
          [opts.previewTargetName]: previewTarget,
          [opts.typecheckTargetName]: typecheckTarget,
        },
      },
    },
  };
}
