import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type Step = {
  name?: string;
  id?: string;
  'working-directory'?: string;
  if?: string;
  run?: string;
  env?: Record<string, string>;
};
type Workflow = { jobs: Record<string, { steps: Step[] }> };

const readCi = async (): Promise<Workflow> =>
  Bun.YAML.parse(await Bun.file('.github/workflows/ci.yml').text()) as Workflow;

const nxStep = (workflow: Workflow, job: string, targets: string): Step => {
  const step = workflow.jobs[job]!.steps.find((s) =>
    s.run?.includes(`-t ${targets}`),
  );
  if (!step) throw new Error(`Missing nx -t ${targets} in ${job}`);
  return step;
};

test.each([
  ['verify', 'lint test build typecheck sdk-validation links-check'],
  ['e2e', 'e2e'],
])(
  '%s uses task-based affected on PRs and run-many on push',
  async (job, targets) => {
    const workflow = await readCi();
    const step = nxStep(workflow, job, targets);
    expect(step.run).toContain(`bunx nx affected -t ${targets}`);
    expect(step.run).toContain(`bunx nx run-many -t ${targets}`);
    expect(step.run).not.toContain('${{');
    expect(step.run).not.toContain('--projects');
    expect(step.env?.EVENT_NAME).toBe(`\${{ github.event_name }}`);
  },
);

test('no step plumbs a project list into nx', async () => {
  const workflow = await readCi();
  for (const job of Object.values(workflow.jobs)) {
    for (const step of job.steps) {
      expect(step.run ?? '').not.toContain('$PROJECTS');
      expect(step.env?.PROJECTS).toBeUndefined();
    }
  }
});

test('formatting drift fails verification without rewriting the checkout', async () => {
  const workflow = await readCi();
  const steps = Object.values(workflow.jobs).flatMap((job) => job.steps);
  const formatSteps = steps.filter((step) => step.run?.includes('nx format:'));
  expect(formatSteps).toHaveLength(1);
  expect(formatSteps[0]?.run).toBe('bunx nx format:check --all');
  expect(workflow.jobs.verify!.steps).toContain(formatSteps[0]);
});

test('the dead-link check runs as a docs nx target, not a separate step', async () => {
  const workflow = await readCi();
  for (const step of workflow.jobs.verify!.steps) {
    expect(step.run ?? '').not.toContain('assert-docs-links.ts');
    expect(step.if ?? '').not.toContain('apps/docs/dist');
  }
  const docs = JSON.parse(await Bun.file('apps/docs/package.json').text());
  const target = docs.nx.targets['links-check'];
  expect(target.dependsOn).toContain('build');
  expect(target.inputs).toContain(
    '{workspaceRoot}/scripts/assert-docs-links.ts',
  );
  expect(target.inputs).toContain('{workspaceRoot}/scripts/lib/docs-links.ts');
});

test('the starter consumer check in e2e stays gated on docs', async () => {
  const workflow = await readCi();
  const step = workflow.jobs.e2e!.steps.find((s) =>
    s.run?.includes('verify-starter-consumer.ts'),
  )!;
  expect(step.if).toContain("steps.scope.outputs.docs == 'true'");
});

test.each([
  ['pull_request', ['@maelstrom-co/docs'], true],
  ['pull_request', ['@maelstrom-co/agui-workspace-poc'], true],
  ['pull_request', ['@maelstrom-co/protocol'], false],
  ['pull_request', [], false],
  ['push', [], true],
])(
  'verify selects browser installation for %s with affected projects %j',
  async (event, affected, expected) => {
    const workflow = await readCi();
    const need = workflow.jobs.verify!.steps.find(
      (step) => step.id === 'browser-need',
    )!;
    const directory = await mkdtemp(join(tmpdir(), 'maelstrom-ci-workflow-'));
    const output = join(directory, 'github-output');
    try {
      const result = Bun.spawnSync(
        [
          'bash',
          '-euo',
          'pipefail',
          '-c',
          `
          bunx() {
            bun -e '
              const args = process.argv.slice(1);
              if (args.slice(0, 4).join(" ") !== "nx show projects --affected") process.exit(1);
              const filter = args.find(arg => arg.startsWith("--projects="))?.slice(11).split(",");
              const affected = JSON.parse(process.env.AFFECTED_PROJECTS);
              console.log(JSON.stringify(affected.filter(project => !filter || filter.includes(project))));
            ' "$@"
          }
          ${need.run}
        `,
        ],
        {
          env: {
            ...process.env,
            EVENT_NAME: event,
            AFFECTED_PROJECTS: JSON.stringify(affected),
            GITHUB_OUTPUT: output,
          },
        },
      );
      expect(result.stderr.toString()).toBe('');
      expect(result.exitCode).toBe(0);
      expect((await Bun.file(output).text()).trim()).toBe(
        `browser=${expected}`,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test('verify installs Playwright before browser-backed unit tests run in nx', async () => {
  const workflow = await readCi();
  const steps = workflow.jobs.verify!.steps;
  const need = steps.find((s) => s.id === 'browser-need')!;
  expect(need.run).toContain('--projects=@maelstrom-co/docs');
  expect(need.run).not.toContain('${{');
  expect(need.env?.EVENT_NAME).toBe(`\${{ github.event_name }}`);

  const install = steps.find((s) => s.run?.includes('playwright install'))!;
  expect(install.if).toContain("steps.browser-need.outputs.browser == 'true'");
  const e2eInstall = workflow.jobs.e2e!.steps.find((s) =>
    s.run?.includes('playwright install'),
  )!;
  expect(install.run).toBe(e2eInstall.run);
  expect(install['working-directory']).toBe(e2eInstall['working-directory']);

  const nxIndex = steps.indexOf(
    nxStep(
      workflow,
      'verify',
      'lint test build typecheck sdk-validation links-check',
    ),
  );
  expect(steps.indexOf(need)).toBeLessThan(steps.indexOf(install));
  expect(steps.indexOf(install)).toBeLessThan(nxIndex);
});

test('pull requests audit dependencies only when they change a manifest or the lockfile', async () => {
  const workflow = await readCi();
  const steps = workflow.jobs.verify!.steps;
  const detect = steps.find((step) => step.id === 'dependency-changes');
  const audit = steps.find((step) => step.run === 'bun audit');
  expect(detect?.if).toBe(`github.event_name == 'pull_request'`);
  expect(audit?.if).toBe(
    `github.event_name != 'pull_request' || steps.dependency-changes.outputs.changed == 'true'`,
  );

  const pattern = detect?.run?.match(/grep -Eq '([^']+)'/)?.[1];
  if (!pattern) throw new Error('Missing dependency path pattern');
  const matches = (path: string) => new RegExp(pattern).test(path);
  expect(matches('bun.lock')).toBe(true);
  expect(matches('package.json')).toBe(true);
  expect(matches('apps/www/package.json')).toBe(true);
  expect(matches('packages/client/src/index.ts')).toBe(false);
  expect(matches('docs/package.json.md')).toBe(false);
});
