import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

import ts from 'typescript';

const root = resolve(import.meta.dir, '..');
const read = (name: string) =>
  readFileSync(resolve(root, '.github/workflows', name), 'utf8');
const expression = (value: string) => ['$', `{{ ${value} }}`].join('');
const localRuntimeFiles = (
  entry: string,
  seen = new Set<string>(),
): string[] => {
  const path = resolve(root, entry);
  if (seen.has(path)) return [];
  seen.add(path);
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const dependencies = source.statements.flatMap((statement) => {
    if (
      !ts.isImportDeclaration(statement) ||
      statement.importClause?.isTypeOnly ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.moduleSpecifier.text.startsWith('.')
    )
      return [];
    return localRuntimeFiles(
      relative(root, resolve(dirname(path), statement.moduleSpecifier.text)),
      seen,
    );
  });
  return [relative(root, path), ...dependencies];
};

const approvalNoticeLookup =
  'select(.user.login == "github-actions[bot]" and (.body | startswith("<!-- preview-approval-request -->")))';
const step = (workflow: string, name: string) => {
  const start = workflow.indexOf(`- name: ${name}`);
  if (start < 0) throw new Error(`Missing step ${name}`);
  const next = workflow.indexOf('\n      - name:', start + 1);
  return workflow.slice(start, next < 0 ? undefined : next);
};

describe('preview workflows', () => {
  test('manual voice benchmark dispatch is restricted to the default branch and an exact PR number', () => {
    const workflow = read('deploy-preview.yml');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('pr_number:');
    const job = workflow.slice(workflow.indexOf('  voice-benchmark:'));
    expect(job).toContain("github.event_name == 'workflow_dispatch'");
    expect(job).toContain(
      "github.ref == format('refs/heads/{0}', github.event.repository.default_branch)",
    );
    expect(job).toContain('inputs.pr_number !=');
    expect(job).toContain(
      'github.event.pull_request.number || inputs.pr_number',
    );
    expect(job).toContain("github.event.pull_request.head.sha || ''");
    expect(job).toContain('PREVIEW_WORKERS_DEV_SUFFIX:');
  });

  test('fresh paid dispatches are opt-in and each inherited rerun is explicitly authorized', () => {
    const workflow = Bun.YAML.parse(read('deploy-preview.yml')) as {
      on: { workflow_dispatch: { inputs: Record<string, unknown> } };
      jobs: {
        'voice-benchmark': {
          env: Record<string, string>;
          steps: { name: string; env?: Record<string, string> }[];
        };
      };
    };
    expect(workflow.on.workflow_dispatch.inputs.new_benchmark_request).toEqual({
      description:
        'Allow a fresh paid benchmark on this dispatch and each rerun',
      required: false,
      type: 'boolean',
      default: false,
    });
    const job = workflow.jobs['voice-benchmark'];
    const runner = job.steps.find(
      (step) =>
        step.name === 'Run approved preview benchmarks and update p95 comment',
    )!;
    const authorization = runner.env!.VOICE_BENCHMARK_NEW_REQUEST!;
    const evaluate = new Function(
      'github',
      'inputs',
      `return (${authorization.slice(3, -2)});`,
    );
    for (const event_name of ['workflow_dispatch', 'pull_request_target'])
      for (const new_benchmark_request of [undefined, false, true])
        expect(evaluate({ event_name }, { new_benchmark_request })).toBe(
          event_name === 'workflow_dispatch' && new_benchmark_request
            ? 'true'
            : 'false',
        );
    expect(job.env.MAELSTROM_VOICE_CI_RUN_ID).toContain(
      expression('github.run_attempt'),
    );
    // The runner reads GitHub's native identities; inputs cannot override them.
    expect(runner.env).not.toHaveProperty('GITHUB_RUN_ID');
    expect(runner.env).not.toHaveProperty('GITHUB_RUN_ATTEMPT');
  });

  test('voice benchmarking requests approval only for a live label request without cancelling lifecycle mutations', () => {
    const workflow = read('deploy-preview.yml');
    const gate = workflow.slice(
      workflow.indexOf('\n  benchmark-gate:'),
      workflow.indexOf('\n  voice-benchmark:'),
    );
    const job = workflow.slice(workflow.indexOf('\n  voice-benchmark:'));
    expect(gate).toContain('needs: deploy');
    expect(job).toContain('needs: [deploy, benchmark-gate]');
    expect(workflow).toContain('types: [labeled, unlabeled]');
    for (const routed of [gate, job]) {
      expect(routed).toContain("needs.deploy.result == 'success'");
      expect(routed).toContain("github.event.action == 'labeled'");
      expect(routed).toContain("github.event.action == 'unlabeled'");
      expect(routed).toContain("github.event.label.name == 'bench-voice'");
      expect(routed).toContain("github.event.label.name == 'deploy-preview'");
      expect(routed).not.toContain(
        'contains(github.event.pull_request.labels.*.name',
      );
      expect(routed).toContain(
        'github.event.pull_request.head.repo.full_name == github.repository',
      );
    }
    expect(job).toContain(
      `group: deploy-preview-pr-${expression('github.event.pull_request.number || inputs.pr_number')}`,
    );
    expect(job).toContain('cancel-in-progress: false');
    expect(job).toContain('queue: max');
    expect(job).toContain(`ref: ${expression('github.workflow_sha')}`);
    expect(job).not.toContain('path: source');
    expect(job).not.toContain('bun install');
    expect(job).not.toContain('secrets.CLOUDFLARE');
    expect(job).not.toContain('publish-preview');
    expect(job).not.toContain('upload-artifact');
    expect(job).not.toContain('continue-on-error');
    const runner = step(
      workflow,
      'Run approved preview benchmarks and update p95 comment',
    );
    expect(runner).toContain('secrets.MAELSTROM_E2E_OPENAI_API_KEY');
    expect(runner).toContain('secrets.ELEVENLABS_API_KEY');
    expect(runner).toContain('scripts/voice-benchmark-ci.ts');
    expect(step(workflow, 'Remove owned voice containers')).toContain(
      'if: always()',
    );
    expect(
      workflow.slice(
        workflow.indexOf('  approve:'),
        workflow.indexOf('  deploy:'),
      ),
    ).not.toContain('bench-voice');
  });

  test('the benchmark gate reads live labels outside the approval environment and per-PR queue', () => {
    const source = read('deploy-preview.yml');
    const workflow = Bun.YAML.parse(source) as {
      jobs: Record<
        string,
        {
          if: string;
          environment?: unknown;
          concurrency?: unknown;
          permissions?: Record<string, string>;
          outputs?: Record<string, string>;
          steps: {
            uses?: string;
            run?: string;
            env?: Record<string, string>;
          }[];
        }
      >;
    };
    const gate = workflow.jobs['benchmark-gate']!;
    expect(gate.environment).toBeUndefined();
    expect(gate.concurrency).toBeUndefined();
    expect(gate.permissions).toEqual({ 'pull-requests': 'read' });
    expect(gate.steps.some((entry) => entry.uses !== undefined)).toBe(false);
    const script = gate.steps.map((entry) => entry.run ?? '').join('\n');
    expect(script).toContain(
      'gh api --paginate "repos/$GH_REPO/issues/$PR_NUMBER/labels"',
    );
    expect(script).toContain('grep -Fxq deploy-preview');
    expect(script).toContain('grep -Fxq bench-voice');
    expect(script).not.toContain(['$', '{{'].join(''));
    expect(gate.steps[0]!.env!.PR_NUMBER).toBe(
      expression('github.event.pull_request.number || inputs.pr_number'),
    );
    expect(gate.outputs!.requested).toBe(
      expression('steps.labels.outputs.requested'),
    );
    expect(workflow.jobs['voice-benchmark']!.if).toContain(
      "&& needs.benchmark-gate.outputs.requested == 'true'",
    );
  });

  test.each(['benchmark-gate', 'voice-benchmark'])(
    '%s label routing admits removals without admitting unrelated or untrusted events',
    (name) => {
      const workflow = Bun.YAML.parse(read('deploy-preview.yml')) as {
        on: { pull_request_target: { types: string[] } };
        jobs: Record<string, { if: string }>;
      };
      expect(workflow.on.pull_request_target.types).toEqual([
        'labeled',
        'unlabeled',
      ]);
      const evaluate = new Function(
        'github',
        'needs',
        'inputs',
        'always',
        'cancelled',
        'format',
        `return (${workflow.jobs[name]!.if.replaceAll('needs.benchmark-gate.', "needs['benchmark-gate'].")});`,
      );
      const needs = (requested: string) => ({
        deploy: { result: 'skipped' },
        'benchmark-gate': { outputs: { requested } },
      });
      const permits = (
        action: string,
        label: string,
        overrides: Record<string, unknown> = {},
        cancelled = false,
        requested = 'true',
      ) =>
        evaluate(
          {
            event_name: 'pull_request_target',
            repository: 'maelstrom-co/maelstrom',
            event: {
              sender: { type: 'User' },
              action,
              label: { name: label },
              pull_request: {
                state: 'open',
                head: { repo: { full_name: 'maelstrom-co/maelstrom' } },
              },
              ...overrides,
            },
          },
          needs(requested),
          {},
          () => true,
          () => cancelled,
          () => '',
        );
      for (const action of ['labeled', 'unlabeled']) {
        for (const label of ['deploy-preview', 'bench-voice']) {
          expect(permits(action, label)).toBe(true);
          for (const requested of ['false', ''])
            expect(permits(action, label, {}, false, requested)).toBe(
              name === 'benchmark-gate',
            );
          expect(permits(action, label, { sender: { type: 'Bot' } })).toBe(
            false,
          );
          for (const [state, repository] of [
            ['closed', 'maelstrom-co/maelstrom'],
            ['open', 'outsider/fork'],
          ])
            expect(
              permits(action, label, {
                pull_request: {
                  state,
                  head: { repo: { full_name: repository } },
                },
              }),
            ).toBe(false);
          expect(permits(action, label, {}, true)).toBe(false);
        }
      }
      expect(permits('labeled', 'unrelated')).toBe(false);
      expect(permits('unlabeled', 'unrelated')).toBe(false);
      expect(permits('synchronize', 'bench-voice')).toBe(false);
      expect(
        evaluate(
          { event_name: 'workflow_run', event: {} },
          {
            deploy: { result: 'success' },
            'benchmark-gate': { outputs: { requested: 'true' } },
          },
          {},
          () => true,
          () => false,
          () => '',
        ),
      ).toBe(false);
    },
  );

  test('deploy records approval before the shared queue and isolates PR builds from credentials', () => {
    const workflow = read('deploy-preview.yml');
    expect(workflow).toContain('pull_request_target:');
    expect(workflow).toContain('types: [labeled, unlabeled]');
    expect(workflow).toContain("github.event.sender.type == 'User'");
    expect(workflow).toContain("github.event.action == 'labeled'");
    expect(workflow).toContain("github.event.label.name == 'deploy-preview'");
    expect(workflow).toContain("github.event.pull_request.state == 'open'");
    expect(workflow).toContain(
      'github.event.pull_request.head.repo.full_name == github.repository',
    );
    expect(workflow).toContain('scripts/preview-lifecycle.ts approve');
    expect(workflow.indexOf('  approve:')).toBeLessThan(
      workflow.indexOf('  deploy:'),
    );
    expect(
      workflow.slice(
        workflow.indexOf('  approve:'),
        workflow.indexOf('  deploy:'),
      ),
    ).not.toContain('concurrency:');
    expect(workflow).toContain(
      `group: deploy-preview-pr-${expression('needs.approve.outputs.pr-number')}`,
    );
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).toContain('queue: max');
    expect(workflow).toContain(`ref: ${expression('github.workflow_sha')}`);
    expect(workflow).toContain('path: source');
    expect(workflow).toContain(
      `ref: ${expression('needs.approve.outputs.head-sha')}`,
    );
    for (const name of [
      'Install source dependencies',
      'Build independent preview artifacts',
      'Build website preview',
    ]) {
      expect(step(workflow, name)).not.toMatch(
        /CLOUDFLARE_(?:API_TOKEN|ACCOUNT_ID)|GH_TOKEN|ALCHEMY_PROFILE/,
      );
    }
  });

  test('successful CI selects a live maintainer revision through trusted code before checkout', () => {
    const workflow = Bun.YAML.parse(read('deploy-preview.yml')) as {
      on: { workflow_run: { workflows: string[]; types: string[] } };
      permissions: Record<string, string>;
      jobs: Record<
        string,
        {
          if: string;
          environment?: string;
          outputs?: Record<string, string>;
          concurrency?: { group: string };
          steps: {
            name: string;
            if?: string;
            env?: Record<string, string>;
            with?: Record<string, unknown>;
            run?: string;
          }[];
        }
      >;
    };
    expect(workflow.on.workflow_run).toEqual({
      workflows: ['CI'],
      types: ['completed'],
    });
    expect(workflow.permissions.actions).toBe('read');
    const approval = workflow.jobs.approve!;
    const automatic = approval.steps.find(
      (entry) =>
        entry.name ===
        'Approve current maintainer revision after successful CI',
    )!;
    expect(automatic.if).toBe("github.event_name == 'workflow_run'");
    expect(automatic.env?.CI_RUN_ID).toBe(
      expression('github.event.workflow_run.id'),
    );
    expect(automatic.run).toContain('preview-lifecycle.ts approve-ci');
    expect(approval.steps[0]?.with?.ref).toBe(
      expression('github.workflow_sha'),
    );
    expect(JSON.stringify(approval)).not.toContain('secrets.');
    expect(approval.if).toContain(
      "github.ref == format('refs/heads/{0}', github.event.repository.default_branch)",
    );
    const deploy = workflow.jobs.deploy!;
    expect(deploy.environment).toBe(
      expression(
        "github.event_name == 'workflow_run' && 'preview-auto' || 'preview'",
      ),
    );
    expect(
      read('deploy-preview.yml').slice(
        read('deploy-preview.yml').indexOf('  voice-benchmark:'),
      ),
    ).toContain('environment: preview');
    expect(deploy.if).toContain("needs.approve.outputs.pr-number != ''");
    expect(deploy.concurrency?.group).toContain(
      'needs.approve.outputs.pr-number',
    );
    expect(
      deploy.steps.find((entry) => entry.name === 'Checkout approved source')
        ?.with?.ref,
    ).toBe(expression('needs.approve.outputs.head-sha'));
    for (const name of ['Deploy demo preview', 'Deploy remaining previews']) {
      const mutation = deploy.steps.find((entry) => entry.name === name)!;
      expect(mutation.env?.APPROVED_SHA).toBe(
        expression('needs.approve.outputs.head-sha'),
      );
      expect(mutation.env?.CI_RUN_ID).toBe(
        expression("github.event.workflow_run.id || ''"),
      );
      expect(mutation.env?.PR_NUMBER).toBe(
        expression('needs.approve.outputs.pr-number'),
      );
      expect(mutation.run).toContain('scripts/preview-trust.ts');
    }
  });

  test('deploy keeps app ordering and delegates every mutation to the lifecycle CLI', () => {
    const workflow = read('deploy-preview.yml');
    const commands = [
      'Build independent preview artifacts',
      'Deploy demo preview',
      'Build website preview',
      'Deploy remaining previews',
    ];
    for (let index = 1; index < commands.length; index += 1) {
      expect(workflow.indexOf(commands[index - 1]!)).toBeLessThan(
        workflow.indexOf(commands[index]!),
      );
    }
    expect(workflow.match(/preview-lifecycle\.ts deploy-app/g)).toHaveLength(1);
    expect(
      workflow.match(/preview-lifecycle\.ts finish-deployment/g),
    ).toHaveLength(1);
    expect(workflow).not.toMatch(
      /alchemy (?:deploy|destroy)|bun scripts\/delete-preview-workers\.ts|PREVIEW_WORKER_SCOPE: (?:all|current)/,
    );
  });

  test('every credentialed preview mutation asserts the expected account', () => {
    const expected = [
      'EXPECTED_CLOUDFLARE_ACCOUNT_ID:',
      expression('vars.PREVIEW_ACCOUNT_ID'),
    ].join(' ');
    for (const name of ['Deploy demo preview', 'Deploy remaining previews']) {
      expect(step(read('deploy-preview.yml'), name)).toContain(expected);
    }
    expect(
      step(read('teardown-preview.yml'), 'Reconcile known preview resources'),
    ).toContain(expected);
    expect(
      step(read('reconcile-previews.yml'), 'Reconcile known preview resources'),
    ).toContain(expected);
    // The guard itself must stay in the stage guards so every stack
    // composition root inherits it.
    expect(
      readFileSync(resolve(root, 'infra/platform/src/Stage.ts'), 'utf8'),
    ).toContain('EXPECTED_CLOUDFLARE_ACCOUNT_ID');
  });

  test('deploy checks trusted configuration before installing or building source', () => {
    const workflow = read('deploy-preview.yml');
    const name = 'Assert required preview configuration';
    const preflight = step(workflow, name);
    for (const [key, context] of [
      ['PRODUCTION_ACCOUNT_ID', 'vars'],
      ['PREVIEW_ACCOUNT_ID', 'vars'],
      ['CLOUDFLARE_PREVIEW_WORKERS_DEV_SUFFIX', 'vars'],
      ['CLOUDFLARE_PREVIEW_ACCOUNT_ID', 'secrets'],
      ['CLOUDFLARE_PREVIEW_API_TOKEN', 'secrets'],
    ]) {
      expect(preflight).toContain(`${key}: ${expression(`${context}.${key}`)}`);
    }
    expect(preflight).toContain(
      `BUN_EXECUTABLE: ${expression('steps.trusted-bun.outputs.path')}`,
    );
    expect(preflight).toContain("BUN_OPTIONS: ''");
    expect(preflight).toContain("NODE_OPTIONS: ''");
    expect(preflight).toContain(
      '"$BUN_EXECUTABLE" --config=scripts/preview-lifecycle.bunfig.toml --no-env-file --no-install scripts/preview-preflight.ts',
    );
    expect(preflight).not.toContain('working-directory:');
    expect(workflow).toContain('environment: preview');
    expect(workflow.indexOf('Capture trusted Bun executable')).toBeLessThan(
      workflow.indexOf(name),
    );
    for (const next of [
      'Install source dependencies',
      'Build independent preview artifacts',
      'Deploy demo preview',
    ]) {
      expect(workflow.indexOf(name)).toBeLessThan(workflow.indexOf(next));
    }
  });

  test('teardown workflows reject equal production and preview variables', () => {
    const guardName = 'name: Assert distinct account variables';
    const comparison = 'test "$PRODUCTION_ACCOUNT_ID" != "$PREVIEW_ACCOUNT_ID"';
    for (const workflow of [
      read('teardown-preview.yml'),
      read('reconcile-previews.yml'),
    ]) {
      expect(workflow).toContain(guardName);
      expect(workflow).toContain(comparison);
      // The check must run before any credentialed step.
      expect(workflow.indexOf(guardName)).toBeLessThan(
        workflow.indexOf('CLOUDFLARE_ACCOUNT_ID: ${{ secrets.'),
      );
    }
  });

  test('credentialed deploys verify every local runtime import after untrusted builds', () => {
    const workflow = read('deploy-preview.yml');
    const runtimeFiles = [
      ...localRuntimeFiles('scripts/preview-lifecycle.ts'),
      'scripts/preview-lifecycle.bunfig.toml',
    ];
    for (const [name, command] of [
      ['Deploy demo preview', 'deploy-app demo'],
      ['Deploy remaining previews', 'finish-deployment'],
    ] as const) {
      const mutation = step(workflow, name);
      expect(mutation).toContain(
        `TRUSTED_WORKFLOW_SHA: ${expression('github.workflow_sha')}`,
      );
      expect(mutation).toContain(
        `BUN_EXECUTABLE: ${expression('steps.trusted-bun.outputs.path')}`,
      );
      expect(mutation).toContain(
        'test "$(/usr/bin/git --no-replace-objects rev-parse HEAD)" = "$TRUSTED_WORKFLOW_SHA"',
      );
      expect(mutation).toContain('/usr/bin/git hash-object "$runtime_file"');
      for (const runtimeFile of runtimeFiles) {
        expect(mutation).toContain(runtimeFile);
      }
      expect(mutation.indexOf('/usr/bin/git hash-object')).toBeLessThan(
        mutation.indexOf(`scripts/preview-lifecycle.ts ${command}`),
      );
    }
    const capture = step(workflow, 'Capture trusted Bun executable');
    expect(capture).toContain('id: trusted-bun');
    expect(capture).toContain('command -v bun');
    expect(capture).toContain('path=%s');
    expect(workflow.indexOf('Capture trusted Bun executable')).toBeLessThan(
      workflow.indexOf('Install source dependencies'),
    );
    expect(
      workflow.indexOf('Build independent preview artifacts'),
    ).toBeLessThan(workflow.indexOf('Deploy demo preview'));
    expect(workflow.indexOf('Build website preview')).toBeLessThan(
      workflow.indexOf('Deploy remaining previews'),
    );
  });

  test('credentialed deploy shells neutralize persisted startup injection', () => {
    const workflow = read('deploy-preview.yml');
    for (const name of ['Deploy demo preview', 'Deploy remaining previews']) {
      const mutation = step(workflow, name);
      expect(mutation).toContain('BASH_ENV: /dev/null');
      expect(mutation).toContain('ENV: /dev/null');
      expect(mutation).toContain("LD_PRELOAD: ''");
      expect(mutation).toContain("BUN_OPTIONS: ''");
      expect(mutation).toContain("NODE_OPTIONS: ''");
      expect(mutation).toContain(
        `BUN_EXECUTABLE: ${expression('steps.trusted-bun.outputs.path')}`,
      );
      expect(mutation).toContain(
        `TRUSTED_BUN_SHA256: ${expression('steps.trusted-bun.outputs.sha256')}`,
      );
      expect(mutation).toContain('/usr/bin/sha256sum "$BUN_EXECUTABLE"');
      expect(mutation).toContain('scripts/preview-lifecycle.bunfig.toml');
      expect(mutation).toContain(
        '--config=scripts/preview-lifecycle.bunfig.toml',
      );
      expect(mutation).toContain('--no-env-file');
      expect(mutation).toContain('--no-install');
      expect(mutation).toContain('/usr/bin/git hash-object');
    }
    const capture = step(workflow, 'Capture trusted Bun executable');
    expect(capture).toContain('/usr/bin/sha256sum "$bun_executable"');
    expect(capture).toContain("printf 'sha256=%s\\n'");
  });

  test('invalidation is synchronize-only and passes the event edge through the shared queue', () => {
    const workflow = read('invalidate-preview-approval.yml');
    expect(workflow).toContain('pull_request_target:');
    expect(workflow).toContain('types: [synchronize]');
    expect(workflow).toContain('github.event.before');
    expect(workflow).toContain('github.event.after');
    expect(workflow).toContain('scripts/preview-lifecycle.ts invalidate');
    expect(workflow).toContain(`ref: ${expression('github.workflow_sha')}`);
    expect(workflow).toContain(
      `group: deploy-preview-pr-${expression('github.event.pull_request.number')}`,
    );
  });

  test.each([
    ['teardown-preview.yml', 'teardown'],
    ['reconcile-previews.yml', 'discover'],
    ['reconcile-previews.yml', 'reconcile'],
  ])(
    '%s %s uses the ungated environment so cleanup cannot wait for approval',
    (file, job) => {
      const workflow = Bun.YAML.parse(read(file)) as {
        jobs: Record<string, { environment: string }>;
      };
      expect(workflow.jobs[job]!.environment).toBe('preview-auto');
    },
  );

  test('event teardown is trusted, manually default-branch guarded, and one lifecycle command', () => {
    const workflow = read('teardown-preview.yml');
    expect(workflow).toContain('types: [unlabeled, closed]');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toContain('schedule:');
    const fullRefGuard =
      "github.ref == format('refs/heads/{0}', github.event.repository.default_branch)";
    expect(workflow).toContain(fullRefGuard);
    expect(workflow).not.toContain('github.ref_name');
    expect('refs/tags/main').not.toBe('refs/heads/main');
    expect(workflow.indexOf(fullRefGuard)).toBeLessThan(
      workflow.indexOf(`ref: ${expression('github.workflow_sha')}`),
    );
    expect(workflow).toContain(`ref: ${expression('github.workflow_sha')}`);
    expect(
      workflow.match(/scripts\/preview-lifecycle\.ts teardown/g),
    ).toHaveLength(1);
    expect(workflow).not.toMatch(
      /alchemy destroy|delete-preview-workers\.ts|peter-evans/,
    );
  });

  test('schedule discovery feeds a non-fail-fast per-PR teardown matrix', () => {
    const workflow = read('reconcile-previews.yml');
    expect(workflow).toContain('schedule:');
    expect(workflow).not.toContain('pull_request_target:');
    expect(workflow).toContain('scripts/preview-lifecycle.ts discover');
    expect(workflow).toContain('fromJSON(needs.discover.outputs.pr-numbers)');
    expect(workflow).toContain('fail-fast: false');
    expect(workflow).toContain(`ref: ${expression('github.workflow_sha')}`);
    expect(workflow).toContain(
      `group: deploy-preview-pr-${expression('matrix.pr-number')}`,
    );
    expect(workflow).toContain('PREVIEW_TRIGGER: schedule');
  });

  test.each([
    ['invalidate-preview-approval.yml', 'cancel-superseded', true],
    ['teardown-preview.yml', 'cancel-waiting', false],
  ])(
    '%s %s cancels waiting deploy runs without checking out source',
    (file, name, keepsCurrentHead) => {
      const workflow = Bun.YAML.parse(read(file)) as {
        jobs: Record<
          string,
          {
            if: string;
            environment?: string;
            permissions: Record<string, string>;
            steps: { uses?: string; run?: string }[];
          }
        >;
      };
      const job = workflow.jobs[name]!;
      expect(job.permissions).toEqual({
        actions: 'write',
        'pull-requests': 'write',
      });
      expect(job.environment).toBeUndefined();
      expect(job.if).toContain(
        'github.event.pull_request.head.repo.full_name == github.repository',
      );
      expect(job.steps.some((step) => step.uses !== undefined)).toBe(false);
      const script = job.steps.map((step) => step.run ?? '').join('\n');
      expect(script).toContain('--workflow deploy-preview.yml');
      expect(script).toContain('--event pull_request_target');
      expect(script).toContain('--status waiting');
      expect(script).toContain('--branch "$HEAD_REF"');
      expect(script.includes('select(.headSha != $head)')).toBe(
        keepsCurrentHead,
      );
      expect(script.indexOf('gh run cancel')).toBeLessThan(
        script.indexOf('--method DELETE'),
      );
      expect(script).toContain(approvalNoticeLookup);
      expect(script).toContain(
        'xargs -r -I{} gh api --method DELETE "repos/$GH_REPO/issues/comments/{}"',
      );
      expect(script.includes('contains($head) | not')).toBe(keepsCurrentHead);
      expect(script).not.toContain(['$', '{{'].join(''));
    },
  );

  test('teardown cancels pending approvals on close or deploy label removal only', () => {
    const workflow = Bun.YAML.parse(read('teardown-preview.yml')) as {
      jobs: Record<string, { if: string }>;
    };
    const evaluate = new Function(
      'github',
      `return (${workflow.jobs['cancel-waiting']!.if});`,
    );
    const permits = (
      action: string,
      label?: string,
      repository = 'maelstrom-co/maelstrom',
      event_name = 'pull_request_target',
    ) =>
      evaluate({
        event_name,
        repository: 'maelstrom-co/maelstrom',
        event: {
          action,
          ...(label === undefined ? {} : { label: { name: label } }),
          pull_request: { head: { repo: { full_name: repository } } },
        },
      });
    expect(permits('closed')).toBe(true);
    expect(permits('unlabeled', 'deploy-preview')).toBe(true);
    expect(permits('unlabeled', 'bench-voice')).toBe(false);
    expect(permits('unlabeled', 'unrelated')).toBe(false);
    expect(permits('closed', undefined, 'outsider/fork')).toBe(false);
    expect(permits('unlabeled', 'deploy-preview', 'outsider/fork')).toBe(false);
    expect(permits('closed', undefined, undefined, 'workflow_dispatch')).toBe(
      false,
    );
  });

  test('the approval notice is cleared once the run stops waiting', () => {
    const source = read('deploy-preview.yml');
    const workflow = Bun.YAML.parse(source) as {
      jobs: Record<
        string,
        {
          needs?: string[];
          if?: string;
          environment?: unknown;
          concurrency?: unknown;
          permissions?: Record<string, string>;
          steps: {
            uses?: string;
            run?: string;
            env?: Record<string, string>;
          }[];
        }
      >;
    };
    const jobs = Object.keys(workflow.jobs);
    expect(jobs.indexOf('clear-approval-notice')).toBe(
      jobs.indexOf('voice-benchmark') + 1,
    );
    const job = workflow.jobs['clear-approval-notice']!;
    expect(job.needs).toEqual([
      'approve',
      'deploy',
      'benchmark-gate',
      'voice-benchmark',
    ]);
    expect(job.if).toBe(
      "always() && github.event_name == 'pull_request_target' && needs.approve.outputs.pr-number != ''",
    );
    expect(job.environment).toBeUndefined();
    expect(job.concurrency).toBeUndefined();
    expect(job.permissions).toEqual({ 'pull-requests': 'write' });
    expect(job.steps.some((entry) => entry.uses !== undefined)).toBe(false);
    const script = job.steps.map((entry) => entry.run ?? '').join('\n');
    expect(script).toContain(approvalNoticeLookup);
    expect(script).toContain('contains("(" + $run + ")")');
    expect(script).toContain(
      'xargs -r -I{} gh api --method DELETE "repos/$GH_REPO/issues/comments/{}"',
    );
    expect(script).not.toContain(['$', '{{'].join(''));
    expect(job.steps[0]!.env!.PR_NUMBER).toBe(
      expression('needs.approve.outputs.pr-number'),
    );
  });

  test('a label-triggered approval fails before any notice when the pull request head moved', () => {
    const workflow = read('deploy-preview.yml');
    const approve = workflow.slice(
      workflow.indexOf('  approve:'),
      workflow.indexOf('  deploy:'),
    );
    const name = 'Confirm the approved revision is still the pull request head';
    const check = step(approve, name);
    expect(check).toContain(
      "if: github.event_name == 'pull_request_target' && steps.manual.outputs.pr-number != ''",
    );
    expect(check).toContain(
      `HEAD_SHA: ${expression('steps.manual.outputs.head-sha')}`,
    );
    expect(check).toContain(
      'gh api "repos/$GH_REPO/pulls/$PR_NUMBER" --jq .head.sha',
    );
    expect(check).toContain('exit 1');
    expect(
      approve.indexOf('- name: Record exact approved revision'),
    ).toBeLessThan(approve.indexOf(`- name: ${name}`));
    expect(approve.indexOf(`- name: ${name}`)).toBeLessThan(
      approve.indexOf('- name: Link pending approval on the pull request'),
    );
  });

  test('label-triggered approval requests link the pending run on the pull request', () => {
    const workflow = read('deploy-preview.yml');
    const notice = step(workflow, 'Link pending approval on the pull request');
    expect(workflow.indexOf(notice)).toBeLessThan(
      workflow.indexOf('  deploy:'),
    );
    expect(notice).toContain(
      "if: github.event_name == 'pull_request_target' && steps.manual.outputs.pr-number != ''",
    );
    expect(notice).toContain('<!-- preview-approval-request -->');
    expect(notice).toContain(expression('github.run_id'));
    expect(notice).toContain('github-actions[bot]');
  });

  test('trusted workflows invoke lifecycle commands through captured absolute Bun paths', () => {
    for (const [file, command] of [
      ['invalidate-preview-approval.yml', 'invalidate'],
      ['teardown-preview.yml', 'teardown'],
      ['reconcile-previews.yml', 'discover'],
    ] as const) {
      const workflow = read(file);
      expect(workflow).toContain('id: trusted-bun');
      expect(workflow).toContain('bun_executable="$(command -v bun)"');
      expect(workflow).toContain('/usr/bin/sha256sum "$bun_executable"');
      expect(workflow).toContain('case "$bun_executable" in /*)');
      expect(workflow).toContain('[[:space:][:cntrl:]]');
      expect(workflow).toContain('test -x "$bun_executable"');
      expect(workflow).toContain(
        `BUN_EXECUTABLE: ${expression('steps.trusted-bun.outputs.path')}`,
      );
      expect(workflow).toContain(
        '--config=scripts/preview-lifecycle.bunfig.toml',
      );
      expect(workflow).toContain('--no-env-file');
      expect(workflow).toContain('--no-install');
      expect(workflow).toContain(`scripts/preview-lifecycle.ts ${command}`);
      expect(workflow).not.toContain('bun scripts/preview-lifecycle.ts');
    }
  });
});
