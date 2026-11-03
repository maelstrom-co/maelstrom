import { expect, test } from 'bun:test';

type Step = {
  name?: string;
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
  ['verify', 'check test build typecheck check-links'],
  ['e2e', 'e2e'],
])('%s uses task-based affected on PRs and run-many on push', async (job, targets) => {
  const workflow = await readCi();
  const step = nxStep(workflow, job, targets);
  expect(step.run).toContain(`bunx nx affected -t ${targets}`);
  expect(step.run).toContain(`bunx nx run-many -t ${targets}`);
  expect(step.run).not.toContain('${{');
  expect(step.run).not.toContain('--projects');
  expect(step.env?.EVENT_NAME).toBe(`\${{ github.event_name }}`);
});

test('no step plumbs a project list into nx', async () => {
  const workflow = await readCi();
  for (const job of Object.values(workflow.jobs)) {
    for (const step of job.steps) {
      expect(step.run ?? '').not.toContain('$PROJECTS');
      expect(step.env?.PROJECTS).toBeUndefined();
    }
  }
});

test('the dead-link check runs as a docs nx target, not a separate step', async () => {
  const workflow = await readCi();
  for (const step of workflow.jobs.verify!.steps) {
    expect(step.run ?? '').not.toContain('assert-docs-links.ts');
    expect(step.if ?? '').not.toContain('apps/docs/dist');
  }
  const docs = JSON.parse(await Bun.file('apps/docs/package.json').text());
  const target = docs.nx.targets['check-links'];
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
