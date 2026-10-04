import {
  appendFile,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const evidence = mkdtemp(join(tmpdir(), 'maelstrom-eval-process-'));
const nodePath = realpath(Bun.which('node') ?? '/usr/bin/node');
export async function migrationProcessEvidenceDirectory() {
  return evidence;
}

export async function runMigrationProcess(
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
) {
  const node = await nodePath;
  const privateRoot = await evidence;
  const statusPath = join(privateRoot, `${crypto.randomUUID()}.json`);
  const ledger = join(privateRoot, 'processes.jsonl');
  const worker = Bun.spawn(
    [
      node,
      join(import.meta.dir, 'migration-process-worker.mjs'),
      statusPath,
      JSON.stringify({ cwd, args, timeoutMs }),
    ],
    { cwd, env, detached: true, stdout: 'ignore', stderr: 'ignore' },
  );
  const identity = { supervisorPid: worker.pid, pgid: worker.pid };
  let cleanup: Promise<boolean> | undefined;
  const terminate = () => {
    cleanup ??= (async () => {
      const killer = Bun.spawn(
        [
          node,
          join(import.meta.dir, 'migration-process-cleanup.mjs'),
          String(identity.pgid),
        ],
        { env, stdout: 'ignore', stderr: 'ignore' },
      );
      const timer = setTimeout(() => {
        try {
          killer.kill('SIGKILL');
        } catch {}
      }, 2500);
      try {
        return (await killer.exited) === 0;
      } finally {
        clearTimeout(timer);
      }
    })();
    return cleanup;
  };
  const guard = setTimeout(() => {
    void terminate().catch(() => {});
  }, timeoutMs + 3000);
  let failed = false;
  let failure: unknown;
  try {
    await appendFile(
      ledger,
      `${JSON.stringify({ ...identity, phase: 'supervisor-started' })}\n`,
      { mode: 0o600 },
    );
    const code = await worker.exited;
    const info = await stat(statusPath);
    if (!info.isFile() || info.size > 4096)
      throw new Error('Invalid process result');
    const result = JSON.parse(await readFile(statusPath, 'utf8'));
    if (
      result.supervisorPid !== worker.pid ||
      !Number.isSafeInteger(result.pid) ||
      result.pid < 1 ||
      result.pgid !== identity.pgid ||
      result.phase !== 'finished' ||
      code !== 0
    )
      throw new Error('Invalid process identity or completion');
    if (result.outcome === 'timeout')
      throw new Error('Trial timed out; isolated supervisor deadline');
    if (result.outcome !== 'passed')
      throw new Error('Migration process failed');
  } catch (error) {
    failed = true;
    failure = error;
  } finally {
    clearTimeout(guard);
  }
  let complete = false;
  try {
    complete = await terminate();
  } catch {}
  if (!complete) {
    await writeFile(`${statusPath}.identity`, JSON.stringify(identity), {
      mode: 0o600,
    }).catch(() => {});
    throw new Error(
      `Migration process cleanup uncertain; retained supervisorPid=${identity.supervisorPid} pgid=${identity.pgid} status=${statusPath}`,
      { cause: failure },
    );
  }
  await worker.exited;
  try {
    await appendFile(
      ledger,
      `${JSON.stringify({ ...identity, phase: 'cleanup', cleanup: 'complete' })}\n`,
      { mode: 0o600 },
    );
  } catch (cause) {
    throw new Error(
      `Migration process evidence publication failed after verified cleanup; supervisorPid=${identity.supervisorPid} pgid=${identity.pgid}`,
      { cause },
    );
  }
  await rm(statusPath, { force: true });
  if (failed) throw failure;
}

export async function cloneMigrationTree(source: string, target: string) {
  const ledger = join(await evidence, 'copies.jsonl');
  const child = Bun.spawn(
    [
      '/bin/cp',
      ...(process.platform === 'darwin' ? ['-cRL'] : ['-RL']),
      source,
      target,
    ],
    { env: { PATH: '/usr/bin:/bin' }, stdout: 'ignore', stderr: 'ignore' },
  );
  const deadline = setTimeout(() => {
    try {
      child.kill('SIGKILL');
    } catch {}
  }, 30_000);
  try {
    await appendFile(
      ledger,
      `${JSON.stringify({ pid: child.pid, phase: 'copy-started' })}\n`,
      { mode: 0o600 },
    );
    const code = await child.exited;
    await appendFile(
      ledger,
      `${JSON.stringify({ pid: child.pid, phase: 'copy-finished', code })}\n`,
      { mode: 0o600 },
    );
    if (code !== 0)
      throw new Error('Migration copy failed or exceeded its deadline');
  } finally {
    try {
      child.kill('SIGKILL');
    } catch {}
    await child.exited;
    clearTimeout(deadline);
  }
}
