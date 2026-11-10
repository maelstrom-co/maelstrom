import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';

import { waitForPublishedPackages } from './lib/published-packages.ts';

type Step = {
  name?: string;
  if?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
  'timeout-minutes'?: number;
};
type Workflow = {
  env?: Record<string, string>;
  on?: Record<string, unknown>;
  jobs: Record<
    string,
    {
      if?: string;
      'runs-on': string;
      environment?: string;
      permissions?: Record<string, string>;
      'timeout-minutes'?: number;
      steps: Step[];
    }
  >;
};

const readWorkflow = async (name: string): Promise<Workflow> =>
  Bun.YAML.parse(
    await Bun.file(`.github/workflows/${name}.yml`).text(),
  ) as Workflow;

test.each(['release', 'publish-pr'])(
  '%s saves per-attempt records before waiting for registry visibility',
  async (name) => {
    const publish = (await readWorkflow(name)).jobs.publish!;
    const index = (step: string) =>
      publish.steps.findIndex((value) => value.name === step);
    const find = (step: string) => {
      const result = publish.steps[index(step)];
      if (!result) throw new Error(`Missing ${step}`);
      return result;
    };
    const publication = name === 'release' ? 'Publish' : 'Publish packages';
    const download = find('Download publication records');
    const save = find('Save publication record');
    const command = find(publication);
    expect(index('Download publication records')).toBeLessThan(
      index(publication),
    );
    expect(index(publication)).toBeLessThan(index('Save publication record'));
    expect(index('Save publication record')).toBeLessThan(
      index('Verify packages are live'),
    );
    expect(download.with?.pattern).toBe('npm-publication-records-*');
    expect(download.with?.['digest-mismatch']).toBe('error');
    expect(download.with?.['github-token']).toBeUndefined();
    expect(download.with?.['run-id']).toBeUndefined();
    expect(download.with?.repository).toBeUndefined();
    expect(save.if).toContain('always()');
    expect(save.with?.overwrite).toBe(false);
    expect(save.with?.['retention-days']).toBe(7);
    expect(save.with?.name).toBe(
      'npm-publication-records-' + '$' + '{{ github.run_attempt }}',
    );
    expect(command.run).toContain('--publication-record "$PUBLICATION_RECORD"');
    expect(command.run).toContain('--recovery-records "$RECOVERY_RECORDS"');
    expect(command.run).toContain('--source-commit "$SOURCE_COMMIT"');
    expect(command.env?.RECOVERY_RECORDS).toBe(
      '$' + '{{ runner.temp }}/prior-publication-records',
    );
    expect(command.env?.PUBLICATION_RECORD).toBe(
      '$' +
        '{{ runner.temp }}/current-publication-record/publication-record.json',
    );
    expect(command.env?.SOURCE_COMMIT).toBe(
      name === 'release'
        ? '$' + '{{ needs.prepare.outputs.commit }}'
        : '$' + '{{ github.event.pull_request.head.sha }}',
    );
  },
);

test.each(['release', 'publish-pr'])(
  '%s reserves the full scanning deadline after the maximum setup and upload time',
  async (name) => {
    const publish = (await readWorkflow(name)).jobs.publish!;
    const verificationIndex = publish.steps.findIndex(
      (step) => step.name === 'Verify packages are live',
    );
    expect(verificationIndex).toBeGreaterThanOrEqual(0);
    const stepMinutes = publish.steps.map((step) => {
      const minutes = step['timeout-minutes'];
      expect(
        Number.isInteger(minutes),
        `${step.name} needs a bounded duration`,
      ).toBe(true);
      expect(minutes).toBeGreaterThan(0);
      return minutes!;
    });
    const jobMinutes = publish['timeout-minutes']!;
    expect(Number.isInteger(jobMinutes)).toBe(true);
    expect(jobMinutes).toBeGreaterThanOrEqual(
      stepMinutes.reduce((sum, minutes) => sum + minutes, 0) + 1,
    );

    const beforeVerificationMs =
      stepMinutes
        .slice(0, verificationIndex)
        .reduce((sum, minutes) => sum + minutes, 0) * 60_000;
    let elapsedMs = beforeVerificationMs;
    expect(
      waitForPublishedPackages(
        ['still-scanning'],
        { version: '0.2.0', registry: 'https://registry.npmjs.org' },
        {
          now: () => elapsedMs,
          isPublished: () => false,
          sleep: (milliseconds) => {
            elapsedMs += milliseconds;
            expect(elapsedMs).toBeLessThan(jobMinutes * 60_000);
          },
          log: () => {},
        },
      ),
    ).toEqual(['still-scanning']);
    expect(elapsedMs - beforeVerificationMs).toBeGreaterThanOrEqual(
      30 * 60_000,
    );
    expect(stepMinutes[verificationIndex]! * 60_000).toBeGreaterThanOrEqual(
      elapsedMs - beforeVerificationMs + 60_000,
    );
  },
);

test('a private repository cannot publish npm previews, including maintainer PRs', async () => {
  const workflow = await readWorkflow('publish-pr');
  const enabled = new Function(
    'github',
    `return (${workflow.jobs.prepare!.if});`,
  );
  for (const privateRepository of [true, false]) {
    for (const sameRepository of [true, false]) {
      for (const label of ['publish-preview', 'bug']) {
        expect(
          enabled({
            repository: 'maelstrom-co/maelstrom',
            event: {
              repository: { private: privateRepository },
              pull_request: {
                head: {
                  repo: {
                    full_name: sameRepository
                      ? 'maelstrom-co/maelstrom'
                      : 'fork/maelstrom',
                  },
                },
              },
              label: { name: label },
            },
          }),
        ).toBe(
          !privateRepository && sameRepository && label === 'publish-preview',
        );
      }
    }
  }
});

test('a real release fails closed until the manual repository visibility change', async () => {
  const workflow = await readWorkflow('release');
  const guard = workflow.jobs.prepare!.steps.find(
    (s) => s.name === 'Keep packages private until the repository launch',
  );
  expect(guard?.if).toBe("steps.meta.outputs.dry_run != 'true'");
  expect(guard?.env?.REPOSITORY_PRIVATE).toBe(
    '\u0024' + '{{ github.event.repository.private }}',
  );
  expect(guard?.run).toBeDefined();
  for (const repositoryPrivate of ['true', '', 'false']) {
    const result = spawnSync('bash', ['-c', guard!.run!], {
      env: { PATH: process.env.PATH, REPOSITORY_PRIVATE: repositoryPrivate },
    });
    expect(result.status).toBe(repositoryPrivate === 'false' ? 0 : 1);
  }
});

test('only the protected publisher can request npm identity and it verifies anonymous registry visibility', async () => {
  for (const name of ['release', 'publish-pr']) {
    const workflow = await readWorkflow(name);
    const prepare = workflow.jobs.prepare!;
    const publish = workflow.jobs.publish!;
    expect(prepare.permissions?.['id-token']).toBeUndefined();
    expect(publish['runs-on']).toBe('ubuntu-latest');
    expect(publish.environment).toBe('production');
    expect(publish.permissions?.['id-token']).toBe('write');
    expect(publish.permissions?.packages).toBeUndefined();
    expect(
      publish.steps.some((s) => /bun install|nx .*build/.test(s.run ?? '')),
    ).toBe(false);
    expect(
      publish.steps.find((s) => s.name === 'Verify packages are live')?.env
        ?.NPM_CONFIG_USERCONFIG,
    ).toBe('/dev/null');
  }
});

test('previews and manual recovery cannot attest the event revision as their artifact source', async () => {
  const preview = await readWorkflow('publish-pr');
  expect(
    preview.jobs.publish!.steps.find((step) => step.name === 'Publish packages')
      ?.env?.NPM_CONFIG_PROVENANCE,
  ).toBe('false');

  const release = await readWorkflow('release');
  const expression = release.jobs.publish!.steps.find(
    (step) => step.name === 'Publish',
  )?.env?.NPM_CONFIG_PROVENANCE;
  expect(expression).toBeDefined();
  const enabled = new Function(
    'github',
    `return (${expression!.slice(3, -2)});`,
  );
  expect(enabled({ event_name: 'release' })).toBe(true);
  expect(enabled({ event_name: 'push' })).toBe(false);
  expect(enabled({ event_name: 'workflow_dispatch' })).toBe(false);
});

test('merging preparation cannot deploy public installation claims before npm is ready', async () => {
  const workflow = await readWorkflow('deploy-production');
  const enabled = new Function(
    'github',
    'vars',
    `return (${workflow.jobs.platform!.if});`,
  );
  for (const privateRepository of [true, false]) {
    for (const ready of [undefined, 'false', 'true']) {
      for (const conclusion of ['success', 'failure']) {
        expect(
          enabled(
            {
              event: {
                repository: { private: privateRepository },
                workflow_run: {
                  conclusion,
                  event: 'push',
                  head_branch: 'main',
                },
              },
            },
            { PUBLIC_LAUNCH_READY: ready },
          ),
        ).toBe(
          !privateRepository && ready === 'true' && conclusion === 'success',
        );
      }
    }
  }
});

test('forks use hosted CI without shared caching and cannot run owner operations', async () => {
  const ci = await readWorkflow('ci');
  const evaluate = (expression: string, github: object, vars = {}) =>
    new Function(
      'github',
      'vars',
      `return (${expression.replace(/^\$\{\{|\}\}$/g, '')});`,
    )(github, vars);
  for (const repository of [
    'maelstrom-co/maelstrom',
    'contributor/maelstrom',
  ]) {
    for (const fork of [false, true]) {
      const github = {
        repository,
        event: { pull_request: { head: { repo: { fork } } } },
      };
      const external = repository !== 'maelstrom-co/maelstrom' || fork;
      for (const jobName of ['verify', 'e2e']) {
        expect(evaluate(ci.jobs[jobName]!['runs-on']!, github)).toBe(
          external ? 'ubuntu-latest' : 'blacksmith-4vcpu-ubuntu-2404',
        );
      }
      expect(ci.jobs.main!['runs-on']).toBe('ubuntu-latest');
      expect(evaluate(ci.env!.NX_NO_CLOUD!, github)).toBe(external);
      expect(
        evaluate(ci.env!.NX_NO_CLOUD!, github, { NX_NO_CLOUD: 'true' }),
      ).toBe(true);
    }
  }
  for (const [workflowName, jobName] of [
    ['release', 'prepare'],
    ['reconcile-previews', 'discover'],
    ['deploy-playground', 'deploy'],
  ]) {
    const workflow = await readWorkflow(workflowName!);
    const guard = workflow.jobs[jobName!]!.if!;
    expect(evaluate(guard, { repository: 'maelstrom-co/maelstrom' })).toBe(
      true,
    );
    expect(evaluate(guard, { repository: 'contributor/maelstrom' })).toBe(
      false,
    );
  }
});

test('only publishing a GitHub release starts automatic npm publication', async () => {
  const workflow = await readWorkflow('release');
  expect(workflow.on?.release).toEqual({ types: ['published'] });
  expect(workflow.on?.push).toBeUndefined();
  const guard = workflow.jobs.prepare!.steps.find(
    (s) => s.name === 'Assert the release commit is on main',
  );
  const enabled = new Function('github', 'inputs', `return (${guard!.if});`);
  expect(enabled({ event_name: 'release' }, {})).toBe(true);
  expect(enabled({ event_name: 'workflow_dispatch' }, { tag: 'v1.0.0' })).toBe(
    true,
  );
  expect(enabled({ event_name: 'workflow_dispatch' }, { tag: '' })).toBe(false);
});
