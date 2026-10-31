import { expect, spyOn, test } from 'bun:test';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  cloneMigrationTree,
  migrationProcessEvidenceDirectory,
  runMigrationProcess,
} from './migration-process';

async function expectStopped(id: number, group = false) {
  try {
    process.kill(group ? -id : id, 0);
  } catch (error) {
    expect((error as NodeJS.ErrnoException).code).toBe('ESRCH');
    return;
  }
  expect(process.platform).toBe('linux');
  const probe = Bun.spawn(
    [
      '/bin/ps',
      '-L',
      group ? '-s' : '-p',
      String(id),
      '-o',
      'pid=,pgid=,state=',
    ],
    { env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' }, stdout: 'pipe' },
  );
  const metadata = (await new Response(probe.stdout).text()).trim();
  const code = await probe.exited;
  if (code === 1 && metadata === '') {
    let absent = false;
    try {
      process.kill(group ? -id : id, 0);
    } catch (error) {
      absent = (error as NodeJS.ErrnoException).code === 'ESRCH';
    }
    expect(absent).toBe(true);
    return;
  }
  expect(code).toBe(0);
  expect(metadata.length).toBeGreaterThan(0);
  for (const row of metadata.split('\n')) {
    const [pid, pgid, state] = row.trim().split(/\s+/);
    expect(Number(group ? pgid : pid)).toBe(id);
    expect(state).toBe('Z');
  }
  console.info(JSON.stringify({ stopped: id, group, metadata }));
}

for (const fault of ['helper-start', 'helper-kill'] as const) {
  test(`a stalled supervisor returns bounded cleanup uncertainty when ${fault} fails`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'migration-stalled-supervisor-'));
    const workerPath = join(import.meta.dir, 'migration-process-worker.mjs');
    const helperPath = join(import.meta.dir, 'migration-process-cleanup.mjs');
    const preload = join(root, 'stall.cjs');
    await writeFile(
      preload,
      `if(process.argv[1]===${JSON.stringify(workerPath)}) {require("node:fs").writeFileSync(process.argv[2],JSON.stringify({supervisorPid:process.pid,pgid:process.pid,phase:"fixture-stalled"}));process.kill(process.pid,"SIGSTOP");}${fault === 'helper-kill' ? `if(process.argv[1]===${JSON.stringify(helperPath)}) process.kill(process.pid,"SIGSTOP");` : ''}`,
    );
    const originalSpawn = Bun.spawn;
    let supervisor: ReturnType<typeof Bun.spawn> | undefined;
    let helper: ReturnType<typeof Bun.spawn> | undefined;
    let restoreKill: (() => void) | undefined;
    const spawn = spyOn(Bun, 'spawn').mockImplementation((...args) => {
      const first = args[0];
      const command = Array.isArray(first) ? first : first.cmd;
      if (command?.[1] === helperPath && fault === 'helper-start')
        throw new Error('Injected exact cleanup helper spawn failure');
      const child = originalSpawn(...args);
      if (command?.[1] === workerPath) supervisor = child;
      if (command?.[1] === helperPath) {
        helper = child;
        const kill = spyOn(child, 'kill').mockImplementation(() => {
          throw new Error('Injected known helper kill failure');
        });
        restoreKill = () => kill.mockRestore();
      }
      return child;
    });
    const start = performance.now();
    const run = runMigrationProcess(
      root,
      [
        await realpath(Bun.which('node') ?? '/usr/bin/node'),
        '-e',
        'setInterval(()=>{},1000)',
      ],
      {
        PATH: '/usr/bin:/bin',
        HOME: root,
        NODE_OPTIONS: `--require=${preload}`,
      },
      100,
    ).then(
      () => ({ message: 'incorrect success', cause: null }),
      (error: Error) => ({ message: error.message, cause: error.cause }),
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    let statusPath: string | undefined;
    let returnedMs = 0;
    try {
      const result = await Promise.race([
        run,
        new Promise<{ message: string; cause: unknown }>((resolve) => {
          timer = setTimeout(
            () =>
              resolve({ message: 'external test bound exceeded', cause: null }),
            6500,
          );
        }),
      ]);
      returnedMs = performance.now() - start;
      expect(result.message).toContain('cleanup uncertain');
      expect(returnedMs).toBeLessThan(6500);
      if (!(result.cause instanceof Error))
        throw new Error('Missing independent supervisor deadline failure');
      expect(result.cause.message).toBe(
        'Migration supervisor completion deadline exceeded',
      );
      expect(supervisor).toBeDefined();
      statusPath = result.message.match(/status=(.+)$/)?.[1];
      expect(statusPath).toBeDefined();
      const retained = JSON.parse(
        await readFile(`${statusPath}.identity`, 'utf8'),
      );
      expect(retained.supervisorPid).toBe(supervisor!.pid);
      expect(retained.pgid).toBe(supervisor!.pid);
      expect(JSON.parse(await readFile(statusPath!, 'utf8')).phase).toBe(
        'fixture-stalled',
      );
      if (fault === 'helper-kill')
        expect(retained.cleanupHelperPids).toContain(helper!.pid);
      expect(() => process.kill(-supervisor!.pid, 0)).not.toThrow();
    } finally {
      if (timer) clearTimeout(timer);
      spawn.mockRestore();
      restoreKill?.();
      if (helper) {
        process.kill(helper.pid, 'SIGKILL');
        await helper.exited;
        expect(() => process.kill(helper!.pid, 0)).toThrow();
      }
      if (supervisor) {
        const cleanup = Bun.spawn(
          [
            await realpath(Bun.which('node') ?? '/usr/bin/node'),
            helperPath,
            String(supervisor.pid),
          ],
          {
            env: { PATH: '/usr/bin:/bin' },
            stdout: 'ignore',
            stderr: 'ignore',
          },
        );
        expect(await cleanup.exited).toBe(0);
        await supervisor.exited;
        await expectStopped(supervisor.pid, true);
      }
      await run;
      if (statusPath)
        expect(
          JSON.parse(await readFile(`${statusPath}.identity`, 'utf8')).pgid,
        ).toBe(supervisor!.pid);
      if (statusPath)
        expect(JSON.parse(await readFile(statusPath, 'utf8')).phase).toBe(
          'fixture-stalled',
        );
      if (statusPath)
        console.info(
          JSON.stringify({
            fault,
            returnedMs: Math.round(returnedMs),
            supervisorPid: supervisor!.pid,
            pgid: supervisor!.pid,
            cleanupHelperPid: helper?.pid ?? null,
            identityRetainedAfterLateExit: true,
            groupStoppedAfterOwnIdCleanup: true,
            helperAbsentAfterOwnIdCleanup: true,
          }),
        );
      await rm(root, { recursive: true, force: true });
    }
  }, 12000);
}

test('a copy publication error cannot wait forever when its retained process cannot be killed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'migration-copy-kill-error-'));
  const source = join(root, 'source');
  const target = join(root, 'copy');
  await writeFile(source, 'frozen');
  const ledger = join(
    await migrationProcessEvidenceDirectory(),
    'copies.jsonl',
  );
  const backup = `${ledger}.backup`;
  await rename(ledger, backup).catch(() => {});
  await mkdir(ledger);
  const node = await realpath(Bun.which('node') ?? '/usr/bin/node');
  const originalSpawn = Bun.spawn;
  let child: ReturnType<typeof Bun.spawn> | undefined;
  let restoreKill: (() => void) | undefined;
  const spawn = spyOn(Bun, 'spawn').mockImplementation((...args) => {
    const first = args[0];
    const command = Array.isArray(first) ? first : first.cmd;
    if (command?.[0] !== '/bin/cp' || command.at(-1) !== target)
      return originalSpawn(...args);
    child = originalSpawn([node, '-e', 'setInterval(()=>{},1000)'], {
      env: { PATH: '/usr/bin:/bin' },
      stdout: 'ignore',
      stderr: 'ignore',
    });
    const kill = spyOn(child, 'kill').mockImplementation(() => {
      throw new Error('Injected known copy kill failure');
    });
    restoreKill = () => kill.mockRestore();
    return child;
  });
  const start = performance.now();
  const run = cloneMigrationTree(source, target).then(
    () => 'incorrect success',
    (error: Error) => error.message,
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const message = await Promise.race([
      run,
      new Promise<string>((resolve) => {
        timer = setTimeout(() => resolve('external test bound exceeded'), 2500);
      }),
    ]);
    expect(message).toContain('copy cleanup uncertain');
    expect(performance.now() - start).toBeLessThan(2500);
    const identityPath = message.match(/identity=(.+)$/)?.[1];
    expect(identityPath).toBeDefined();
    expect(JSON.parse(await readFile(identityPath!, 'utf8')).pid).toBe(
      child!.pid,
    );
    expect(() => process.kill(child!.pid, 0)).not.toThrow();
  } finally {
    if (timer) clearTimeout(timer);
    spawn.mockRestore();
    restoreKill?.();
    if (child) {
      process.kill(child.pid, 'SIGKILL');
      await child.exited;
      expect(() => process.kill(child!.pid, 0)).toThrow();
    }
    await run;
    await rm(ledger, { recursive: true });
    await rename(backup, ledger).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
}, 6000);

test('a genuine supervisor SIGKILL cannot orphan its retained group', async () => {
  const root = await mkdtemp(join(tmpdir(), 'migration-supervisor-crash-'));
  const pidFile = join(root, 'child.pid');
  try {
    const program =
      'const cp=require("node:child_process"),fs=require("node:fs");const child=cp.spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});fs.writeFileSync(process.argv[1],String(child.pid));process.kill(process.ppid,"SIGKILL");setInterval(()=>{},1000)';
    await expect(
      runMigrationProcess(
        root,
        [
          await realpath(Bun.which('node') ?? '/usr/bin/node'),
          '-e',
          program,
          pidFile,
        ],
        { PATH: '/usr/bin:/bin', HOME: root },
        1000,
      ),
    ).rejects.toThrow('completion');
    const pid = Number(await readFile(pidFile, 'utf8'));
    await expectStopped(pid);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 6000);

test('a ledger failure cannot leave a running group or discard uncertain identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'migration-ledger-error-'));
  const ledger = join(
    await migrationProcessEvidenceDirectory(),
    'processes.jsonl',
  );
  const backup = `${ledger}.backup`;
  await rename(ledger, backup).catch(() => {});
  await mkdir(ledger);
  let pgid: number | undefined;
  const cleanupGroup = () => {
    if (!pgid || !Number.isSafeInteger(pgid)) return;
    try {
      process.kill(-pgid, 'SIGKILL');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  };
  try {
    let message = '';
    try {
      await runMigrationProcess(
        root,
        [
          await realpath(Bun.which('node') ?? '/usr/bin/node'),
          '-e',
          'setInterval(()=>{},1000)',
        ],
        { PATH: '/usr/bin:/bin', HOME: root },
        1000,
      );
    } catch (error) {
      message = (error as Error).message;
    }
    expect(
      message.includes('after verified cleanup') ||
        message.startsWith('Migration process cleanup uncertain;'),
    ).toBe(true);
    pgid = Number(message.match(/pgid=(\d+)/)?.[1]);
    expect(pgid).toBeGreaterThan(0);
    if (message.startsWith('Migration process cleanup uncertain;')) {
      const status = message.match(/status=(.+)$/)?.[1];
      expect(status).toBeDefined();
      const identity = JSON.parse(await readFile(`${status}.identity`, 'utf8'));
      expect(identity.pgid).toBe(pgid);
    }
    const deadline = performance.now() + 1500;
    while (performance.now() < deadline) {
      try {
        process.kill(-pgid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') break;
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await expectStopped(pgid, true);
  } finally {
    try {
      cleanupGroup();
    } finally {
      await rm(ledger, { recursive: true });
      await rename(backup, ledger).catch(() => {});
      await rm(root, { recursive: true, force: true });
    }
  }
}, 6000);

test('the native worker kills its group when its initial publication throws', async () => {
  const root = await mkdtemp(join(tmpdir(), 'migration-worker-publication-'));
  await mkdir(join(root, 'processes.jsonl'));
  const worker = Bun.spawn(
    [
      await realpath(Bun.which('node') ?? '/usr/bin/node'),
      join(import.meta.dir, 'migration-process-worker.mjs'),
      join(root, 'status.json'),
      JSON.stringify({
        cwd: root,
        args: [
          await realpath(Bun.which('node') ?? '/usr/bin/node'),
          '-e',
          'setInterval(()=>{},1000)',
        ],
        timeoutMs: 1000,
      }),
    ],
    {
      detached: true,
      env: { PATH: '/usr/bin:/bin', HOME: root },
      stdout: 'ignore',
      stderr: 'ignore',
    },
  );
  const guard = setTimeout(() => {
    try {
      process.kill(-worker.pid, 'SIGKILL');
    } catch {}
  }, 3000);
  try {
    expect(await worker.exited).not.toBe(0);
    const status = JSON.parse(
      await readFile(join(root, 'status.json'), 'utf8'),
    );
    expect(status.pgid).toBe(worker.pid);
    const until = performance.now() + 1500;
    while (performance.now() < until) {
      try {
        process.kill(-worker.pid, 0);
      } catch {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await expectStopped(worker.pid, true);
    await expectStopped(status.pid);
  } finally {
    clearTimeout(guard);
    try {
      process.kill(-worker.pid, 'SIGKILL');
    } catch {}
    await rm(root, { recursive: true, force: true });
  }
}, 6000);

test.each([
  1, 100,
])('the native supervisor reaps its child before publishing timeout completion (%dms)', async (timeoutMs) => {
  const root = await mkdtemp(join(tmpdir(), 'migration-timeout-reap-'));
  const statusPath = join(root, 'status.json');
  const node = await realpath(Bun.which('node') ?? '/usr/bin/node');
  const worker = Bun.spawn(
    [
      node,
      join(import.meta.dir, 'migration-process-worker.mjs'),
      statusPath,
      JSON.stringify({
        cwd: root,
        args: [node, '-e', 'setInterval(()=>{},1000)'],
        timeoutMs,
      }),
    ],
    {
      detached: true,
      env: { PATH: '/usr/bin:/bin', HOME: root },
      stdout: 'ignore',
      stderr: 'ignore',
    },
  );
  const guard = setTimeout(() => {
    try {
      process.kill(-worker.pid, 'SIGKILL');
    } catch {}
  }, 3000);
  try {
    expect(await worker.exited).toBe(0);
    const status = JSON.parse(await readFile(statusPath, 'utf8'));
    expect(status).toMatchObject({ phase: 'finished', outcome: 'timeout' });
    expect(Number.isSafeInteger(status.pid) && status.pid > 0).toBe(true);
    expect(() => process.kill(status.pid, 0)).toThrow();
  } finally {
    clearTimeout(guard);
    try {
      process.kill(-worker.pid, 'SIGKILL');
    } catch {}
    await worker.exited;
    await rm(root, { recursive: true, force: true });
  }
}, 6000);

test('repeated native deadlines are timeouts, never successful or missing reports', async () => {
  const root = await mkdtemp(join(tmpdir(), 'migration-repeated-deadline-'));
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      await expect(
        runMigrationProcess(
          root,
          [
            await realpath(Bun.which('node') ?? '/usr/bin/node'),
            '-e',
            'setInterval(()=>{},1000)',
          ],
          { PATH: '/usr/bin:/bin', HOME: root },
          100,
        ),
      ).rejects.toThrow('timed out');
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 6000);

test('uncertain cleanup retains identity and status instead of reporting success', async () => {
  const root = await mkdtemp(join(tmpdir(), 'migration-uncertain-cleanup-'));
  const preload = join(root, 'stop-cleanup.cjs');
  await writeFile(
    preload,
    'if (process.argv[1]?.endsWith("migration-process-cleanup.mjs")) process.kill(process.pid,"SIGSTOP");',
  );
  let pgid = 0;
  try {
    let message = '';
    try {
      await runMigrationProcess(
        root,
        [
          await realpath(Bun.which('node') ?? '/usr/bin/node'),
          '-e',
          'process.exit(0)',
        ],
        {
          PATH: '/usr/bin:/bin',
          HOME: root,
          NODE_OPTIONS: `--require=${preload}`,
        },
        1000,
      );
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('cleanup uncertain');
    pgid = Number(message.match(/pgid=(\d+)/)?.[1]);
    const statusPath = message.match(/status=(.+)$/)?.[1];
    expect(pgid).toBeGreaterThan(0);
    expect(statusPath).toBeDefined();
    const identity = JSON.parse(
      await readFile(`${statusPath}.identity`, 'utf8'),
    );
    expect(identity).toEqual({ supervisorPid: pgid, pgid });
    expect(JSON.parse(await readFile(statusPath!, 'utf8')).phase).toBe(
      'finished',
    );
  } finally {
    if (pgid > 0) {
      const cleanup = Bun.spawn(
        [
          await realpath(Bun.which('node') ?? '/usr/bin/node'),
          join(import.meta.dir, 'migration-process-cleanup.mjs'),
          String(pgid),
        ],
        { env: { PATH: '/usr/bin:/bin' }, stdout: 'ignore', stderr: 'ignore' },
      );
      expect(await cleanup.exited).toBe(0);
    }
    await rm(root, { recursive: true, force: true });
  }
}, 6000);

test('a nonzero command exit remains a failure rather than a deadline', async () => {
  await expect(
    runMigrationProcess(
      import.meta.dir,
      [
        await realpath(Bun.which('node') ?? '/usr/bin/node'),
        '-e',
        'process.exit(2)',
      ],
      { PATH: '/usr/bin:/bin' },
      1000,
    ),
  ).rejects.toThrow('Migration process failed');
});

test('the isolated supervisor completes normally under browser test preloads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'migration-native-process-'));
  try {
    await runMigrationProcess(
      root,
      [
        await realpath(Bun.which('node') ?? '/usr/bin/node'),
        '-e',
        'process.exit(0)',
      ],
      { PATH: '/usr/bin:/bin', HOME: root },
      1000,
    );
    const ledger = await readFile(
      join(await migrationProcessEvidenceDirectory(), 'processes.jsonl'),
      'utf8',
    );
    expect(ledger).toContain('"cleanup":"complete"');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 6000);

test('a TERM-resistant known descendant stops before timeout cleanup returns', async () => {
  const root = await mkdtemp(join(tmpdir(), 'migration-native-group-'));
  const pidFile = join(root, 'child.pid');
  const heartbeat = join(root, 'heartbeat');
  try {
    const program =
      'const cp=require("node:child_process"),fs=require("node:fs");const child=cp.spawn(process.execPath,["-e",\'process.on("SIGTERM",()=>{});setInterval(()=>require("node:fs").writeFileSync(process.argv[1],String(Date.now())),50)\',process.argv[2]],{stdio:"ignore"});fs.writeFileSync(process.argv[1],String(child.pid));setInterval(()=>{},1000)';
    const started = performance.now();
    await expect(
      runMigrationProcess(
        root,
        [
          await realpath(Bun.which('node') ?? '/usr/bin/node'),
          '-e',
          program,
          pidFile,
          heartbeat,
        ],
        { PATH: '/usr/bin:/bin', HOME: root },
        500,
      ),
    ).rejects.toThrow('timed out');
    expect(performance.now() - started).toBeLessThan(5000);
    const pid = Number(await readFile(pidFile, 'utf8'));
    await expectStopped(pid);
    const before = await readFile(heartbeat, 'utf8');
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(await readFile(heartbeat, 'utf8')).toBe(before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 6500);

test('successful parent completion cannot leave its known descendant running', async () => {
  const root = await mkdtemp(join(tmpdir(), 'migration-native-orphan-'));
  const pidFile = join(root, 'child.pid');
  try {
    const program =
      'const cp=require("node:child_process"),fs=require("node:fs");const child=cp.spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});fs.writeFileSync(process.argv[1],String(child.pid));child.unref();process.exit(0)';
    await runMigrationProcess(
      root,
      [
        await realpath(Bun.which('node') ?? '/usr/bin/node'),
        '-e',
        program,
        pidFile,
      ],
      { PATH: '/usr/bin:/bin', HOME: root },
      1000,
    );
    const pid = Number(await readFile(pidFile, 'utf8'));
    await expectStopped(pid);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 6000);

test('native filesystem clones never share writable consumer content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'migration-native-copy-'));
  try {
    await mkdir(join(root, 'source'));
    await writeFile(join(root, 'source/file'), 'frozen');
    await cloneMigrationTree(join(root, 'source'), join(root, 'copy'));
    await writeFile(join(root, 'copy/file'), 'submitted');
    expect(await readFile(join(root, 'source/file'), 'utf8')).toBe('frozen');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('native clone cleanup cannot follow an installed package link back to its source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'migration-native-link-copy-'));
  try {
    await mkdir(join(root, 'source'));
    await mkdir(join(root, 'package'));
    await writeFile(join(root, 'package/entry.js'), 'frozen');
    await symlink(join(root, 'package'), join(root, 'source/dependency'));
    await cloneMigrationTree(join(root, 'source'), join(root, 'copy'));
    expect((await lstat(join(root, 'copy/dependency'))).isSymbolicLink()).toBe(
      false,
    );
    await rm(join(root, 'copy'), { recursive: true, force: true });
    expect(await readFile(join(root, 'package/entry.js'), 'utf8')).toBe(
      'frozen',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
