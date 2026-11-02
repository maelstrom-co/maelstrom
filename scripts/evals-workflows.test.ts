import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface Step {
  name: string;
  uses?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
}
interface Workflow {
  name: string;
  'run-name': string;
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  concurrency?: Record<string, unknown>;
  jobs: Record<string, { if: string; environment?: string; steps: Step[] }>;
}
const read = (name: string): Workflow =>
  Bun.YAML.parse(
    readFileSync(
      resolve(import.meta.dir, '..', '.github/workflows', name),
      'utf8',
    ),
  ) as Workflow;
const expression = (value: string) => ['$', `{{ ${value} }}`].join('');
const workflow = read('evals.yml');
const results = read('evals-result.yml');
const execution = workflow.jobs.evaluate!;
const step = (name: string) => {
  const result = execution.steps.find((item) => item.name === name);
  if (!result) throw new Error(`Missing step ${name}`);
  return result;
};

test('only a same-repo open PR label event can request paid execution, never a manual rerun', () => {
  expect(workflow.on).toEqual({ pull_request_target: { types: ['labeled'] } });
  const evaluate = new Function('github', `return (${execution.if});`);
  for (const run_attempt of [1, 2])
    for (const name of ['run-evals', 'other'])
      for (const state of ['open', 'closed'])
        for (const full_name of ['owner/repo', 'fork/repo']) {
          const github = {
            run_attempt,
            repository: 'owner/repo',
            event: {
              label: { name },
              pull_request: { state, head: { repo: { full_name } } },
            },
          };
          expect(evaluate(github)).toBe(
            run_attempt === 1 &&
              name === 'run-evals' &&
              state === 'open' &&
              full_name === 'owner/repo',
          );
        }
  expect(workflow['run-name']).toContain(
    "github.event.label.name == 'run-evals'",
  );
  expect(workflow['run-name']).toContain(
    "github.event.pull_request.state == 'open'",
  );
  expect(workflow['run-name']).toContain(
    'github.event.pull_request.head.repo.full_name == github.repository',
  );
  expect(workflow['run-name']).toContain('Evals PR #{0} at {1}');
  expect(workflow['run-name']).toContain('Ignored eval request');
});

test('serializes requests without cancellation and gates every PR checkout behind preview approval and exact SHA checks', () => {
  expect(workflow.concurrency).toEqual({
    group: `run-evals-pr-${expression('github.event.pull_request.number')}`,
    'cancel-in-progress': false,
    queue: 'max',
  });
  expect(execution.environment).toBe('preview');
  expect(workflow.permissions).toEqual({
    contents: 'read',
    'pull-requests': 'read',
  });
  const firstCheck = step('Validate approved request before PR checkout');
  const checkout = step('Checkout exact approved source');
  const secondCheck = step(
    'Recheck current SHA immediately before paid execution',
  );
  const run = step('Run planner and six stage evaluations');
  expect(execution.steps.indexOf(firstCheck)).toBeLessThan(
    execution.steps.indexOf(checkout),
  );
  expect(execution.steps.indexOf(secondCheck) + 1).toBe(
    execution.steps.indexOf(run),
  );
  expect(checkout.with?.ref).toBe(
    expression('github.event.pull_request.head.sha'),
  );
  for (const check of [firstCheck, secondCheck]) {
    expect(check.env?.EXPECTED_SHA).toBe(String(checkout.with?.ref));
    expect(check.run).toBe('node trusted/scripts/evals-ci.ts check');
  }
  expect(step('Checkout trusted evaluation controls').with?.ref).toBe(
    expression('github.workflow_sha'),
  );
  expect(
    step('Install without executing source lifecycle scripts').run,
  ).toContain('--ignore-scripts');
  expect(
    step('Install without executing source lifecycle scripts').env,
  ).toBeUndefined();
  expect(run.env).not.toHaveProperty('GH_TOKEN');
  expect(run.env?.OPENAI_API_KEY).toBe(expression('secrets.OPENAI_API_KEY'));
  expect(run.env?.TYPESAFE_API_KEY).toBe(
    expression('secrets.TYPESAFE_API_KEY'),
  );
  expect(run.env?.JEV_MODEL).toContain('vars.JEV_MODEL || secrets.JEV_MODEL');
  expect(step('Validate required configuration').env).toEqual(run.env);
});

test('runs full planner and all six stages, retains completed reports after errors and uploads only Markdown', () => {
  const run = step('Run planner and six stage evaluations').run!;
  expect(run).toContain('packages/evals/src/eval/cli.ts');
  expect(run).toContain(
    'for stage in select actions layout decisions-select decisions-actions decisions-layout',
  );
  expect(run).toContain('packages/evals/src/eval-stages/cli.ts');
  expect(run.match(/--fail-on-runtime-error/g)).toHaveLength(2);
  expect(run.match(/--suite all --repeats 3/g)).toHaveLength(2);
  expect(run.match(/--no-grader/g)).toHaveLength(2);
  expect(run.match(/\|\| status=1/g)).toHaveLength(2);
  expect(run).toContain('exit "$status"');
  const uploads = execution.steps.filter((item) =>
    item.uses?.startsWith('actions/upload-artifact@'),
  );
  expect(uploads).toHaveLength(7);
  for (const upload of uploads) {
    expect(upload.if).toBe('always()');
    expect(upload.with?.path).toMatch(
      /^\$\{\{ runner.temp \}\}\/eval-reports\/[a-z-]+\/report\.md$/,
    );
    expect(upload.with?.name).toMatch(
      /^eval-[a-z-]+-\$\{\{ github.run_id \}\}$/,
    );
  }
});

test('completion publication runs for every conclusion on a fresh trusted runner with no artifact content or provider secrets', () => {
  expect(results.on).toEqual({
    workflow_run: { workflows: ['Run Evals'], types: ['completed'] },
  });
  expect(results.permissions).toEqual({
    contents: 'read',
    actions: 'read',
    'pull-requests': 'write',
  });
  const publish = results.jobs.publish!;
  expect(publish.if).not.toContain('conclusion');
  expect(publish.if).toContain('github.run_attempt == 1');
  expect(publish.if).toContain('github.event.workflow_run.run_attempt == 1');
  expect(publish.if).toContain(
    "github.event.workflow_run.event == 'pull_request_target'",
  );
  expect(publish.if).toContain(
    'github.event.workflow_run.head_repository.full_name == github.repository',
  );
  expect(publish.if).toContain(
    "startsWith(github.event.workflow_run.display_title, 'Evals PR #')",
  );
  expect(publish.steps[0]?.with?.ref).toBe(expression('github.workflow_sha'));
  expect(
    publish.steps.some((item) => item.uses?.includes('download-artifact')),
  ).toBe(false);
  expect(publish.steps.some((item) => item.run?.includes('install'))).toBe(
    false,
  );
  expect(JSON.stringify(publish)).not.toContain('secrets.');
  expect(publish.steps.at(-1)?.run).toBe('node scripts/evals-ci.ts finish');
});

test('all actions are SHA-pinned and no checkout persists credentials', () => {
  for (const config of [workflow, results])
    for (const job of Object.values(config.jobs))
      for (const item of job.steps) {
        if (item.uses) expect(item.uses).toMatch(/@[a-f0-9]{40}$/);
        if (item.uses?.startsWith('actions/checkout@'))
          expect(item.with?.['persist-credentials']).toBe(false);
      }
});
