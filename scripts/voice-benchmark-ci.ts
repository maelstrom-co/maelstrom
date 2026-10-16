import { spawn } from 'node:child_process';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  readCiMetrics,
  type VoiceCiMetrics,
} from '../apps/demo/e2e/voice/ci-metrics.ts';
import {
  type PreviewGithubDependencies,
  readVoiceBenchmarkContext,
  saveVoiceBenchmarkComment,
  VOICE_BENCHMARK_MARKER,
  type VoiceBenchmarkContext,
  type VoiceBenchmarkOptions,
} from './preview-lifecycle.ts';

type Claim = {
  readonly sha: string;
  readonly requestId: number;
  readonly status: 'started' | 'completed' | 'failed';
};

export function parseVoiceClaim(body: string | undefined): Claim | undefined {
  if (body === undefined) return undefined;
  const matches = [
    ...body.matchAll(/<!-- voice-benchmark-state (\{[^\n]*\}) -->/g),
  ];
  if (body.split(VOICE_BENCHMARK_MARKER).length !== 2 || matches.length !== 1)
    throw new Error('Invalid benchmark claim');
  const value: unknown = JSON.parse(matches[0]?.[1] ?? '');
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid benchmark claim');
  const claim = value as Record<string, unknown>;
  if (
    Object.keys(claim).length !== 3 ||
    typeof claim.sha !== 'string' ||
    !/^[a-f0-9]{40}$/.test(claim.sha) ||
    typeof claim.requestId !== 'number' ||
    !Number.isSafeInteger(claim.requestId) ||
    claim.requestId < 1 ||
    !['started', 'completed', 'failed'].includes(String(claim.status))
  )
    throw new Error('Invalid benchmark claim');
  return {
    sha: claim.sha,
    requestId: claim.requestId,
    status: claim.status as Claim['status'],
  };
}

export function renderVoiceComment(
  claim: Claim,
  metrics?: VoiceCiMetrics,
): string {
  const row = (name: string, metric?: { p95Ms: number; samples: number }) =>
    `| ${name} | ${metric ? `${metric.p95Ms.toFixed(1)} ms` : 'N/A'} | ${metric?.samples ?? '—'} |`;
  return `${VOICE_BENCHMARK_MARKER}\n<!-- voice-benchmark-state ${JSON.stringify(claim)} -->\n### Voice latency · \`${claim.sha.slice(0, 12)}\`\n\n| Metric | p95 | Samples |\n| --- | ---: | ---: |\n${row('Assistant response', metrics?.assistant)}\n${row('Barge-in: task response', metrics?.taskBargeIn)}\n${row('Barge-in: greeting', metrics?.greetingBargeIn)}\n\nStatus: ${claim.status}.`;
}

export interface VoiceCiDependencies extends PreviewGithubDependencies {
  readonly run: (
    context: VoiceBenchmarkContext,
    signal: AbortSignal,
  ) => Promise<unknown>;
  readonly sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

const sameRequest = (
  left: VoiceBenchmarkContext | undefined,
  right: VoiceBenchmarkContext,
) =>
  !!left &&
  left.sha === right.sha &&
  left.url === right.url &&
  left.requestId === right.requestId;
const ownsClaim = (
  context: VoiceBenchmarkContext | undefined,
  expected: VoiceBenchmarkContext,
) => {
  if (!sameRequest(context, expected)) return false;
  const claim = parseVoiceClaim(context?.comment?.body);
  return (
    claim?.sha === expected.sha &&
    claim.requestId === expected.requestId &&
    claim.status === 'started'
  );
};

export async function executeVoiceBenchmark(
  options: VoiceBenchmarkOptions,
  dependencies: VoiceCiDependencies,
  signal: AbortSignal,
): Promise<'passed' | 'failed' | 'skipped'> {
  const github = (extra?: AbortSignal): PreviewGithubDependencies => ({
    ...dependencies,
    signal: AbortSignal.any([
      signal,
      AbortSignal.timeout(15_000),
      ...(extra ? [extra] : []),
    ]),
  });
  const initial = await readVoiceBenchmarkContext(options, github());
  if (!initial) return 'skipped';
  const previous = parseVoiceClaim(initial.comment?.body);
  if (previous && previous.requestId > initial.requestId)
    throw new Error('Incomplete benchmark request history');
  if (previous?.sha === initial.sha && previous.requestId === initial.requestId)
    return 'skipped';
  const claim: Claim = {
    sha: initial.sha,
    requestId: initial.requestId,
    status: 'started',
  };
  await saveVoiceBenchmarkComment(
    options,
    initial,
    renderVoiceComment(claim),
    github(),
  );
  const claimed = await readVoiceBenchmarkContext(options, github());
  if (!ownsClaim(claimed, initial) || !claimed)
    throw new Error('Benchmark claim was not persisted');
  const stopMonitor = new AbortController();
  const monitorSignal = AbortSignal.any([signal, stopMonitor.signal]);
  const revoke = new AbortController();
  let stale = false;
  const monitor = (async () => {
    let consecutiveFailures = 0;
    while (!monitorSignal.aborted) {
      await dependencies.sleep(30_000, monitorSignal);
      if (monitorSignal.aborted) return;
      let owned: boolean;
      try {
        owned = ownsClaim(
          await readVoiceBenchmarkContext(options, github(monitorSignal)),
          claimed,
        );
        consecutiveFailures = 0;
      } catch {
        if (monitorSignal.aborted) return;
        consecutiveFailures++;
        if (consecutiveFailures < 3) continue;
        owned = false;
      }
      if (monitorSignal.aborted) return;
      if (!owned) {
        stale = true;
        revoke.abort();
        return;
      }
    }
  })().catch(() => {
    if (!monitorSignal.aborted) {
      stale = true;
      revoke.abort();
    }
  });
  let metrics: VoiceCiMetrics | undefined;
  try {
    metrics = readCiMetrics(
      await dependencies.run(claimed, AbortSignal.any([signal, revoke.signal])),
    );
  } catch {
    metrics = undefined;
  } finally {
    stopMonitor.abort();
    await monitor;
  }
  if (stale || signal.aborted) return 'failed';
  const current = await readVoiceBenchmarkContext(options, github());
  if (
    !ownsClaim(current, claimed) ||
    !current ||
    current.comment?.id !== claimed.comment?.id ||
    current.comment?.body !== claimed.comment?.body
  )
    return 'failed';
  const status = metrics ? 'completed' : 'failed';
  await saveVoiceBenchmarkComment(
    options,
    current,
    renderVoiceComment({ ...claim, status }, metrics),
    github(),
  );
  return metrics ? 'passed' : 'failed';
}

export function validateVoiceRunId(value: string): string {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(value))
    throw new Error('Invalid voice CI run identity');
  return value;
}

async function docker(args: string[]): Promise<string> {
  const child = Bun.spawn(['docker', ...args], {
    stdout: 'pipe',
    stderr: 'ignore',
  });
  const text = new Response(child.stdout).text();
  const timer = setTimeout(() => child.kill(9), 15_000);
  try {
    if ((await child.exited) !== 0)
      throw new Error('Owned Docker cleanup failed');
    return await text;
  } finally {
    clearTimeout(timer);
  }
}

export async function cleanupVoiceContainers(
  runId: string,
  command: (args: string[]) => Promise<string> = docker,
): Promise<void> {
  validateVoiceRunId(runId);
  const ids = (
    await command([
      'ps',
      '-aq',
      '--filter',
      `label=maelstrom.voice.ci=${runId}`,
    ])
  )
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (ids.some((id) => !/^[a-f0-9]{12,64}$/.test(id)))
    throw new Error('Invalid owned Docker identity');
  if (ids.length) await command(['rm', '--force', ...ids]);
}

export async function runOwnedBenchmark(options: {
  readonly root: string;
  readonly runId: string;
  readonly target: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly signal: AbortSignal;
  readonly cleanup?: (runId: string) => Promise<void>;
  readonly terminationGraceMs?: number;
}): Promise<unknown> {
  validateVoiceRunId(options.runId);
  for (const name of ['MAELSTROM_E2E_OPENAI_API_KEY', 'ELEVENLABS_API_KEY'])
    if (!options.environment[name]?.trim())
      throw new Error('Missing voice benchmark credential');
  const environment: NodeJS.ProcessEnv = {};
  for (const name of [
    'PATH',
    'HOME',
    'TMPDIR',
    'XDG_CACHE_HOME',
    'CI',
    'ELEVENLABS_VOICE_ID',
    'ELEVENLABS_API_KEY',
    'MAELSTROM_E2E_OPENAI_API_KEY',
  ])
    if (options.environment[name])
      environment[name] = options.environment[name];
  Object.assign(environment, {
    MAELSTROM_BASE_URL: options.target,
    MAELSTROM_VOICE_CI_RUN_ID: options.runId,
    VOICE_BENCHMARK_REPETITIONS: '1',
    NX_NO_CLOUD: 'true',
  });
  options.signal.throwIfAborted();
  const child = spawn(
    process.execPath,
    [
      '--config=scripts/preview-lifecycle.bunfig.toml',
      '--no-env-file',
      '--no-install',
      'apps/demo/e2e/voice/run-tests.ts',
      '--benchmark',
    ],
    { cwd: options.root, env: environment, stdio: 'ignore', detached: true },
  );
  const killGroup = (signal: NodeJS.Signals) => {
    if (!child.pid) return;
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  };
  let hardKill: ReturnType<typeof setTimeout> | undefined;
  const abort = () => {
    killGroup('SIGTERM');
    hardKill ??= setTimeout(
      () => killGroup('SIGKILL'),
      options.terminationGraceMs ?? 5_000,
    );
  };
  options.signal.addEventListener('abort', abort, { once: true });
  if (options.signal.aborted) abort();
  try {
    const code = await new Promise<number>((resolveExit, reject) => {
      child.once('error', reject);
      child.once('close', (code) => resolveExit(code ?? 1));
    });
    if (code !== 0 || options.signal.aborted)
      throw new Error('Voice benchmark failed');
    const file = resolve(
      options.root,
      'apps/demo/dist/docker-voice/voice-benchmark-metrics.json',
    );
    const stat = await lstat(file);
    const expected = resolve(
      await realpath(resolve(options.root, 'apps/demo/dist/docker-voice')),
      'voice-benchmark-metrics.json',
    );
    if (
      (await realpath(file)) !== expected ||
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size > 4096
    )
      throw new Error('Invalid CI metrics file');
    return readCiMetrics(JSON.parse(await readFile(file, 'utf8')));
  } finally {
    options.signal.removeEventListener('abort', abort);
    if (hardKill) clearTimeout(hardKill);
    try {
      killGroup('SIGKILL');
    } finally {
      await (options.cleanup ?? cleanupVoiceContainers)(options.runId);
    }
  }
}

async function cli() {
  const runId = validateVoiceRunId(process.env.MAELSTROM_VOICE_CI_RUN_ID ?? '');
  if (Bun.argv[2] === 'cleanup') {
    await cleanupVoiceContainers(runId);
    return;
  }
  const abort = new AbortController();
  const interrupt = () => abort.abort();
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  const deadline = setTimeout(interrupt, 20 * 60_000);
  try {
    const result = await executeVoiceBenchmark(
      {
        repository: process.env.GITHUB_REPOSITORY ?? '',
        prNumber: process.env.PR_NUMBER ?? '',
        ...(process.env.EVENT_HEAD_SHA
          ? { eventHeadSha: process.env.EVENT_HEAD_SHA }
          : {}),
        workersDevSuffix: process.env.PREVIEW_WORKERS_DEV_SUFFIX ?? '',
      },
      {
        fetch,
        githubToken: process.env.GH_TOKEN,
        sleep: async (ms, signal) => {
          await delay(ms, undefined, { signal });
        },
        run: (context, signal) =>
          runOwnedBenchmark({
            root: process.cwd(),
            runId,
            target: context.url,
            environment: process.env,
            signal,
          }),
      },
      abort.signal,
    );
    console.log(`Voice benchmark: ${result}.`);
    if (result === 'failed') process.exitCode = 1;
  } finally {
    clearTimeout(deadline);
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
}

if (import.meta.main)
  await cli().catch(() => {
    console.error(
      'Voice benchmark CI failed; no raw reports or credentials were published.',
    );
    process.exitCode = 1;
  });
