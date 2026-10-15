import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const read = (name: string) =>
  readFileSync(resolve(root, '.github/workflows', name), 'utf8');
const expression = (value: string) => ['$', `{{ ${value} }}`].join('');
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

  test('voice benchmarking reconciles either label change without cancelling lifecycle mutations', () => {
    const workflow = read('deploy-preview.yml');
    const job = workflow.slice(workflow.indexOf('\n  voice-benchmark:'));
    expect(job).toContain('needs: deploy');
    expect(job).toContain("needs.deploy.result == 'success'");
    expect(workflow).toContain('types: [labeled, unlabeled]');
    expect(job).toContain("github.event.action == 'labeled'");
    expect(job).toContain("github.event.action == 'unlabeled'");
    expect(job).toContain("github.event.label.name == 'bench-voice'");
    expect(job).toContain("github.event.label.name == 'deploy-preview'");
    expect(job).not.toContain(
      'contains(github.event.pull_request.labels.*.name',
    );
    expect(job).toContain(
      'github.event.pull_request.head.repo.full_name == github.repository',
    );
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

  test('benchmark label routing admits removals without admitting unrelated or untrusted events', () => {
    const workflow = Bun.YAML.parse(read('deploy-preview.yml')) as {
      on: { pull_request_target: { types: string[] } };
      jobs: { 'voice-benchmark': { if: string } };
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
      `return (${workflow.jobs['voice-benchmark'].if});`,
    );
    const permits = (
      action: string,
      label: string,
      overrides: Record<string, unknown> = {},
      cancelled = false,
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
        { deploy: { result: 'skipped' } },
        {},
        () => true,
        () => cancelled,
        () => '',
      );
    for (const action of ['labeled', 'unlabeled']) {
      for (const label of ['deploy-preview', 'bench-voice']) {
        expect(permits(action, label)).toBe(true);
        expect(permits(action, label, { sender: { type: 'Bot' } })).toBe(false);
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
  });

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
      `group: deploy-preview-pr-${expression('github.event.pull_request.number')}`,
    );
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).toContain('queue: max');
    expect(workflow).toContain(`ref: ${expression('github.workflow_sha')}`);
    expect(workflow).toContain('path: source');
    expect(workflow).toContain(
      `ref: ${expression('github.event.pull_request.head.sha')}`,
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

  test('every credentialed deploy verifies trusted runtime files in the same shell step', () => {
    const workflow = read('deploy-preview.yml');
    const runtimeFiles = [
      'scripts/preview-lifecycle.ts',
      'scripts/delete-preview-workers.ts',
      'scripts/preview-worker-url.ts',
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
