import { dirname } from 'node:path';

import { type CreateNodes, type TargetConfiguration } from '@nx/devkit';

const projectConfig =
  /^(?:package\.json|(?:apps|infra|packages|tools)\/[^/]+\/(?:package|project)\.json)$/;
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

export const createNodes: CreateNodes = [
  '**/{package,project}.json',
  async (configFiles) => {
    const configs = [
      ...new Map(
        configFiles
          .filter((file) => projectConfig.test(file))
          .map((file) => [dirname(file), file]),
      ).entries(),
    ];
    return configs.map(([root, file]) => {
      const nested = configs
        .map(([candidate]) => candidate)
        .filter(
          (candidate) =>
            candidate !== root &&
            (root === '.' || candidate.startsWith(root + '/')),
        );
      const inputs = [
        '{projectRoot}/**/*',
        ...nested.map((child) => '!{workspaceRoot}/' + child + '/**/*'),
        '{workspaceRoot}/.oxfmtrc.json',
        '{workspaceRoot}/.gitignore',
        { externalDependencies: ['oxfmt', '@astrojs/compiler-rs'] },
      ];
      const paths = [root, ...nested.map((child) => '!' + child + '/**')]
        .map(quote)
        .join(' ');
      const targets: Record<string, TargetConfiguration> = {
        'format-check': {
          command: 'oxfmt --check ' + paths,
          cache: true,
          inputs,
        },
        format: {
          command: 'oxfmt --write ' + paths,
          cache: false,
        },
        check: {
          executor: 'nx:noop',
          dependsOn: ['lint', 'format-check'],
          inputs: [
            ...inputs,
            '{workspaceRoot}/.oxlintrc.json',
            '{projectRoot}/.oxlintrc.json',
          ],
        },
      };
      // The root owns scripts and files outside application and package projects.
      if (root === '.') {
        targets.lint = {
          executor: '@nx/oxlint:lint',
          cache: true,
          options: { lintFilePatterns: ['.'], nestedProjectRoots: nested },
          inputs: [
            '{projectRoot}/**/*.{js,cjs,mjs,jsx,ts,cts,mts,tsx,astro}',
            ...nested.map((child) => '!{workspaceRoot}/' + child + '/**/*'),
            '{workspaceRoot}/.oxlintrc.json',
            '{workspaceRoot}/.gitignore',
            { externalDependencies: ['oxlint'] },
          ],
        };
      }
      return [file, { projects: { [root]: { targets } } }];
    });
  },
];
