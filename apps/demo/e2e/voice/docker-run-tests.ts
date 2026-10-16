import { spawn } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectVoiceBenchmark } from './benchmark-selection.ts';
import { checkPort, forwardPort } from './forward.ts';
import { resolveRunnerTarget } from './runner-target.ts';

process.umask(0o077);

const root = dirname(fileURLToPath(import.meta.url));
const target = resolveRunnerTarget(process.env.MAELSTROM_BASE_URL);
const upstream = process.env.MAELSTROM_HOST || 'host.docker.internal';
const appPort = Number(process.env.MAELSTROM_APP_PORT ?? 3000);
const wsPort = Number(process.env.MAELSTROM_WS_PORT ?? 3001);
const forwards: Awaited<ReturnType<typeof forwardPort>>[] = [];
let child: ReturnType<typeof spawn> | undefined;
let signalCode: number | undefined;
let stopTimer: NodeJS.Timeout | undefined;
const shutdown = (signal: NodeJS.Signals) => {
  signalCode = signal === 'SIGINT' ? 130 : 143;
  if (child) {
    child.kill('SIGTERM');
    stopTimer ??= setTimeout(() => child?.kill('SIGKILL'), 3000);
    stopTimer.unref();
  }
};
const sigint = () => shutdown('SIGINT');
const sigterm = () => shutdown('SIGTERM');
process.on('SIGINT', sigint);
process.on('SIGTERM', sigterm);

const benchmark = process.argv.includes('--benchmark');
const benchmarkSelection = benchmark
  ? selectVoiceBenchmark({
      singleTurn: process.env.VOICE_BENCHMARK_SINGLE_TURN,
      repetitions: process.env.VOICE_BENCHMARK_REPETITIONS,
    })
  : undefined;

try {
  const requiredFixtures = ['only-tasks', 'put-it-back', 'open-calendar'];
  const missingFixtures: string[] = [];
  for (const fixture of requiredFixtures) {
    try {
      await access(join(root, 'audio', `${fixture}.wav`));
    } catch {
      missingFixtures.push(`${fixture}.wav`);
    }
  }
  if (missingFixtures.length)
    throw new Error(
      `Missing prepared voice fixtures: ${missingFixtures.join(', ')}. Mount all fixtures at /work/maelstrom/audio (read-only).`,
    );
  if (!process.env.PULSE_SERVER)
    throw new Error(
      'Private PulseAudio is missing; retain the image entrypoint.',
    );
  if (target.mode === 'local') {
    for (const [localPort, targetPort] of [
      [3000, appPort],
      [3001, wsPort],
    ]) {
      if (signalCode) throw new Error('Interrupted');
      await checkPort(upstream, targetPort);
      forwards.push(
        await forwardPort({
          host: upstream,
          targetPort,
          listenPort: localPort,
        }),
      );
      // Chromium may resolve localhost to IPv6 before IPv4. Both remain loopback-only.
      try {
        forwards.push(
          await forwardPort({
            host: upstream,
            targetPort,
            listenPort: localPort,
            bind: '::1',
          }),
        );
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(
            (error as NodeJS.ErrnoException).code ?? '',
          )
        )
          throw error;
      }
    }
  }
  let response: Response;
  try {
    response = await fetch(
      target.mode === 'local' ? target.browserURL : target.readinessURL,
      { signal: AbortSignal.timeout(15000) },
    );
  } catch {
    throw new Error(
      target.mode === 'local'
        ? 'Maelstrom HTTP readiness request failed.'
        : 'Configured target HTTP readiness request failed.',
    );
  }
  await response.body?.cancel();
  if (!response.ok)
    throw new Error(`Maelstrom HTTP readiness failed: ${response.status}`);
  const pkg = JSON.parse(
    await readFile(
      join(root, 'node_modules/@playwright/test/package.json'),
      'utf8',
    ),
  );
  await mkdir('/work/artifacts', { recursive: true });
  await writeFile(
    '/work/artifacts/runner.json',
    JSON.stringify(
      {
        node: process.version,
        architecture: process.arch,
        playwright: pkg.version,
        mode: target.mode,
        ...(target.mode === 'local' ? { upstream } : {}),
        ...(benchmarkSelection
          ? {
              benchmark: {
                mode: benchmarkSelection.singleTurn
                  ? 'single-turn'
                  : 'full-scenario-suite',
                repetitions: benchmarkSelection.repetitions,
                selectedScenario: benchmarkSelection.selectedScenario,
              },
            }
          : {}),
        browserURL:
          target.mode === 'local' ? target.browserURL : target.metadataURL,
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(
    `${target.mode === 'local' ? 'Host app' : 'Configured target'} reachable; running Chromium, microphone injection and reply recording in Docker.`,
  );
  if (signalCode) throw new Error('Interrupted');
  const playwright = spawn(
    process.execPath,
    [
      join(root, 'node_modules/@playwright/test/cli.js'),
      'test',
      '--config',
      join(
        root,
        benchmark
          ? 'playwright.benchmark.config.ts'
          : 'playwright.voice.config.ts',
      ),
      '--output',
      benchmark
        ? '/work/artifacts/benchmark-results'
        : '/work/artifacts/playwright',
      benchmark && process.env.MAELSTROM_VOICE_CI_RUN_ID
        ? `--reporter=line,html,${join(root, 'ci-reporter.ts')}`
        : '--reporter=line,html',
      ...process.argv.slice(2).filter((argument) => argument !== '--benchmark'),
    ],
    {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, MAELSTROM_BASE_URL: target.browserURL },
    },
  );
  child = playwright;
  const code = await new Promise<number>((resolve, reject) => {
    playwright.once('error', reject);
    playwright.once('close', (code, signal) =>
      resolve(code ?? (signal ? 1 : 0)),
    );
  });
  process.exitCode = signalCode || code;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = signalCode || 1;
} finally {
  if (stopTimer) clearTimeout(stopTimer);
  process.removeListener('SIGINT', sigint);
  process.removeListener('SIGTERM', sigterm);
  await Promise.all(forwards.map((forward) => forward.close()));
}
