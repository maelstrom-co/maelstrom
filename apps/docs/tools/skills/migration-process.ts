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
async function boundedWait<T>(
  pending: Promise<T>,
  timeoutMs: number,
  message: string,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(message)),
          Math.max(0, timeoutMs),
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
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
  const supervisorDeadline = performance.now() + timeoutMs + 3000;
  const waitForSupervisor = <T>(pending: Promise<T>) =>
    boundedWait(
      pending,
      supervisorDeadline - performance.now(),
      'Migration supervisor completion deadline exceeded',
    );
  const helperPids = new Set<number>();
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
      helperPids.add(killer.pid);
      try {
        const code = await boundedWait(
          killer.exited,
          2500,
          'Cleanup helper completion deadline exceeded',
        );
        helperPids.delete(killer.pid);
        return code === 0;
      } catch {
        try {
          killer.kill('SIGKILL');
        } catch {}
        try {
          await boundedWait(
            killer.exited,
            250,
            'Cleanup helper termination deadline exceeded',
          );
          helperPids.delete(killer.pid);
        } catch {}
        return false;
      }
    })();
    return cleanup;
  };
  let failed = false;
  let failure: unknown;
  try {
    await waitForSupervisor(
      appendFile(
        ledger,
        `${JSON.stringify({ ...identity, phase: 'supervisor-started' })}\n`,
        { mode: 0o600 },
      ),
    );
    const code = await waitForSupervisor(worker.exited);
    const info = await waitForSupervisor(stat(statusPath));
    if (!info.isFile() || info.size > 4096)
      throw new Error('Invalid process result');
    const result = JSON.parse(
      await waitForSupervisor(readFile(statusPath, 'utf8')),
    );
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
  }
  let complete = false;
  try {
    complete = await terminate();
    if (complete)
      await boundedWait(
        worker.exited,
        1000,
        'Migration supervisor reap deadline exceeded',
      );
  } catch {
    complete = false;
  }
  if (!complete) {
    const retained = {
      ...identity,
      ...(helperPids.size ? { cleanupHelperPids: [...helperPids] } : {}),
    };
    await boundedWait(
      writeFile(`${statusPath}.identity`, JSON.stringify(retained), {
        mode: 0o600,
      }),
      1000,
      'Process identity retention deadline exceeded',
    ).catch(() => {});
    throw new Error(
      `Migration process cleanup uncertain; retained supervisorPid=${identity.supervisorPid} pgid=${identity.pgid} helperPids=${[...helperPids].join(',')} status=${statusPath}`,
      { cause: failure },
    );
  }
  try {
    await boundedWait(
      appendFile(
        ledger,
        `${JSON.stringify({ ...identity, phase: 'cleanup', cleanup: 'complete' })}\n`,
        { mode: 0o600 },
      ),
      1000,
      'Process cleanup publication deadline exceeded',
    );
  } catch (cause) {
    throw new Error(
      `Migration process evidence publication failed after verified cleanup; supervisorPid=${identity.supervisorPid} pgid=${identity.pgid}`,
      { cause },
    );
  }
  await boundedWait(
    rm(statusPath, { force: true }),
    1000,
    'Process status removal deadline exceeded',
  );
  if (failed) throw failure;
}

export async function cloneMigrationTree(source: string, target: string) {
  const privateRoot = await evidence;
  const ledger = join(privateRoot, 'copies.jsonl');
  const child = Bun.spawn(
    [
      '/bin/cp',
      ...(process.platform === 'darwin' ? ['-cRL'] : ['-RL']),
      source,
      target,
    ],
    { env: { PATH: '/usr/bin:/bin' }, stdout: 'ignore', stderr: 'ignore' },
  );
  const identity = { pid: child.pid };
  const deadline = performance.now() + 30_000;
  const waitForCopy = <T>(pending: Promise<T>) =>
    boundedWait(
      pending,
      deadline - performance.now(),
      'Migration copy completion deadline exceeded',
    );
  let failed = false;
  let failure: unknown;
  try {
    await waitForCopy(
      appendFile(
        ledger,
        `${JSON.stringify({ pid: child.pid, phase: 'copy-started' })}\n`,
        { mode: 0o600 },
      ),
    );
    const code = await waitForCopy(child.exited);
    if (code !== 0)
      throw new Error('Migration copy failed or exceeded its deadline');
  } catch (error) {
    failed = true;
    failure = error;
  }
  if (child.exitCode === null) {
    try {
      child.kill('SIGKILL');
    } catch {}
  }
  let code: number;
  try {
    code = await boundedWait(
      child.exited,
      1000,
      'Migration copy cleanup deadline exceeded',
    );
  } catch (cause) {
    const identityPath = join(
      privateRoot,
      `${crypto.randomUUID()}.copy.identity`,
    );
    await boundedWait(
      writeFile(identityPath, JSON.stringify(identity), { mode: 0o600 }),
      1000,
      'Copy identity retention deadline exceeded',
    ).catch(() => {});
    throw new Error(
      `Migration copy cleanup uncertain; retained pid=${identity.pid} identity=${identityPath}`,
      { cause },
    );
  }
  await boundedWait(
    appendFile(
      ledger,
      `${JSON.stringify({ ...identity, phase: 'copy-finished', code, cleanup: 'complete' })}\n`,
      { mode: 0o600 },
    ),
    1000,
    'Copy cleanup publication deadline exceeded',
  );
  if (failed) throw failure;
}
