import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(project, 'node_modules/alchemy/bin/cli.js');
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture(
  empty = false,
  resourceOutput = true,
  options: {
    diagnostics?: boolean;
    fail?: 'acquisition' | 'lazy' | 'read';
    rejectAcquisition?: boolean;
  } = {},
) {
  await mkdir(join(project, '.alchemy'), { recursive: true });
  const cwd = await mkdtemp(join(project, '.alchemy', 'cli-test-'));
  directories.push(cwd);
  await mkdir(join(cwd, '.alchemy'));
  await writeFile(
    join(cwd, '.alchemy/version-check.json'),
    JSON.stringify({ checkedAt: Date.now() }),
  );
  await writeFile(
    join(cwd, 'guard.ts'),
    `
import { appendFileSync } from 'node:fs';
globalThis.fetch = (input) => {
  appendFileSync(${JSON.stringify(join(cwd, 'calls.ndjson'))}, JSON.stringify({ operation: 'network', url: String(input) }) + '\\n');
  throw new Error('Cloud calls are forbidden in the offline CLI test');
};
`,
  );
  await writeFile(join(cwd, 'bunfig.toml'), 'preload = ["./guard.ts"]\n');
  await writeFile(
    join(cwd, 'fixture.env'),
    'CLI_STATE_MARKER=from-env-file\nALCHEMY_PROFILE=env-profile\n',
  );
  const entrypoint = (name: string) => `
import { appendFileSync } from 'node:fs';
import * as Alchemy from 'alchemy';
import { State } from 'alchemy/State';
import { Stage } from 'alchemy/Stage';
import * as Interaction from 'alchemy/Interaction';
import * as Config from 'effect/Config';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Redacted from 'effect/Redacted';
const record = (operation: string, request?: unknown) => appendFileSync(${JSON.stringify(join(cwd, 'calls.ndjson'))}, JSON.stringify({ operation, request }) + '\\n');
const forbidden = () => Effect.die(new Error('Mutating state is forbidden'));
const diagnostic = (phase: string) => Effect.gen(function* () {
  if (!${options.diagnostics ?? false}) return;
  yield* (yield* Interaction.Interaction).task({ label: phase + ' task' }, Effect.void);
  yield* Interaction.accessors.output.info(phase + ' info');
  yield* Interaction.accessors.output.warning(phase + ' warning');
  yield* Effect.logInfo(phase + ' log-info');
  yield* Effect.logWarning(phase + ' log-warning');
  if (${JSON.stringify(options.fail ?? '')} === phase || (${JSON.stringify(options.fail ?? '')} === 'read' && ['get', 'listStacks'].includes(phase))) {
    return yield* Effect.fail(new Error('offline-state-failure'));
  }
});
const state = Layer.effect(State, Effect.gen(function* () {
  if (${options.rejectAcquisition ?? false}) return yield* Effect.die(new Error('Configured State acquisition is forbidden in local mode'));
  yield* diagnostic('acquisition');
  const profile = yield* Config.String('ALCHEMY_PROFILE');
  const marker = yield* Config.String('CLI_STATE_MARKER');
  const stage = yield* Stage;
  const value = { attr: { workerName: 'preview-worker' }, profile, marker, stage, entrypoint: '${name}', secret: Redacted.make('offline-secret') };
  const context = yield* Effect.context<never>();
  return Effect.gen(function* () {
    yield* diagnostic('lazy');
    return {
    id: 'offline-test',
    getVersion: () => Effect.succeed(5),
    listStacks: () => diagnostic('listStacks').pipe(Effect.andThen(Effect.sync(() => { record('listStacks'); return ${empty ? '[]' : "['Zulu', 'MaelstromDemoPreview', 'Alpha']"}; }))),
    listStages: () => Effect.succeed(['prod']),
    list: () => Effect.succeed(${resourceOutput ? "['Website', 'nested/Website', 'output']" : "['Website', 'nested/Website']"}),
    get: (request: { stack: string; stage: string; fqn: string }) => diagnostic('get').pipe(Effect.andThen(Effect.sync(() => {
      record('get', request);
      return request.fqn === 'Missing' ? undefined : { ...value, fqn: request.fqn };
    }))),
    getOutput: () => Effect.sync(() => { record('getOutput'); return { native: 'stack-output' }; }),
    getReplacedResources: () => Effect.succeed([]),
    set: forbidden,
    setOutput: forbidden,
    delete: forbidden,
    deleteStack: forbidden,
    };
  }).pipe(Effect.provideContext(context));
}));
export default Alchemy.Stack('OfflineCli', { providers: Layer.empty, state }, Effect.void);
`;
  await writeFile(join(cwd, 'alchemy.run.ts'), entrypoint('default'));
  await writeFile(join(cwd, 'state.run.ts'), entrypoint('explicit'));
  await writeFile(join(cwd, 'calls.ndjson'), '');
  const run = async (
    argv: string[],
    fromEnvFile = false,
    workingDirectory = cwd,
  ) => {
    await mkdir(join(workingDirectory, '.alchemy'), { recursive: true });
    await writeFile(
      join(workingDirectory, '.alchemy/version-check.json'),
      JSON.stringify({ checkedAt: Date.now() }),
    );
    await writeFile(
      join(workingDirectory, 'bunfig.toml'),
      `preload = [${JSON.stringify(join(cwd, 'guard.ts'))}]\n`,
    );
    const child = Bun.spawn([process.execPath, cli, ...argv], {
      cwd: workingDirectory,
      env: {
        PATH: process.env.PATH,
        HOME: cwd,
        TMPDIR: cwd,
        CI: 'true',
        NO_TRACK: 'true',
        ...(!fromEnvFile && {
          ALCHEMY_PROFILE: 'ambient-profile',
          CLI_STATE_MARKER: 'ambient-marker',
        }),
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect({ code, stdout, stderr }).toMatchObject({
      code: options.fail ? 1 : 0,
    });
    if (!options.diagnostics) expect(stderr).toBe('');
    const calls = (await readFile(join(cwd, 'calls.ndjson'), 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    expect(calls.filter(({ operation }) => operation === 'network')).toEqual(
      [],
    );
    return { stdout, stderr, calls };
  };
  return { cwd, run };
}

const legacyGet = (fqn = 'Website') => [
  'state',
  'get',
  'alchemy.run.ts',
  '--stack',
  'MaelstromDemoPreview',
  '--stage',
  'prod',
  '--fqn',
  fqn,
  '--profile',
  'preview-ci',
];

function expectDiagnostics(stderr: string, phases: string[]) {
  for (const phase of phases) {
    for (const message of [
      'task',
      'info',
      'warning',
      'log-info',
      'log-warning',
    ]) {
      expect(stderr).toContain(`${phase} ${message}`);
    }
  }
}

describe('published Alchemy CLI legacy state reads', () => {
  test('routes noisy acquisition, lazy initialization and reads away from exact preview JSON stdout', async () => {
    const { run, cwd } = await fixture(false, true, { diagnostics: true });
    const appDirectory = join(cwd, 'apps/demo');
    const infraDirectory = join(cwd, 'infra/platform');
    await mkdir(appDirectory, { recursive: true });
    await mkdir(infraDirectory, { recursive: true });
    await writeFile(
      join(infraDirectory, 'state.run.ts'),
      await readFile(join(cwd, 'state.run.ts')),
    );
    const { stdout, stderr } = await run(
      [
        'state',
        'get',
        '../../infra/platform/state.run.ts',
        '--stack',
        'MaelstromDemoPreview',
        '--stage',
        'pr-261',
        '--fqn',
        'Website',
        '--profile',
        'preview-ci',
      ],
      false,
      appDirectory,
    );
    expect(JSON.parse(stdout)).toMatchObject({
      attr: { workerName: 'preview-worker' },
    });
    expectDiagnostics(stderr, ['acquisition', 'lazy', 'get']);
  });

  test('preserves missing-resource stdout while retaining all diagnostics on stderr', async () => {
    const { run } = await fixture(false, true, { diagnostics: true });
    const { stdout, stderr } = await run(legacyGet('Missing'));
    expect(stdout).toBe('(not found: MaelstromDemoPreview/prod/Missing)\n');
    expectDiagnostics(stderr, ['acquisition', 'lazy', 'get']);
  });

  test('preserves sorted stack stdout while retaining all diagnostics on stderr', async () => {
    const { run } = await fixture(false, true, { diagnostics: true });
    const { stdout, stderr } = await run([
      'state',
      'stacks',
      'state.run.ts',
      '--profile',
      'maelstrom-production-env',
    ]);
    expect(stdout).toBe('Alpha\nMaelstromDemoPreview\nZulu\n');
    expectDiagnostics(stderr, ['acquisition', 'lazy', 'listStacks']);
  });

  test('preserves empty stack stdout while retaining all diagnostics on stderr', async () => {
    const { run } = await fixture(true, true, { diagnostics: true });
    const { stdout, stderr } = await run([
      'state',
      'stacks',
      'state.run.ts',
      '--profile',
      'maelstrom-production-env',
    ]);
    expect(stdout).toBe('(no stacks)\n');
    expectDiagnostics(stderr, ['acquisition', 'lazy', 'listStacks']);
  });

  for (const command of ['get', 'stacks'] as const) {
    test.each([
      'acquisition',
      'lazy',
      'read',
    ] as const)(`propagates %s failures from ${command} without printing a successful state result`, async (fail) => {
      const argv =
        command === 'get'
          ? legacyGet()
          : ['state', 'stacks', 'state.run.ts', '--profile', 'preview-ci'];
      const { run } = await fixture(false, true, { diagnostics: true, fail });
      const { stdout, stderr, calls } = await run(argv);
      expect(stdout).not.toContain('workerName');
      expect(stdout).not.toContain('Alpha\nMaelstromDemoPreview\nZulu');
      expect(stdout + stderr).toContain('offline-state-failure');
      expectDiagnostics(
        stderr,
        fail === 'acquisition' ? ['acquisition'] : ['acquisition', 'lazy'],
      );
      expect(calls).toEqual([]);
    });
  }

  test('reads deployment state with the legacy flag grammar', async () => {
    const { run } = await fixture();
    const { stdout, calls } = await run(legacyGet());
    expect(JSON.parse(stdout)).toEqual({
      attr: { workerName: 'preview-worker' },
      profile: 'preview-ci',
      marker: 'ambient-marker',
      stage: 'placeholder',
      entrypoint: 'default',
      secret: { __redacted__: 'offline-secret' },
      fqn: 'Website',
    });
    expect(calls).toEqual([
      {
        operation: 'get',
        request: {
          stack: 'MaelstromDemoPreview',
          stage: 'prod',
          fqn: 'Website',
        },
      },
    ]);
  });

  test('reads with the exact trusted preview argv and relative entrypoint', async () => {
    const { run, cwd } = await fixture();
    const appDirectory = join(cwd, 'apps/demo');
    const infraDirectory = join(cwd, 'infra/platform');
    await mkdir(appDirectory, { recursive: true });
    await mkdir(infraDirectory, { recursive: true });
    await writeFile(
      join(infraDirectory, 'state.run.ts'),
      await readFile(join(cwd, 'state.run.ts')),
    );
    const { stdout, calls } = await run(
      [
        'state',
        'get',
        '../../infra/platform/state.run.ts',
        '--stack',
        'MaelstromDemoPreview',
        '--stage',
        'pr-261',
        '--fqn',
        'Website',
        '--profile',
        'preview-ci',
      ],
      false,
      appDirectory,
    );
    expect(JSON.parse(stdout)).toMatchObject({
      entrypoint: 'explicit',
      profile: 'preview-ci',
      fqn: 'Website',
    });
    expect(calls).toEqual([
      {
        operation: 'get',
        request: {
          stack: 'MaelstromDemoPreview',
          stage: 'pr-261',
          fqn: 'Website',
        },
      },
    ]);
  });

  test('uses the ambient profile when the profile flag is absent', async () => {
    const ambient = await fixture();
    const argv = legacyGet().slice(0, -2);
    expect(JSON.parse((await ambient.run(argv)).stdout).profile).toBe(
      'ambient-profile',
    );
  });

  test('uses the env-file profile when the profile flag is absent', async () => {
    const dotenv = await fixture();
    const argv = legacyGet().slice(0, -2);
    expect(
      JSON.parse(
        (await dotenv.run([...argv, '--env-file', 'fixture.env'], true)).stdout,
      ),
    ).toMatchObject({ profile: 'env-profile', marker: 'from-env-file' });
  });

  test('defaults the entrypoint and keeps nested FQNs intact', async () => {
    const { run } = await fixture();
    const argv = legacyGet('nested/Website');
    argv.splice(2, 1);
    const { stdout } = await run(argv);
    expect(JSON.parse(stdout)).toMatchObject({
      entrypoint: 'default',
      fqn: 'nested/Website',
    });
  });

  test('preserves the exact missing-resource message', async () => {
    const { run } = await fixture();
    expect((await run(legacyGet('Missing'))).stdout).toBe(
      '(not found: MaelstromDemoPreview/prod/Missing)\n',
    );
  });

  test('routes the explicit entrypoint, profile and env file', async () => {
    const { run } = await fixture();
    const argv = legacyGet('output');
    argv[2] = 'state.run.ts';
    const { stdout, calls } = await run(
      [...argv, '--env-file', 'fixture.env'],
      true,
    );
    expect(JSON.parse(stdout)).toMatchObject({
      entrypoint: 'explicit',
      profile: 'preview-ci',
      marker: 'from-env-file',
      fqn: 'output',
    });
    expect(calls[0].operation).toBe('get');
  });

  test('preserves the runbook stacks command and sorted legacy output', async () => {
    const { run } = await fixture();
    expect(
      (
        await run([
          'state',
          'stacks',
          'state.run.ts',
          '--profile',
          'maelstrom-production-env',
        ])
      ).stdout,
    ).toBe('Alpha\nMaelstromDemoPreview\nZulu\n');
  });

  test('lists local stacks without opening the configured store', async () => {
    const { run } = await fixture(false, true, { rejectAcquisition: true });
    const { stdout, calls } = await run([
      'state',
      'stacks',
      'state.run.ts',
      '--profile',
      'maelstrom-production-env',
      '--local',
    ]);
    expect(stdout).toBe('(no stacks)\n');
    expect(calls).toEqual([]);
  });

  test('preserves the empty stack-list message', async () => {
    const { run } = await fixture(true);
    expect(
      (await run(['state', 'stacks', '--profile', 'preview-ci'])).stdout,
    ).toBe('(no stacks)\n');
  });

  test('reads local state without opening the configured store', async () => {
    const { run, cwd } = await fixture(false, true, {
      rejectAcquisition: true,
    });
    const stateDirectory = join(
      cwd,
      '.alchemy/state/MaelstromDemoPreview/prod',
    );
    await mkdir(stateDirectory, { recursive: true });
    const stateFile = join(stateDirectory, 'Website.json');
    const contents = JSON.stringify({ attr: { workerName: 'local-worker' } });
    await writeFile(stateFile, contents);
    const { stdout, calls } = await run([...legacyGet(), '--local']);
    expect(JSON.parse(stdout)).toEqual({
      attr: { workerName: 'local-worker' },
    });
    expect(await readFile(stateFile, 'utf8')).toBe(contents);
    expect(calls).toEqual([]);
  });

  test('keeps native cat and its reserved output semantics', async () => {
    const { run } = await fixture(false, false);
    const { stdout, calls } = await run([
      'state',
      'cat',
      'MaelstromDemoPreview/prod/output',
      '--config',
      'state.run.ts',
      '--profile',
      'preview-ci',
    ]);
    expect(JSON.parse(stdout)).toEqual({ native: 'stack-output' });
    expect(calls).toEqual([{ operation: 'getOutput' }]);
  });
});
