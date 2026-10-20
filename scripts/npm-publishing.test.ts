import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';

type Step = {
  name?: string;
  if?: string;
  run?: string;
  env?: Record<string, string>;
};
type Workflow = {
  env?: Record<string, string>;
  jobs: Record<
    string,
    {
      if?: string;
      'runs-on': string;
      environment?: string;
      permissions?: Record<string, string>;
      steps: Step[];
    }
  >;
};

const readWorkflow = async (name: string): Promise<Workflow> =>
  Bun.YAML.parse(
    await Bun.file(`.github/workflows/${name}.yml`).text(),
  ) as Workflow;

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
  expect(enabled({ event_name: 'push' })).toBe(true);
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
      expect(evaluate(ci.jobs.main!['runs-on']!, github)).toBe(
        external ? 'ubuntu-latest' : 'blacksmith-4vcpu-ubuntu-2404',
      );
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
