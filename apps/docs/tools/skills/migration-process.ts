import {
  appendFile,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
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
    { cwd, env, stdout: 'ignore', stderr: 'ignore' },
  );
  await appendFile(
    ledger,
    JSON.stringify({ supervisorPid: worker.pid, phase: 'supervisor-started' }) +
      '\n',
    { mode: 0o600 },
  );
  const guard = setTimeout(() => {
    void (async () => {
      try {
        const info = await stat(statusPath);
        if (info.size <= 4096) {
          const started = JSON.parse(await readFile(statusPath, 'utf8'));
          if (
            started.supervisorPid === worker.pid &&
            Number.isSafeInteger(started.pgid) &&
            started.pgid > 0
          ) {
            const killer = Bun.spawn(
              [
                node,
                '-e',
                'try{process.kill(-Number(process.argv[1]),"SIGKILL")}catch{}',
                String(started.pgid),
              ],
              { env, stdout: 'ignore', stderr: 'ignore' },
            );
            await appendFile(
              ledger,
              `${JSON.stringify({
                pid: killer.pid,
                pgid: started.pgid,
                phase: 'fallback-kill',
              })}\n`,
              { mode: 0o600 },
            );
            const timer = setTimeout(() => {
              try {
                killer.kill('SIGKILL');
              } catch {}
            }, 1000);
            await killer.exited;
            clearTimeout(timer);
          }
        }
      } catch {
      } finally {
        try {
          worker.kill('SIGKILL');
        } catch {}
      }
    })();
  }, timeoutMs + 5000);
  try {
    await worker.exited;
    const info = await stat(statusPath);
    if (!info.isFile() || info.size > 4096)
      throw new Error('Invalid process result');
    const result = JSON.parse(await readFile(statusPath, 'utf8'));
    if (
      result.supervisorPid !== worker.pid ||
      !Number.isSafeInteger(result.pid) ||
      result.pid < 1 ||
      result.pgid !== result.pid ||
      result.phase !== 'finished'
    )
      throw new Error('Invalid process identity or completion');
    await appendFile(ledger, `${JSON.stringify(result)}\n`, { mode: 0o600 });
    if (result.cleanup !== 'complete')
      throw new Error('Migration process cleanup failed');
    if (result.outcome === 'timeout')
      throw new Error('Trial timed out; isolated supervisor deadline');
    if (result.outcome !== 'passed')
      throw new Error('Migration process failed');
  } finally {
    clearTimeout(guard);
    await rm(statusPath, { force: true });
  }
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
  await appendFile(
    ledger,
    `${JSON.stringify({ pid: child.pid, phase: 'copy-started' })}\n`,
    { mode: 0o600 },
  );
  const deadline = setTimeout(() => {
    try {
      child.kill('SIGKILL');
    } catch {}
  }, 30_000);
  try {
    const code = await child.exited;
    await appendFile(
      ledger,
      `${JSON.stringify({ pid: child.pid, phase: 'copy-finished', code })}\n`,
      { mode: 0o600 },
    );
    if (code !== 0)
      throw new Error('Migration copy failed or exceeded its deadline');
  } finally {
    clearTimeout(deadline);
  }
}
