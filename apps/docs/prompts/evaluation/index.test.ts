import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  chmod,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildCaseInput,
  type CaseId,
  caseRegistry,
  gradeCaseEvidence,
} from './cases';
import {
  candidateGraderEvidence,
  diff,
  evaluateCase,
  evaluateModeling,
  extractPiAssistantText,
  gradeCandidate,
  isDisposableArtifactChange,
  runCommand,
  snapshotCandidate,
} from './index';

let root: string;
let fakePi: string;
let oldPi: string | undefined;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'evaluation-test-'));
  fakePi = join(root, 'fake-pi.mjs');
  oldPi = process.env.PI_CLI;
  process.env.PI_CLI = fakePi;
});

afterEach(async () => {
  if (oldPi === undefined) delete process.env.PI_CLI;
  else process.env.PI_CLI = oldPi;
  await rm(root, { recursive: true, force: true });
});

async function fake(source: string) {
  await writeFile(fakePi, `#!/usr/bin/env node\n${source}\n`);
  await chmod(fakePi, 0o700);
}

const options = () => ({
  output: join(root, 'private-output'),
  runner: 'pi' as const,
});

const genericOptions = () => ({
  output: join(root, 'generic-output'),
  runner: 'command' as const,
  command: { executable: fakePi, args: [] },
});

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForFile(path: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      await stat(path);
      return;
    } catch {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}

describe('registered behavioral cases', () => {
  test('registers five cases with canonical prompt ids and explicit execution modes', () => {
    expect(Object.keys(caseRegistry).sort()).toEqual([
      'debugging-read-only',
      'modeling-read-only',
      'onboarding-implementation',
      'react-conversion',
      'react-inventory',
    ]);
    expect(caseRegistry['react-inventory'].promptId).toBe(
      'maelstrom-react-inventory',
    );
    expect(caseRegistry['react-conversion'].mode).toBe('implementation');
  });

  test('constructs actual canonical prompt and fixture inputs for all five cases', async () => {
    const ids = Object.keys(caseRegistry) as CaseId[];
    expect(ids).toHaveLength(5);
    for (const id of ids) {
      const built = await buildCaseInput(id);
      expect(built.prompt.id).toBe(caseRegistry[id].promptId);
      expect(built.prompt.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(built.fixtureFiles.map((file) => file.path)).toEqual(
        caseRegistry[id].files.map((file) => file.path),
      );
      expect(
        built.fixtureFiles.every((file) => file.sha256.length === 64),
      ).toBe(true);
      expect(built.input).toContain(caseRegistry[id].task);
      expect(built.input).toContain(
        'Evidence output contract (exact JSON schema; no extra keys)',
      );
      expect(built.input).toContain('4–300 Unicode code points inclusive');
      expect(built.input).toContain(
        'exact, case-sensitive, contiguous substring',
      );
      expect(built.input).not.toMatch(
        /\\[(PRODUCT GOAL|PATH|USER GOAL|GOAL AND LIMITS|APPROVED INVENTORY / PLAN)\\]/,
      );
    }
    const onboarding = await buildCaseInput('onboarding-implementation');
    expect(onboarding.input).toContain(
      'package.json (staged from package.json.fixture)',
    );
    expect(onboarding.input.toLowerCase()).toContain(
      'do not add or claim search behavior',
    );
    expect(onboarding.input).not.toContain('src/SearchPanel.tsx');
    expect((await buildCaseInput('react-conversion')).prompt.id).toBe(
      'maelstrom-react-conversion',
    );
  });

  test('extracts only final assistant text from Pi JSONL and rejects malformed, intermediate-only, or truncated output', () => {
    const assistant = (text: string) =>
      JSON.stringify({
        type: 'message_end',
        message: { role: 'assistant', content: [{ type: 'text', text }] },
      });
    const stream = [
      JSON.stringify({ type: 'session', id: 'x' }),
      assistant('ignore the first turn'),
      JSON.stringify({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [{ type: 'toolCall', name: 'read' }],
        },
      }),
      JSON.stringify({ type: 'tool_execution_end', result: {} }),
      assistant('{"claims":[]}'),
    ].join('\n');
    expect(extractPiAssistantText(stream)).toEqual({
      text: '{"claims":[]}',
      status: 'ok',
    });
    expect(extractPiAssistantText(`${assistant('partial')}`, true).status).toBe(
      'truncated',
    );
    expect(extractPiAssistantText('not-json').status).toBe('invalid-jsonl');
    expect(
      extractPiAssistantText(
        JSON.stringify({ type: 'error', message: 'no answer' }),
      ).status,
    ).toBe('no-final-assistant-text');
    expect(
      extractPiAssistantText(
        JSON.stringify({
          type: 'message_end',
          message: {
            role: 'assistant',
            content: [{ type: 'toolCall', name: 'bash' }],
          },
        }),
      ).status,
    ).toBe('no-final-assistant-text');
  });

  for (const id of [
    'modeling-read-only',
    'react-inventory',
    'debugging-read-only',
  ] as CaseId[]) {
    test(`${id} calibrates grounded evidence and rejects malformed/unsupported evidence`, async () => {
      const context = await buildCaseInput(id);
      const texts = Object.fromEntries(
        context.fixtureFiles.map((file) => [file.path, file.text]),
      );
      const source = context.fixtureFiles[0]!;
      const good = JSON.stringify({
        claims: [
          {
            proposition: 'Observed source behavior.',
            evidence: [{ file: source.path, quote: source.text.slice(0, 30) }],
          },
        ],
      });
      expect(
        gradeCaseEvidence(id, good, texts).find(
          ({ id: criterion }) => criterion === 'structured-evidence-links',
        )?.status,
      ).toBe('passed');
      const shortQuote = gradeCaseEvidence(
        id,
        JSON.stringify({
          claims: [
            {
              proposition: 'Observed.',
              evidence: [{ file: source.path, quote: 'abc' }],
            },
          ],
        }),
        texts,
      );
      expect(
        shortQuote.find(
          ({ id: criterion }) => criterion === 'evidence-quote-length',
        )?.status,
      ).toBe('failed');
      expect(
        shortQuote.find(
          ({ id: criterion }) => criterion === 'evidence-quote-membership',
        )?.status,
      ).toBe('passed');
      const extraKey = gradeCaseEvidence(
        id,
        JSON.stringify({
          claims: [
            {
              proposition: 'Observed.',
              evidence: [
                {
                  file: source.path,
                  quote: source.text.slice(0, 8),
                  path: source.path,
                },
              ],
            },
          ],
        }),
        texts,
      );
      expect(
        extraKey.find(
          ({ id: criterion }) => criterion === 'evidence-json-schema',
        )?.status,
      ).toBe('failed');
      const alteredQuote = gradeCaseEvidence(
        id,
        JSON.stringify({
          claims: [
            {
              proposition: 'Observed.',
              evidence: [
                { file: source.path, quote: `${source.text.slice(0, 7)}X` },
              ],
            },
          ],
        }),
        texts,
      );
      expect(
        alteredQuote.find(
          ({ id: criterion }) => criterion === 'evidence-quote-membership',
        )?.status,
      ).toBe('failed');
      const bad = JSON.stringify({
        claims: [
          {
            proposition: 'Unsupported.',
            evidence: [{ file: '../grader.test.ts', quote: 'invented quote' }],
          },
        ],
      });
      expect(
        gradeCaseEvidence(id, bad, texts).find(
          ({ id: criterion }) => criterion === 'structured-evidence-links',
        )?.status,
      ).toBe('failed');
      expect(
        gradeCaseEvidence(id, 'exit 0').find(
          ({ id: criterion }) => criterion === 'structured-evidence-links',
        )?.status,
      ).toBe('failed');
    });
  }

  test('implementation cases refuse execution without operator authorization and verified containment', async () => {
    for (const id of [
      'onboarding-implementation',
      'react-conversion',
    ] as CaseId[]) {
      await expect(
        evaluateCase(id, {
          output: join(root, `${id}-out`),
          runner: 'command',
          command: { executable: fakePi, args: [] },
        }),
      ).rejects.toThrow('explicit operator approval or verified containment');
    }
  });
});

describe('evaluation CLI harness', () => {
  test('registered modeling execution grades its registered task through Pi JSONL while the legacy API remains available', async () => {
    const claims = JSON.stringify({
      claims: [
        {
          proposition: 'The queue exposes its observed list.',
          evidence: [{ file: 'src/Queue.tsx', quote: 'Support queue' }],
        },
      ],
    });
    const assistantEvent = JSON.stringify({
      type: 'message_end',
      message: {
        role: 'assistant',
        model: 'fake-model-v2',
        provider: 'fake-provider',
        content: [{ type: 'text', text: claims }],
      },
    });
    await fake(
      `if (process.argv.includes('--version')) { console.log('fake-pi 2.0'); process.exit(0); } process.stdin.resume(); process.stdin.on('end', () => { console.log(JSON.stringify({ type: 'session', id: 'session-1' })); console.log(${JSON.stringify(assistantEvent)}); });`,
    );
    const result = await evaluateCase('modeling-read-only', options());
    expect(
      result.criteria.find(({ id }) => id === 'structured-evidence-links')
        ?.status,
    ).toBe('passed');
    expect(result.manifest.runner).toMatchObject({
      version: 'fake-pi 2.0',
      model: 'fake-model-v2',
      provider: 'fake-provider',
    });
    expect((result.manifest.task as { text: string }).text).toContain(
      'Evidence output contract (exact JSON schema; no extra keys)',
    );
  });
  test('delivers task on stdin in scratch cwd and separates objective checks from semantic review', async () => {
    await fake(`
if (process.argv.includes('--version')) { console.log('fake-pi 1.2.3'); process.exit(0); }
let input = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  if (!input.includes('Evaluation task:') || !input.includes('Inventory the support-queue') || !input.includes('Case context file: src/Queue.tsx') || !input.includes('Support queue')) process.exit(9);
  if (!process.cwd().endsWith('/case')) process.exit(8);
  console.log(JSON.stringify({ type: 'message_end', message: { role: 'assistant', model: 'fixture-model', provider: 'fixture-provider', content: [{ type: 'text', text: 'legacy final answer' }] } }));
});`);
    const result = await evaluateModeling(options());
    expect(result.exitCode).toBe(0);
    expect(result.changes).toEqual([]);
    expect(result.criteria.map((criterion) => criterion.status)).toEqual([
      'passed',
      'passed',
      'unrun',
      'unrun',
      'unrun',
    ]);
    expect(result.manifest).toMatchObject({
      runner: {
        version: 'fake-pi 1.2.3',
        model: 'fixture-model',
        provider: 'fixture-provider',
      },
      security: { filesystemSandbox: false, environmentSerialized: false },
    });
    expect(JSON.stringify(result.manifest)).not.toContain(
      process.env.OPENAI_API_KEY ?? 'not-present-secret',
    );
    expect(
      await readFile(
        join(
          result.manifest.security.privateOutputDirectory as string,
          'stdout.jsonl',
        ),
        'utf8',
      ),
    ).toContain('fixture-model');
  });

  test('rejects output paths that reach the checkout through a symlink before mkdir', async () => {
    const workspace = join(import.meta.dir, '../../../../');
    const alias = join(root, 'checkout-alias');
    const destination = join(
      alias,
      `.evaluation-output-test-${process.pid}-${Date.now()}`,
    );
    await symlink(workspace, alias);
    await expect(
      evaluateModeling({ output: destination, runner: 'pi' }),
    ).rejects.toThrow('outside the workspace checkout');
    await expect(stat(destination)).rejects.toThrow();
  });

  test('rejects checkout output paths before creating them', async () => {
    const checkoutPath = join(
      import.meta.dir,
      '../../../../.evaluation-output-must-not-exist',
    );
    await expect(
      evaluateModeling({ output: checkoutPath, runner: 'pi' }),
    ).rejects.toThrow('outside the workspace checkout');
    await expect(stat(checkoutPath)).rejects.toThrow();
  });

  test('registered evaluateCase always fails read-only mutations and fixture inspection errors', async () => {
    await fake(`
const fs = await import('node:fs');
process.stdin.resume();
process.stdin.on('end', () => {
  fs.writeFileSync('report.md', 'mutated');
  console.log('diagnostic answer');
});`);
    const changed = await evaluateCase('debugging-read-only', {
      ...genericOptions(),
      output: join(root, 'registered-mutation'),
    });
    expect(
      changed.criteria.find(({ id }) => id === 'read-only-zero-changes')
        ?.status,
    ).toBe('failed');

    const outside = join(root, 'outside-fixture-root');
    await (await import('node:fs/promises')).mkdir(outside, {
      recursive: true,
    });
    await fake(`
const fs = await import('node:fs');
const cwd = process.cwd();
process.stdin.resume();
process.stdin.on('end', () => {
  fs.rmSync(cwd, { recursive: true, force: true });
  fs.symlinkSync(${JSON.stringify(outside)}, cwd);
  console.log('diagnostic answer');
});`);
    const unreadable = await evaluateCase('debugging-read-only', {
      ...genericOptions(),
      output: join(root, 'registered-inspection-error'),
    });
    expect(unreadable.inspectionError).toContain(
      'root was removed or replaced',
    );
    expect(
      unreadable.criteria.find(({ id }) => id === 'read-only-zero-changes')
        ?.status,
    ).toBe('failed');
  });

  test('captures fixture additions and edits as objective failures', async () => {
    await fake(`
if (process.argv.includes('--version')) { console.log('fake 1'); process.exit(0); }
const fs = await import('node:fs'); fs.writeFileSync('added.txt', 'new'); fs.writeFileSync('src/Queue.tsx', 'changed'); process.stdin.resume(); process.stdin.on('end', () => process.exit(0));`);
    const result = await evaluateModeling(options());
    expect(result.changes.map(({ kind }) => kind).sort()).toEqual([
      'added',
      'modified',
    ]);
    expect(
      result.criteria.find(({ id }) => id === 'read-only-zero-changes')?.status,
    ).toBe('failed');
  });

  test('publishes bounded private grader process and browser evidence', () => {
    const evidence = candidateGraderEvidence({
      caseId: 'onboarding-implementation',
      harnessStatus: 'ready',
      criteria: [],
      commands: [
        {
          command: ['node', 'browser-case.mjs'],
          status: 'completed',
          exitCode: 0,
          timedOut: false,
          cancelled: false,
          durationMs: 321,
          summary: `${'x'.repeat(2500)}\\nBrowser geometry and SDK registration observed`,
        },
      ],
      changedPaths: [],
      evidence: [],
    });
    expect(evidence.commands[0]?.processEvidence).toHaveLength(2000);
    expect(evidence.commands[0]?.processEvidence).toContain(
      'Browser geometry and SDK registration observed',
    );
    expect(evidence.commands[0]).toMatchObject({
      argv: ['node', 'browser-case.mjs'],
      status: 'completed',
      exitCode: 0,
      timedOut: false,
      cancelled: false,
      durationMs: 321,
    });
  });

  test('permits generated artifact deletion, but rejects protected and dependency deletions', async () => {
    for (const path of [
      '.vite/deps/_metadata.json',
      'node_modules/.vite/deps/chunk.js',
      'dist/assets/app-oldhash.js',
      'coverage/summary.json',
      'test-results/report.json',
      'playwright-report/index.html',
    ]) {
      expect(isDisposableArtifactChange({ path, kind: 'added' })).toBe(true);
      expect(isDisposableArtifactChange({ path, kind: 'modified' })).toBe(true);
      expect(isDisposableArtifactChange({ path, kind: 'deleted' })).toBe(true);
    }
    for (const path of [
      'src/App.tsx',
      'package.json',
      'vite.config.ts',
      'node_modules/@maelstrom-co/react/dist/index.js',
      'coverage-evil/file.js',
    ]) {
      expect(isDisposableArtifactChange({ path, kind: 'added' })).toBe(false);
      expect(isDisposableArtifactChange({ path, kind: 'deleted' })).toBe(false);
    }

    const candidateRoot = join(root, 'deleted-protected-candidate');
    const fs = await import('node:fs/promises');
    await fs.mkdir(join(candidateRoot, 'src'), { recursive: true });
    await fs.mkdir(join(candidateRoot, 'node_modules/@maelstrom-co/react'), {
      recursive: true,
    });
    await writeFile(join(candidateRoot, 'package.json'), '{}\\n');
    await writeFile(join(candidateRoot, 'src/App.tsx'), 'export {};\\n');
    const dependency = join(
      candidateRoot,
      'node_modules/@maelstrom-co/react/index.js',
    );
    await writeFile(dependency, 'export {};\\n');

    let baseline = await snapshotCandidate(candidateRoot);
    await rm(join(candidateRoot, 'package.json'));
    let grade = await gradeCandidate('onboarding-implementation', {
      candidateRoot,
      baseline,
    });
    expect(grade.harnessStatus).toBe('blocked');
    expect(
      grade.criteria.find(({ id }) => id === 'trusted-file-integrity')?.status,
    ).toBe('failed');
    expect(
      grade.criteria.find(({ id }) => id === 'application-change-allowlist')
        ?.status,
    ).toBe('failed');
    expect(grade.commands).toHaveLength(0);

    await writeFile(join(candidateRoot, 'package.json'), '{}\\n');
    baseline = await snapshotCandidate(candidateRoot);
    await rm(dependency);
    grade = await gradeCandidate('onboarding-implementation', {
      candidateRoot,
      baseline,
    });
    expect(grade.harnessStatus).toBe('blocked');
    expect(
      grade.criteria.find(({ id }) => id === 'application-change-allowlist')
        ?.status,
    ).toBe('failed');
    expect(grade.commands).toHaveLength(0);

    const artifactRoot = join(candidateRoot, 'dist/assets');
    await fs.mkdir(artifactRoot, { recursive: true });
    await writeFile(join(artifactRoot, 'actual.js'), 'generated');
    const generatedSymlink = join(artifactRoot, 'linked.js');
    await symlink('actual.js', generatedSymlink);
    baseline = await snapshotCandidate(candidateRoot);
    await rm(generatedSymlink);
    grade = await gradeCandidate('onboarding-implementation', {
      candidateRoot,
      baseline,
    });
    expect(
      grade.criteria.find(({ id }) => id === 'application-change-allowlist')
        ?.status,
    ).toBe('failed');
    expect(grade.commands).toHaveLength(0);
  });

  test('generated artifact roots stay narrow across additions, modifications and deletions', () => {
    for (const path of [
      '.vite/deps/_metadata.json',
      'node_modules/.vite/deps/chunk.js',
      'dist/assets/app.js',
      'coverage/summary.json',
      'test-results/report.json',
      'playwright-report/index.html',
    ]) {
      expect(isDisposableArtifactChange({ path, kind: 'added' })).toBe(true);
      expect(isDisposableArtifactChange({ path, kind: 'modified' })).toBe(true);
      expect(isDisposableArtifactChange({ path, kind: 'deleted' })).toBe(true);
    }
    for (const path of [
      'src/App.tsx',
      'package.json',
      'vite.config.ts',
      'node_modules/@maelstrom-co/react/dist/index.js',
      'coverage-evil/file.js',
    ])
      expect(isDisposableArtifactChange({ path, kind: 'added' })).toBe(false);
  });

  test('diff classifies additions, modifications and deletions', () => {
    const result = diff(
      new Map([
        ['edit', 'old'],
        ['remove', 'gone'],
      ]),
      new Map([
        ['edit', 'new'],
        ['add', 'new'],
      ]),
    );
    expect(result.map(({ kind }) => kind).sort()).toEqual([
      'added',
      'deleted',
      'modified',
    ]);
  });

  test('runs a generic CLI with literal argv, exact stdin and explicit cwd', async () => {
    const marker = join(root, 'should-not-exist');
    const argument = `two words; touch ${marker}`;
    const cwd = join(root, 'generic-cwd');
    await import('node:fs/promises').then(({ mkdir }) => mkdir(cwd));
    const code = `let input = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', value => input += value); process.stdin.on('end', () => { if (!process.argv.includes(${JSON.stringify(argument)} ) || input !== 'exact prompt\\n' || process.cwd() !== require('node:fs').realpathSync(${JSON.stringify(cwd)})) process.exit(3); console.log('generic-ok'); });`;
    const result = await runCommand({
      command: { executable: 'node', args: ['-e', code, argument] },
      input: 'exact prompt\n',
      cwd,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('generic-ok');
    await expect(stat(marker)).rejects.toThrow();
  });

  test('generic tool-use evidence does not claim the CLI disabled tools', async () => {
    await fake(
      `process.stdin.resume(); process.stdin.on('end', () => process.exit(0));`,
    );
    const result = await evaluateModeling(genericOptions());
    const criterion = result.criteria.find(
      ({ id }) => id === 'tool-use-and-repository-inspection',
    );
    expect(criterion?.status).toBe('unrun');
    expect(criterion?.evidence).toContain(
      'tool policy and tool use were not evaluated',
    );
    expect(criterion?.evidence).not.toContain('Tools were disabled');
  });

  test('CLI parser preserves reserved-looking literal --arg values', async () => {
    await fake(
      `console.log(JSON.stringify({ claims: [{ proposition: 'Queue observation.', evidence: [{ file: 'src/Queue.tsx', quote: 'Support queue' }] }] })); process.stdin.resume(); process.stdin.on('end', () => process.exit(0));`,
    );
    const cwd = root;
    const literalArgs = ['--runner', '--output', '--command', '--help'];
    const cliArgs = [
      join(import.meta.dir, 'index.ts'),
      '--arg',
      '--runner',
      '--arg',
      '--output',
      '--arg',
      '--command',
      '--arg',
      '--help',
      '--case',
      'modeling-read-only',
      '--runner',
      'command',
      '--output',
      join(root, 'cli-private-output'),
      '--command',
      fakePi,
    ];
    const result = await runCommand({
      command: { executable: process.execPath, args: cliArgs },
      input: '',
      cwd,
      timeoutMs: 10_000,
    });
    expect(result.exitCode).toBe(0);
    const summary = JSON.parse(result.stdout) as {
      manifest: { runner: { command: string[] } };
    };
    expect(summary.manifest.runner.command).toEqual([fakePi, ...literalArgs]);
  });

  test('invalid generic configuration allocates no scratch or output directory', async () => {
    const previousTmpdir = process.env.TMPDIR;
    process.env.TMPDIR = root;
    const before = await readdir(root);
    try {
      await expect(
        evaluateModeling({
          output: join(root, 'invalid-output'),
          runner: 'command',
        }),
      ).rejects.toThrow('Generic command runner requires an executable');
      expect(await readdir(root)).toEqual(before);
    } finally {
      if (previousTmpdir === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = previousTmpdir;
    }
  });

  test('bounds capture when a detached orphan keeps inherited pipes open', async () => {
    if (process.platform === 'win32') return;
    const pidPath = join(root, 'orphan-pipe.pid');
    const previousPidPath = process.env.EVALUATION_ORPHAN_PID;
    process.env.EVALUATION_ORPHAN_PID = pidPath;
    const orphanCode = `process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);`;
    await fake(`
const fs = await import('node:fs');
const { spawn } = await import('node:child_process');
const child = spawn(process.execPath, ['-e', ${JSON.stringify(orphanCode)}], { detached: true, stdio: ['ignore', process.stdout, process.stderr] });
child.unref();
fs.writeFileSync(process.env.EVALUATION_ORPHAN_PID, String(child.pid));
process.stdin.resume();
process.stdin.on('end', () => { console.log('parent-exiting'); process.exit(0); });`);
    let orphanPid: number | undefined;
    try {
      const result = await evaluateModeling(genericOptions());
      orphanPid = Number(await readFile(pidPath, 'utf8'));
      expect(result.exitCode).toBe(0);
      expect(result.captureIncomplete).toBe(true);
      expect(result.manifest.process).toMatchObject({
        captureIncomplete: true,
      });
      expect(result.stdout).toContain('parent-exiting');
      expect(result.durationMs).toBeLessThan(4_000);
      expect(isProcessAlive(orphanPid)).toBe(true);
    } finally {
      if (!orphanPid) {
        try {
          orphanPid = Number(await readFile(pidPath, 'utf8'));
        } catch {}
      }
      if (orphanPid && isProcessAlive(orphanPid)) {
        try {
          process.kill(orphanPid, 'SIGKILL');
        } catch {}
      }
      if (previousPidPath === undefined)
        delete process.env.EVALUATION_ORPHAN_PID;
      else process.env.EVALUATION_ORPHAN_PID = previousPidPath;
    }
  });

  test('reports nonzero exit and preserves stdout/stderr', async () => {
    await fake(`
if (process.argv.includes('--version')) { console.log('fake'); process.exit(0); }
console.log('captured stdout'); console.error('captured stderr'); process.exit(7);`);
    const result = await evaluateModeling(options());
    expect(result.exitCode).toBe(7);
    expect(result.stdout).toContain('captured stdout');
    expect(result.stderr).toContain('captured stderr');
    expect(result.criteria[0]?.status).toBe('failed');
  });

  test('reports spawn failure without semantic grading', async () => {
    process.env.PI_CLI = join(root, 'missing-executable');
    const result = await evaluateModeling(options());
    expect(result.status).toBe('spawn-error');
    expect(result.spawnError).toBeDefined();
    expect(
      result.criteria.find(({ id }) => id === 'semantic-quality')?.status,
    ).toBe('unrun');
  });

  test('bounds Pi version discovery and terminates the hanging version process', async () => {
    const pidPath = join(root, 'version.pid');
    const previousPidPath = process.env.EVALUATION_VERSION_DISCOVERY_PID;
    process.env.EVALUATION_VERSION_DISCOVERY_PID = pidPath;
    await fake(`
if (process.argv.includes('--version')) {
  (await import('node:fs')).writeFileSync(process.env.EVALUATION_VERSION_DISCOVERY_PID, String(process.pid));
  setInterval(() => {}, 1000);
} else {
  process.stdin.resume();
  process.stdin.on('end', () => { console.log('main completed'); process.exit(0); });
}`);
    try {
      const result = await evaluateModeling({
        ...options(),
        timeoutMs: 10_000,
        versionTimeoutMs: 1_500,
      });
      expect(result.exitCode).toBe(0);
      expect((result.manifest.runner as { version: string }).version).toBe(
        'unknown',
      );
      const pid = Number(await readFile(pidPath, 'utf8'));
      expect(isProcessAlive(pid)).toBe(false);
    } finally {
      if (previousPidPath === undefined)
        delete process.env.EVALUATION_VERSION_DISCOVERY_PID;
      else process.env.EVALUATION_VERSION_DISCOVERY_PID = previousPidPath;
    }
  });

  test('timeout terminates the owned process group and captures timeout status', async () => {
    await fake(
      `if (process.argv.includes('--version')) { console.log('fake'); process.exit(0); } setInterval(() => {}, 1000);`,
    );
    const result = await evaluateModeling({ ...options(), timeoutMs: 30 });
    expect(result.timedOut).toBe(true);
    expect(result.signal).not.toBeNull();
    expect(result.criteria[0]?.status).toBe('failed');
  });

  test('pre-start cancellation and cancellation during preparation never spawn the CLI', async () => {
    const marker = join(root, 'cli-was-started');
    const previousMarker = process.env.EVALUATION_START_MARKER;
    await fake(
      `const fs = await import('node:fs'); fs.writeFileSync(process.env.EVALUATION_START_MARKER, 'started'); process.stdin.resume();`,
    );
    process.env.EVALUATION_START_MARKER = marker;
    try {
      const beforeStart = new AbortController();
      beforeStart.abort();
      await expect(
        evaluateModeling({ ...options(), signal: beforeStart.signal }),
      ).rejects.toThrow('cancelled before process startup');
      const duringPreparation = new AbortController();
      const evaluation = evaluateModeling({
        ...options(),
        signal: duringPreparation.signal,
      });
      duringPreparation.abort();
      await expect(evaluation).rejects.toThrow(
        'cancelled before process startup',
      );
      await expect(stat(marker)).rejects.toThrow();
    } finally {
      if (previousMarker === undefined)
        delete process.env.EVALUATION_START_MARKER;
      else process.env.EVALUATION_START_MARKER = previousMarker;
    }
  });

  test('handles a CLI that closes stdin early without an uncaught stream error', async () => {
    const cwd = join(root, 'epipe-cwd');
    await import('node:fs/promises').then(({ mkdir }) => mkdir(cwd));
    const result = await runCommand({
      command: {
        executable: 'head',
        args: ['-c', '1'],
      },
      input: 'x'.repeat(32 * 1024 * 1024),
      cwd,
      timeoutMs: 1000,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('x');
  });

  test('captures output even when fixture root is replaced with an outside symlink', async () => {
    const outside = join(root, 'outside');
    const capture = join(root, 'captured-cwd');
    const previousCapture = process.env.EVALUATION_CAPTURE_CWD;
    const previousOutside = process.env.EVALUATION_OUTSIDE;
    await import('node:fs/promises').then(({ mkdir }) => mkdir(outside));
    await writeFile(join(outside, 'outside.txt'), 'must not be inventoried');
    process.env.EVALUATION_CAPTURE_CWD = capture;
    await fake(`
const fs = await import('node:fs'); process.stdin.resume(); process.stdin.on('end', () => { const cwd = process.cwd(); fs.writeFileSync(process.env.EVALUATION_CAPTURE_CWD, cwd); fs.renameSync(cwd, cwd + '.saved'); fs.symlinkSync(process.env.EVALUATION_OUTSIDE, cwd); console.log('captured-before-inspection-failure'); });`);
    process.env.EVALUATION_OUTSIDE = outside;
    try {
      const result = await evaluateModeling(genericOptions());
      expect(result.inspectionError).toContain('root was removed or replaced');
      expect(
        result.criteria.find(({ id }) => id === 'read-only-zero-changes')
          ?.status,
      ).toBe('failed');
      expect(result.stdout).toContain('captured-before-inspection-failure');
      const cwd = await readFile(capture, 'utf8');
      await expect(stat(cwd)).rejects.toThrow();
    } finally {
      if (previousCapture === undefined)
        delete process.env.EVALUATION_CAPTURE_CWD;
      else process.env.EVALUATION_CAPTURE_CWD = previousCapture;
      if (previousOutside === undefined) delete process.env.EVALUATION_OUTSIDE;
      else process.env.EVALUATION_OUTSIDE = previousOutside;
    }
  });

  test('records nested symlink inspection failure and retains raw process output', async () => {
    const outside = join(root, 'outside-nested');
    const previousOutside = process.env.EVALUATION_OUTSIDE;
    await import('node:fs/promises').then(({ mkdir }) => mkdir(outside));
    await fake(`
const fs = await import('node:fs'); process.stdin.resume(); process.stdin.on('end', () => { fs.symlinkSync(process.env.EVALUATION_OUTSIDE, 'escape'); console.log('nested-link-run'); });`);
    process.env.EVALUATION_OUTSIDE = outside;
    try {
      const result = await evaluateModeling(genericOptions());
      expect(result.inspectionError).toContain('Run created a symlink');
      expect(result.stdout).toContain('nested-link-run');
      const artifacts = result.manifest.security as {
        privateOutputDirectory: string;
      };
      await expect(
        readFile(
          join(artifacts.privateOutputDirectory, 'stdout.jsonl'),
          'utf8',
        ),
      ).resolves.toContain('nested-link-run');
    } finally {
      if (previousOutside === undefined) delete process.env.EVALUATION_OUTSIDE;
      else process.env.EVALUATION_OUTSIDE = previousOutside;
    }
  });

  test('cleans up same-group descendants after direct child exits', async () => {
    if (process.platform === 'win32') return;
    const cwd = join(root, 'descendant-cwd');
    const pidPath = join(root, 'descendant.pid');
    await import('node:fs/promises').then(({ mkdir }) => mkdir(cwd));
    const code = `const { spawn } = require('node:child_process'); const fs = require('node:fs'); const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"], { stdio: 'ignore' }); fs.writeFileSync(process.env.DESCENDANT_PID_FILE, String(child.pid)); process.stdin.resume(); process.stdin.on('end', () => setTimeout(() => process.exit(0), 20));`;
    const result = await runCommand({
      command: { executable: 'node', args: ['-e', code] },
      input: 'go',
      cwd,
      env: { ...process.env, DESCENDANT_PID_FILE: pidPath },
    });
    expect(result.exitCode).toBe(0);
    const pid = Number(await readFile(pidPath, 'utf8'));
    let alive = true;
    for (let attempt = 0; attempt < 30 && alive; attempt++) {
      try {
        process.kill(pid, 0);
      } catch {
        alive = false;
      }
      if (alive)
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    }
    if (alive) process.kill(pid, 'SIGKILL');
    expect(alive).toBe(false);
  });

  test('preserves multibyte UTF-8 split across stdout chunks', async () => {
    const cwd = join(root, 'utf8-cwd');
    await import('node:fs/promises').then(({ mkdir }) => mkdir(cwd));
    const code = `process.stdout.write(Buffer.from([0xe2])); setTimeout(() => process.stdout.write(Buffer.from([0x82])), 5); setTimeout(() => { process.stdout.write(Buffer.from([0xac])); process.exit(0); }, 10);`;
    const result = await runCommand({
      command: { executable: 'node', args: ['-e', code] },
      input: '',
      cwd,
    });
    expect(result.stdout).toBe('€');
  });

  test('cancellation during Pi version discovery marks the evaluation cancelled and terminates that process', async () => {
    const pidPath = join(root, 'version-cancel.pid');
    const previousPidPath = process.env.EVALUATION_VERSION_CANCEL_PID;
    process.env.EVALUATION_VERSION_CANCEL_PID = pidPath;
    await fake(`
if (process.argv.includes('--version')) {
  (await import('node:fs')).writeFileSync(process.env.EVALUATION_VERSION_CANCEL_PID, String(process.pid));
  setInterval(() => {}, 1000);
} else {
  process.stdin.resume();
  process.stdin.on('end', () => process.exit(0));
}`);
    const controller = new AbortController();
    try {
      const evaluation = evaluateModeling({
        ...options(),
        signal: controller.signal,
        versionTimeoutMs: 10_000,
      });
      await waitForFile(pidPath);
      controller.abort();
      const result = await evaluation;
      expect(result.cancelled).toBe(true);
      expect(result.status).toBe('cancelled');
      expect(result.exitCode).toBe(0);
      expect(result.signal).toBeNull();
      expect(result.manifest.process).toMatchObject({
        exitCode: 0,
        signal: null,
      });
      expect(isProcessAlive(Number(await readFile(pidPath, 'utf8')))).toBe(
        false,
      );
    } finally {
      if (previousPidPath === undefined)
        delete process.env.EVALUATION_VERSION_CANCEL_PID;
      else process.env.EVALUATION_VERSION_CANCEL_PID = previousPidPath;
    }
  });

  test('cancellation terminates the owned child process', async () => {
    await fake(
      `if (process.argv.includes('--version')) { console.log('fake'); process.exit(0); } setInterval(() => {}, 1000);`,
    );
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30);
    const result = await evaluateModeling({
      ...options(),
      signal: controller.signal,
    });
    expect(result.cancelled).toBe(true);
    expect(result.signal).not.toBeNull();
  });
});
