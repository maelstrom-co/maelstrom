import { describe, expect, test } from 'bun:test';
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  logVoiceDiagnostic,
  type VoiceDiagnostic,
  voiceDiagnosticConsumer,
} from '../apps/demo/e2e/voice/ci-diagnostics.ts';
import { runOwnedBenchmark } from './voice-benchmark-ci.ts';

const secret = 'provider-token-transcript-url-canary';
const credentials = {
  MAELSTROM_E2E_OPENAI_API_KEY: secret,
  ELEVENLABS_API_KEY: secret,
};
const metrics = {
  schemaVersion: 1,
  status: 'passed',
  assistant: { p95Ms: 1, samples: 1 },
  taskBargeIn: { p95Ms: 2, samples: 1 },
  greetingBargeIn: { p95Ms: 3, samples: 1 },
};
const event = {
  phase: 'docker-build',
  category: 'nonzero-exit',
  exitCode: 17,
} as const;
const record = `[voice-benchmark] ${JSON.stringify(event)}\n`;

async function runnerFixture(
  check: (
    root: string,
    logs: string[],
    run: (
      options?: Partial<Parameters<typeof runOwnedBenchmark>[0]>,
    ) => Promise<unknown>,
  ) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), 'voice-diagnostics-'));
  const logs: string[] = [];
  try {
    await mkdir(join(root, 'scripts'), { recursive: true });
    await writeFile(join(root, 'scripts/preview-lifecycle.bunfig.toml'), '');
    await mkdir(join(root, 'apps/demo/e2e/voice'), { recursive: true });
    await writeFile(join(root, 'apps/demo/e2e/voice/run-tests.ts'), '');
    await check(root, logs, (options) =>
      runOwnedBenchmark({
        root,
        runId: 'test-diagnostics',
        target: `https://example.invalid/${secret}`,
        environment: { ...credentials },
        signal: new AbortController().signal,
        cleanup: async () => {},
        log: (line) => logs.push(line),
        ...options,
      }),
    );
    expect(logs.join('\n')).not.toContain(secret);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeRunner(root: string, source: string) {
  await writeFile(join(root, 'apps/demo/e2e/voice/run-tests.ts'), source);
}

function metricWriter(value: unknown) {
  return `import { mkdirSync, writeFileSync } from 'node:fs'; mkdirSync('apps/demo/dist/docker-voice', { recursive: true }); writeFileSync('apps/demo/dist/docker-voice/voice-benchmark-metrics.json', ${JSON.stringify(JSON.stringify(value))});`;
}

describe('bounded voice diagnostic records', () => {
  test('accepts split records but never forwards raw, malformed, oversized, or incomplete output', () => {
    const logs: string[] = [];
    const consume = voiceDiagnosticConsumer((line) => logs.push(line));
    consume(`${secret}\n`);
    for (const invalid of [
      { ...event, message: secret },
      { ...event, phase: secret },
      { ...event, category: secret },
      { ...event, signal: secret },
      { ...event, credential: secret },
      { ...event, exitCode: secret },
      { ...event, exitCode: -1 },
      { ...event, exitCode: 256 },
      { ...event, exitCode: 1.5 },
      null,
      [event],
    ])
      consume(`[voice-benchmark] ${JSON.stringify(invalid)}\n`);
    consume('[voice-benchmark] {invalid}\n');
    consume('x'.repeat(100_000));
    consume(`${record}\n`);
    consume(record.slice(0, 20));
    consume(record.slice(20));
    consume(record.slice(0, -1));
    expect(logs).toEqual([record.trimEnd()]);
  });

  test('caps emitted records and validates direct emitters too', () => {
    const logs: string[] = [];
    voiceDiagnosticConsumer((line) => logs.push(line))(record.repeat(300));
    expect(logs).toHaveLength(256);
    logVoiceDiagnostic(
      { ...event, category: secret } as unknown as VoiceDiagnostic,
      (line) => logs.push(line),
    );
    expect(logs).toHaveLength(256);
  });
});

describe('owned benchmark diagnostics', () => {
  test('names missing credentials without their values and never launches', async () => {
    for (const credential of Object.keys(credentials)) {
      await runnerFixture(async (_root, logs, run) => {
        await expect(
          run({ environment: { ...credentials, [credential]: ' ' } }),
        ).rejects.toThrow('Missing');
        expect(logs.join('\n')).toContain(
          `"category":"missing-credential","credential":"${credential}"`,
        );
        expect(logs.some((line) => line.includes('"phase":"benchmark"'))).toBe(
          false,
        );
      });
    }
  });

  test('reports subprocess spawn failure and still attempts cleanup', async () => {
    await runnerFixture(async (root, logs, run) => {
      let cleaned = false;
      await expect(
        run({
          root: join(root, 'nonexistent'),
          cleanup: async () => {
            cleaned = true;
          },
        }),
      ).rejects.toThrow();
      expect(logs.join('\n')).toContain('"category":"spawn-failed"');
      expect(cleaned).toBe(true);
    });
  });

  test('keeps primary exit diagnostics when cleanup also fails, suppressing all raw output and errors', async () => {
    await runnerFixture(async (root, logs, run) => {
      await writeRunner(
        root,
        `console.log(${JSON.stringify(secret)}); console.error(${JSON.stringify(secret)}); console.log(${JSON.stringify(record.trim())}); console.log(${JSON.stringify(`[voice-benchmark] ${JSON.stringify({ ...event, message: secret })}`)}); process.exitCode = 23;`,
      );
      await expect(
        run({
          cleanup: async () => {
            throw new Error(secret);
          },
        }),
      ).rejects.toThrow();
      expect(logs).toContain(record.trim());
      const failure = logs.findIndex((line) => line.includes('"exitCode":23'));
      const cleanup = logs.findIndex((line) =>
        line.includes('"category":"cleanup-failed"'),
      );
      expect(failure).toBeGreaterThan(-1);
      expect(cleanup).toBeGreaterThan(failure);
    });
  });

  test('reports a signal exit without inventing an exit code', async () => {
    await runnerFixture(async (root, logs, run) => {
      await writeRunner(root, `process.kill(process.pid, 'SIGTERM');`);
      await expect(run()).rejects.toThrow();
      expect(logs.join('\n')).toContain(
        '"category":"signal-exit","signal":"SIGTERM"',
      );
    });
  });

  test('logs cancellation before launching, without exposing an abort reason', async () => {
    await runnerFixture(async (_root, logs, run) => {
      await expect(
        run({ signal: AbortSignal.abort(new Error(secret)) }),
      ).rejects.toThrow();
      expect(logs.join('\n')).toContain('"category":"cancelled"');
    });
  });

  for (const variant of [
    'missing',
    'malformed',
    'failed',
    'oversized',
    'valid',
  ]) {
    test(`classifies ${variant} metrics and cleans up without changing the numeric contract`, async () => {
      await runnerFixture(async (root, logs, run) => {
        if (variant !== 'missing') {
          let source = metricWriter(
            variant === 'valid'
              ? metrics
              : { status: 'failed', schemaVersion: 1, secret },
          );
          if (variant === 'malformed' || variant === 'oversized')
            source += `writeFileSync('apps/demo/dist/docker-voice/voice-benchmark-metrics.json', ${JSON.stringify(variant === 'malformed' ? secret : secret.repeat(400))});`;
          await writeRunner(root, source);
        }
        if (variant === 'valid') {
          expect(await run()).toEqual(metrics);
          expect(logs.join('\n')).toContain(
            '"phase":"metrics","category":"completed"',
          );
        } else {
          await expect(run()).rejects.toThrow();
          expect(logs.join('\n')).toContain(
            `"category":"metrics-${variant === 'missing' ? 'missing' : 'invalid'}"`,
          );
        }
        expect(logs.at(-1)).toContain(
          '"phase":"cleanup","category":"completed"',
        );
      });
    });
  }

  test('CLI deadline emits its category and cancels the in-flight request without logging its reason', async () => {
    await runnerFixture(async (root) => {
      const preload = join(root, 'preload.ts');
      await writeFile(
        preload,
        `const originalTimeout = globalThis.setTimeout; globalThis.setTimeout = (handler, ms, ...args) => originalTimeout(handler, ms === 20 * 60_000 ? 20 : ms, ...args); globalThis.fetch = (_input, init) => new Promise((_resolve, reject) => { const abort = () => reject(new Error(${JSON.stringify(secret)})); if (init.signal.aborted) abort(); else init.signal.addEventListener('abort', abort, { once: true }); });`,
      );
      const child = Bun.spawn(
        [
          process.execPath,
          '--config=scripts/preview-lifecycle.bunfig.toml',
          '--no-env-file',
          '--no-install',
          '--preload',
          preload,
          'scripts/voice-benchmark-ci.ts',
        ],
        {
          cwd: resolve(import.meta.dir, '..'),
          env: {
            MAELSTROM_VOICE_CI_RUN_ID: 'test-deadline',
            GITHUB_REPOSITORY: 'maelstrom-co/maelstrom',
            PR_NUMBER: '42',
            PREVIEW_WORKERS_DEV_SUFFIX: 'preview.workers.dev',
            GH_TOKEN: secret,
          },
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(code).toBe(1);
      expect(stdout).toContain('"category":"deadline-exceeded"');
      expect(stdout).toContain('"phase":"context","category":"cancelled"');
      expect(stdout + stderr).not.toContain(secret);
    });
  });

  test('forwards full framed Docker output, not unrelated child stdout/stderr or forged frames', async () => {
    await runnerFixture(async (root, logs, run) => {
      await copyFile(
        resolve(import.meta.dir, '../apps/demo/e2e/voice/docker-output.ts'),
        join(root, 'apps/demo/e2e/voice/docker-output.ts'),
      );
      const text = `${'full Docker output line\n'.repeat(5_000)}${secret}\nlast Docker line`;
      await writeRunner(
        root,
        `import { encodeDockerOutput, dockerOutputTokenEnvironment } from './docker-output.ts'; console.log('unrelated-runner-stdout'); console.error('unrelated-runner-stderr'); console.log(encodeDockerOutput({stdout: 'forged Docker output', stderr: ''}, '0'.repeat(64), {})); const frame = encodeDockerOutput({stdout: ${JSON.stringify(text)}, stderr: ${JSON.stringify('unknown Docker error\n::error::untrusted command')}}, process.env[dockerOutputTokenEnvironment], process.env); await new Promise((resolve, reject) => process.stdout.write(frame, error => error ? reject(error) : resolve())); process.exitCode = 125;`,
      );
      await expect(run()).rejects.toThrow();
      const all = logs.join('\n');
      expect(all).toContain(text.replaceAll(secret, '[REDACTED]'));
      expect(all).toContain('unknown Docker error\n::error::untrusted command');
      expect(all).not.toContain('unrelated-runner');
      expect(all).not.toContain('forged Docker output');
      expect(
        logs.filter((line) => line.startsWith('::stop-commands::')),
      ).toHaveLength(2);
    });
  });

  test('outer Docker cleanup prints failed output with known keys masked', async () => {
    await runnerFixture(async (root) => {
      await mkdir(join(root, 'bin'));
      const docker = join(root, 'bin/docker');
      await writeFile(
        docker,
        `#!${process.execPath}\nconsole.log('cleanup stdout: ' + process.env.GH_TOKEN); console.error('cleanup stderr: ' + process.env.ELEVENLABS_API_KEY); process.exitCode = 125;`,
      );
      await chmod(docker, 0o700);
      const child = Bun.spawn(
        [
          process.execPath,
          '--no-env-file',
          'scripts/voice-benchmark-ci.ts',
          'cleanup',
        ],
        {
          cwd: resolve(import.meta.dir, '..'),
          env: {
            PATH: join(root, 'bin'),
            MAELSTROM_VOICE_CI_RUN_ID: 'test-outer-cleanup',
            GH_TOKEN: secret,
            ELEVENLABS_API_KEY: secret,
          },
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(code).toBe(1);
      expect(stdout).toContain('cleanup stdout: [REDACTED]');
      expect(stdout).toContain('cleanup stderr: [REDACTED]');
      expect(stdout).toContain('::stop-commands::');
      expect(stdout + stderr).not.toContain(secret);
      expect(stdout).toContain('"category":"cleanup-failed"');
    });
  });

  test('CLI top-level failure stays safe and includes the failed phase', async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        '--config=scripts/preview-lifecycle.bunfig.toml',
        '--no-env-file',
        '--no-install',
        'scripts/voice-benchmark-ci.ts',
      ],
      {
        cwd: resolve(import.meta.dir, '..'),
        env: { MAELSTROM_VOICE_CI_RUN_ID: `invalid/${secret}` },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code).toBe(1);
    expect(stdout).toContain('"category":"invalid-run-id"');
    expect(stdout).toContain('"category":"unexpected-error"');
    expect(stderr).toContain('failed Docker command output above');
    expect(stdout + stderr).not.toContain(secret);
  });
});

async function prepareDockerRunner(root: string) {
  const voice = join(root, 'apps/demo/e2e/voice');
  for (const name of [
    'run-tests.ts',
    'ci-diagnostics.ts',
    'docker-output.ts',
    'benchmark-selection.ts',
    'tts-cache-dir.ts',
  ])
    await copyFile(
      resolve(import.meta.dir, '../apps/demo/e2e/voice', name),
      join(voice, name),
    );
  await mkdir(join(voice, 'tests/audio'), { recursive: true });
  for (const fixture of ['only-tasks', 'put-it-back', 'open-calendar'])
    await writeFile(join(voice, 'tests/audio', `${fixture}.txt`), secret);
  await mkdir(join(root, 'bin'));
}

describe('trusted Docker runner phase diagnostics', () => {
  test('Docker signal termination logs the signal without fabricating an exit code', async () => {
    const cache = await mkdtemp(join(tmpdir(), 'voice-diagnostic-cache-'));
    try {
      await runnerFixture(async (root, logs, run) => {
        await prepareDockerRunner(root);
        const docker = join(root, 'bin/docker');
        await writeFile(
          docker,
          `#!${process.execPath}\nconsole.error(${JSON.stringify(secret)}); process.kill(process.pid, 'SIGTERM');`,
        );
        await chmod(docker, 0o700);
        await expect(
          run({
            environment: {
              ...credentials,
              PATH: join(root, 'bin'),
              XDG_CACHE_HOME: cache,
            },
          }),
        ).rejects.toThrow();
        const events = logs
          .filter((line) => line.startsWith('[voice-benchmark] '))
          .map((line) => JSON.parse(line.slice('[voice-benchmark] '.length)));
        expect(logs.join('\n')).toContain('Failed Docker command stderr:');
        expect(logs.join('\n')).toContain('[REDACTED]');
        expect(events).toContainEqual({
          phase: 'fixtures',
          category: 'signal-exit',
          signal: 'SIGTERM',
        });
        expect(events).toContainEqual({
          phase: 'benchmark',
          category: 'nonzero-exit',
          exitCode: 1,
        });
      });
    } finally {
      await rm(cache, { recursive: true, force: true });
    }
  });
  test('missing Docker CLI remains spawn-failed, not a daemon hint', async () => {
    const cache = await mkdtemp(join(tmpdir(), 'voice-diagnostic-cache-'));
    try {
      await runnerFixture(async (root, logs, run) => {
        await prepareDockerRunner(root);
        await expect(
          run({
            environment: {
              ...credentials,
              PATH: join(root, 'bin'),
              XDG_CACHE_HOME: cache,
            },
          }),
        ).rejects.toThrow();
        expect(logs.join('\n')).toContain(
          '"phase":"fixtures","category":"spawn-failed"',
        );
        expect(logs.join('\n')).not.toContain('"category":"docker-failed"');
      });
    } finally {
      await rm(cache, { recursive: true, force: true });
    }
  });
  for (const [command, phase] of [
    ['run', 'fixtures'],
    ['build', 'docker-build'],
    ['create', 'docker-create'],
    ['start', 'docker-start'],
  ] as const) {
    test(`prints complete ${phase} Docker failure output with credentials masked`, async () => {
      const cache = await mkdtemp(join(tmpdir(), 'voice-diagnostic-cache-'));
      try {
        await runnerFixture(async (root, logs, run) => {
          await prepareDockerRunner(root);
          const docker = join(root, 'bin/docker');
          const exitCode = command === 'run' ? 125 : 17;
          const stderr =
            command === 'run'
              ? `docker: Error response from daemon: invalid mount config for type "bind": bind source path does not exist: /private/${secret}`
              : `Unrecognized Docker error for ${command}: ${secret}`;
          await writeFile(
            docker,
            `#!${process.execPath}\nimport { writeFileSync } from 'node:fs'; import { join, basename } from 'node:path'; const args = process.argv.slice(2); if (process.env.MAELSTROM_VOICE_DOCKER_OUTPUT_TOKEN) throw new Error('Docker inherited output token'); if (args[0] === ${JSON.stringify(command)}) { console.log('failure stdout: ' + ${JSON.stringify(secret)}); console.error(${JSON.stringify(stderr)}); if (args[0] === 'start') console.log('[voice-benchmark] {"phase":"tests","category":"test-failed"}'); process.exit(${exitCode}); } if (${JSON.stringify(command)} === 'start' && args[0] === 'rm') { console.error(${JSON.stringify(`Error response from daemon: no space left on device: /private/${secret}`)}); process.exit(17); } console.log('successful-docker-stdout'); console.error('successful-docker-stderr'); if (args[0] === 'run') { const mount = args.find(arg => arg.endsWith('dst=/work/audio')); const dir = mount.split(',src=')[1].split(',dst=')[0]; writeFileSync(join(dir, basename(args.at(-1))), 'wave'); }`,
          );
          await chmod(docker, 0o700);
          await expect(
            run({
              environment: {
                ...credentials,
                PATH: join(root, 'bin'),
                XDG_CACHE_HOME: cache,
              },
            }),
          ).rejects.toThrow();
          expect(logs.join('\n')).toContain(
            `"phase":"${phase}","category":"started"`,
          );
          expect(logs.join('\n')).toContain(
            `"phase":"${phase}","category":"nonzero-exit","exitCode":${exitCode}`,
          );
          expect(logs.join('\n')).toContain('failure stdout: [REDACTED]');
          expect(logs.join('\n')).toContain(
            stderr.replaceAll(secret, '[REDACTED]'),
          );
          expect(logs.join('\n')).not.toContain('successful-docker-stdout');
          expect(logs.join('\n')).not.toContain('successful-docker-stderr');
          expect(logs.join('\n')).not.toContain('Preparing voice fixture:');
          expect(logs.join('\n')).not.toContain(
            'Docker inherited output token',
          );
          expect(logs.join('\n')).not.toContain('"category":"docker-failed"');
          if (command === 'start') {
            expect(logs.join('\n')).toContain(
              'Error response from daemon: no space left on device: /private/[REDACTED]',
            );
            expect(logs.join('\n')).toContain(
              '"phase":"tests","category":"test-failed"',
            );
            expect(logs.join('\n')).toContain(
              '"phase":"cleanup","category":"cleanup-failed"',
            );
            const cleanupOutcomes = logs.filter(
              (line) =>
                line.includes('"phase":"cleanup"') &&
                (line.includes('"category":"cleanup-failed"') ||
                  line.includes('"category":"completed"')),
            );
            expect(cleanupOutcomes[0]).toContain('"category":"cleanup-failed"');
          }
          expect(await readFile(docker, 'utf8')).toContain(secret);
        });
      } finally {
        await rm(cache, { recursive: true, force: true });
      }
    });
  }
});
