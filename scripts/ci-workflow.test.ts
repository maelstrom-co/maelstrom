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
    s.run?.includes(`run-many -t ${targets}`),
  );
  if (!step) throw new Error(`Missing run-many -t ${targets} in ${job}`);
  return step;
};

test('no CI step uses task-based nx affected', async () => {
  const workflow = await readCi();
  for (const job of Object.values(workflow.jobs)) {
    for (const step of job.steps) {
      expect(step.run ?? '').not.toMatch(/nx affected/);
    }
  }
});

test.each([
  ['verify', 'check test build typecheck'],
  ['e2e', 'e2e'],
])('%s runs every target for the affected projects and skips when none', async (job, targets) => {
  const workflow = await readCi();
  const select = workflow.jobs[job]!.steps.find(
    (s) => s.name === 'Select projects',
  )!;
  expect(select.run).toContain('nx show projects --affected');
  expect(select.run).toContain('>> "$GITHUB_OUTPUT"');
  expect(select.run).not.toContain('nx-command');
  if (job === 'e2e') expect(select.run).toContain('--withTarget=e2e');

  const step = nxStep(workflow, job, targets);
  expect(step.run).not.toContain('${{');
  expect(step.run).toContain('--projects="$PROJECTS"');
  expect(step.env?.PROJECTS).toBe(`\${{ steps.scope.outputs.projects }}`);
  expect(step.if).toContain(
    job === 'e2e'
      ? "steps.scope.outputs.e2e == 'true'"
      : "steps.scope.outputs.run == 'true'",
  );
});
