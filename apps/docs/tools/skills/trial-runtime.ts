import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, openSync, realpathSync } from 'node:fs';
import {
  lstat,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  realpath,
} from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

type TrialSignal = (target: number, signal: NodeJS.Signals | 0) => boolean;

export async function createTrialDirectory(parent: string): Promise<string> {
  return realpath(await mkdtemp(join(parent, 'maelstrom-skill-discovery-')));
}

export async function finishTrialCleanup(
  target: number,
  signal: TrialSignal = process.kill,
): Promise<void> {
  if (!Number.isSafeInteger(target) || Math.abs(target) < 2)
    throw new RangeError('Use one retained process or group identity');
  try {
    signal(target, 'SIGKILL');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return;
    if (code !== 'EPERM') throw error;
    const deadline = performance.now() + 100;
    for (;;) {
      try {
        signal(target, 0);
      } catch (probe) {
        const probeCode = (probe as NodeJS.ErrnoException).code;
        if (probeCode === 'ESRCH') return;
        if (probeCode !== 'EPERM') throw error;
      }
      if (performance.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
}

export function credentialSandbox(paths: readonly string[]): string {
  const canonical = new Set(
    paths.flatMap((path) => [
      path,
      realpathSync(path),
      join(realpathSync(dirname(path)), basename(path)),
    ]),
  );
  return `(version 1) (allow default) (deny file-write* ${[...canonical].map((path) => `(literal ${JSON.stringify(path)})`).join(' ')})`;
}

export async function runTrialProcess(
  cwd: string,
  command: string[],
  env: NodeJS.ProcessEnv,
  stdout: string,
  stderr: string,
  timeoutMs = 240_000,
): Promise<void> {
  const outputFd = openSync(stdout, 'w', 0o600);
  const errorFd = openSync(stderr, 'w', 0o600);
  const child = spawn(command[0], command.slice(1), {
    cwd,
    env,
    detached: true,
    stdio: ['ignore', outputFd, errorFd],
  });
  const groupId = child.pid;
  closeSync(outputFd);
  closeSync(errorFd);
  let expired = false;
  let escalation: ReturnType<typeof setTimeout> | undefined;
  const stopGroup = (signal: NodeJS.Signals) => {
    if (!groupId || groupId < 2) return;
    try {
      process.kill(-groupId, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  };
  const timer = setTimeout(() => {
    expired = true;
    stopGroup('SIGTERM');
    escalation = setTimeout(() => stopGroup('SIGKILL'), 5_000);
  }, timeoutMs);
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    if (expired) {
      if (escalation) clearTimeout(escalation);
      if (groupId && groupId > 1) await finishTrialCleanup(-groupId);
      throw new Error(
        `Trial timed out; inspect protected evidence at ${stderr}`,
      );
    }
    if (code !== 0)
      throw new Error(
        `Trial exited ${code}; inspect protected evidence at ${stderr}`,
      );
  } finally {
    clearTimeout(timer);
    if (escalation) clearTimeout(escalation);
  }
}

export async function trialSnapshot(
  directory: string,
): Promise<Record<string, string>> {
  const state: Record<string, string> = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const stat = await lstat(path);
    const metadata = `${stat.mode}:${stat.isSymbolicLink() ? 'link' : stat.isDirectory() ? 'directory' : 'file'}`;
    if (stat.isSymbolicLink())
      state[entry.name] = `${metadata}:${await readlink(path)}`;
    else if (stat.isDirectory()) {
      state[entry.name] = metadata;
      for (const [nested, digest] of Object.entries(await trialSnapshot(path)))
        state[`${entry.name}/${nested}`] = digest;
    } else
      state[entry.name] = `${metadata}:${createHash('sha256')
        .update(await readFile(path))
        .digest('hex')}`;
  }
  return state;
}
