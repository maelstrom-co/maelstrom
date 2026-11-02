import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Script } from 'node:vm';

interface Step {
  name: string;
  uses?: string;
  run?: string;
  if?: string;
  with?: { script: string };
  env?: Record<string, string>;
}
const workflow = Bun.YAML.parse(
  readFileSync(
    resolve(import.meta.dir, '../.github/workflows/pr-agent.yml'),
    'utf8',
  ),
) as {
  on: Record<string, { types: string[] }>;
  permissions: Record<string, string>;
  concurrency?: Record<string, unknown>;
  jobs: {
    review: {
      if: string;
      concurrency?: Record<string, unknown>;
      steps: Step[];
    };
  };
};
const job = workflow.jobs.review;
const authorize = job.steps.find(
  (step) => step.name === 'Authorize review request',
)!;
const run = job.steps.find((step) => step.name === 'Run PR Agent')!;

function acceptsEvent(
  options: {
    event?: string;
    repository?: string;
    sender?: string;
    fork?: boolean;
    draft?: boolean;
    comment?: string;
    issue?: boolean;
  } = {},
) {
  return new Script(`Boolean(${job.if})`).runInNewContext({
    startsWith: (value: string, prefix: string) => value.startsWith(prefix),
    github: {
      repository: options.repository ?? 'maelstrom-co/maelstrom',
      event_name: options.event ?? 'pull_request_target',
      event: {
        sender: { type: options.sender ?? 'User' },
        pull_request: {
          draft: options.draft ?? false,
          head: {
            repo: {
              full_name: options.fork ? 'fork/repo' : 'maelstrom-co/maelstrom',
            },
          },
        },
        issue: { pull_request: options.issue ? undefined : {} },
        comment: { body: options.comment ?? '/review' },
      },
    },
  }) as boolean;
}

async function permits(
  options: {
    comment?: string;
    permission?: string;
    rerunPermission?: string;
    draft?: boolean;
    state?: string;
    head?: string;
    permissionFailure?: boolean;
  } = {},
) {
  const outputs: Record<string, string> = {};
  const checked: string[] = [];
  const script = new Script(`(async () => { ${authorize.with!.script} })()`);
  await script.runInNewContext({
    context: {
      repo: { owner: 'maelstrom-co', repo: 'maelstrom' },
      actor: 'requester',
      payload: {
        comment:
          options.comment === undefined ? undefined : { body: options.comment },
        pull_request:
          options.comment === undefined
            ? { number: 10, head: { sha: 'original' } }
            : undefined,
        issue: options.comment === undefined ? undefined : { number: 10 },
      },
    },
    process: { env: { GITHUB_TRIGGERING_ACTOR: 'rerunner' } },
    core: {
      info: () => {},
      setOutput: (name: string, value: string) => {
        outputs[name] = value;
      },
    },
    github: {
      rest: {
        repos: {
          getCollaboratorPermissionLevel: async ({
            username,
          }: {
            username: string;
          }) => {
            checked.push(username);
            if (options.permissionFailure) throw new Error('API unavailable');
            return {
              data: {
                permission:
                  username === 'requester'
                    ? (options.permission ?? 'write')
                    : (options.rerunPermission ?? 'maintain'),
              },
            };
          },
        },
        pulls: {
          get: async () => ({
            data: {
              state: options.state ?? 'open',
              draft: options.draft ?? false,
              head: { sha: options.head ?? 'original' },
            },
          }),
        },
      },
    },
  });
  return { allowed: outputs.allowed === 'true', checked };
}

test('automatic reviews exclude forks, drafts, bots, and copied repositories', () => {
  expect(acceptsEvent()).toBe(true);
  for (const excluded of [
    { fork: true },
    { draft: true },
    { sender: 'Bot' },
    { repository: 'fork/repo' },
  ])
    expect(acceptsEvent(excluded)).toBe(false);
  expect(workflow.on.pull_request_target!.types).toContain('synchronize');
});

test('ordinary comments and issue commands cannot start paid review work', () => {
  expect(acceptsEvent({ event: 'issue_comment' })).toBe(true);
  expect(acceptsEvent({ event: 'issue_comment', comment: 'Looks good' })).toBe(
    false,
  );
  expect(acceptsEvent({ event: 'issue_comment', issue: true })).toBe(false);
});

test('keeps ignored comments outside the queue and retains multiple pending reviews', () => {
  expect(workflow.concurrency).toBeUndefined();
  expect(job.concurrency).toEqual({
    group: `pr-agent-\${{ github.event.pull_request.number || github.event.issue.number }}`,
    'cancel-in-progress': false,
    queue: 'max',
  });
});

test('both the original requester and the rerun actor need current write access', async () => {
  expect(await permits()).toEqual({
    allowed: true,
    checked: ['requester', 'rerunner'],
  });
  for (const permission of ['read', 'triage', 'none']) {
    expect((await permits({ permission })).allowed).toBe(false);
    expect((await permits({ rerunPermission: permission })).allowed).toBe(
      false,
    );
  }
  for (const permission of ['write', 'maintain', 'admin']) {
    expect((await permits({ permission })).allowed).toBe(true);
  }
  await expect(permits({ permissionFailure: true })).rejects.toThrow(
    'API unavailable',
  );
});

test('only supported commands reach the reviewer, including commands on fork PRs', async () => {
  for (const comment of [
    '/review',
    '/review -i',
    '/improve',
    '/ask "What breaks?"',
  ]) {
    expect((await permits({ comment })).allowed).toBe(true);
  }
  for (const comment of [
    '/describe',
    '/reviewer',
    '/help_docs',
    '/update_changelog',
  ]) {
    expect((await permits({ comment })).allowed).toBe(false);
  }
  expect(acceptsEvent({ event: 'issue_comment', fork: true })).toBe(true);
});

test('queued automatic reviews skip closed, draft, and superseded PRs', async () => {
  for (const invalid of [
    { state: 'closed' },
    { draft: true },
    { head: 'newer' },
  ]) {
    expect((await permits(invalid)).allowed).toBe(false);
  }
  expect((await permits({ comment: '/review', head: 'newer' })).allowed).toBe(
    true,
  );
});

test('the privileged job never executes PR source and gates credential access', () => {
  expect(job.steps.some((step) => step.uses?.includes('checkout'))).toBe(false);
  expect(job.steps.filter((step) => step.run)).toHaveLength(1);
  expect(run.uses).toMatch(
    /^docker:\/\/pragent\/pr-agent@sha256:[a-f0-9]{64}$/,
  );
  for (const step of job.steps.filter((step) =>
    JSON.stringify(step.env ?? {}).includes('secrets.'),
  )) {
    expect(step.if).toBe("steps.authorize.outputs.allowed == 'true'");
  }
  expect(workflow.permissions).toEqual({
    contents: 'read',
    issues: 'write',
    'pull-requests': 'write',
  });
  expect(run.env?.GITHUB_ACTION_CONFIG__AUTO_DESCRIBE).toBe('false');
  expect(run.env?.GITHUB_ACTION_CONFIG__AUTO_IMPROVE).toBe('false');
  expect(run.env?.CONFIG__ENABLE_AUTO_APPROVAL).toBe('false');
  expect(run.env?.GITHUB_ACTION_CONFIG__HANDLE_PUSH_TRIGGER).toBe('true');
  expect(JSON.parse(run.env!.GITHUB_ACTION_CONFIG__PUSH_COMMANDS!)).toEqual([
    '/review',
  ]);
});
