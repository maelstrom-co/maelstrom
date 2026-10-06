import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrationProcess } from './migration-process';

// This opt-in fixture needs a disposable Linux PID namespace with a non-reaping PID 1.
const linuxFixture = process.env.MIGRATION_NON_REAPING_PID1 === '1';

test.skipIf(!linuxFixture)(
  'Linux zombie-only descendants preserve successful completion',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'migration-linux-zombie-'));
    const pidFile = join(root, 'child.pid');
    try {
      let failure: unknown;
      try {
        await runMigrationProcess(
          root,
          [
            Bun.which('node')!,
            '-e',
            'const cp=require("node:child_process"),fs=require("node:fs");const child=cp.spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});fs.writeFileSync(process.argv[1],String(child.pid));child.unref();process.exit(0)',
            pidFile,
          ],
          { PATH: process.env.PATH, HOME: root },
          1000,
        );
      } catch (error) {
        failure = error;
      }
      const pid = Number(await readFile(pidFile, 'utf8'));
      const probe = Bun.spawn(
        ['/bin/ps', '-p', String(pid), '-o', 'pid=,pgid=,stat='],
        {
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      const metadata = (await new Response(probe.stdout).text()).trim();
      expect(await probe.exited).toBe(0);
      const [observedPid, pgid, state] = metadata.split(/\s+/);
      console.info(
        JSON.stringify({
          pid,
          metadata,
          outcome: failure instanceof Error ? failure.message : 'passed',
        }),
      );
      expect(Number(observedPid)).toBe(pid);
      expect(state.startsWith('Z')).toBe(true);
      expect(() => process.kill(-Number(pgid), 0)).not.toThrow();
      expect(failure).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  6000,
);

for (const fault of [
  'live',
  'live-thread',
  'permission',
  'unreadable',
  'empty',
  'malformed',
  'wrong-group',
  'unknown-state',
  'hidden-members',
] as const) {
  test.skipIf(!linuxFixture)(
    `Linux ${fault} membership retains cleanup uncertainty and known identities`,
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'migration-linux-uncertain-'));
      const pidFile = join(root, 'child.pid');
      const preload = join(root, 'fault.cjs');
      await writeFile(
        preload,
        `
if (process.argv[1]?.endsWith('/migration-process-cleanup.mjs')) {
  const fault = ${JSON.stringify(fault)};
  const kill = process.kill.bind(process);
  process.kill = (pid, signal) => {
    if (pid === -Number(process.argv[2])) {
      if ((fault === 'live' || fault === 'live-thread') && signal === 'SIGKILL') return true;
      if (fault === 'permission' && signal === 0)
        throw Object.assign(new Error('fixture permission denied'), { code: 'EPERM' });
    }
    return kill(pid, signal);
  };
  const cp = require('node:child_process');
  const spawn = cp.spawnSync;
  cp.spawnSync = (...args) => {
    if (args[0] !== '/bin/ps') return spawn(...args);
    if (fault === 'unreadable') throw Object.assign(new Error('fixture unreadable'), { code: 'EACCES' });
    const rows = { empty: '', malformed: 'unreadable', 'wrong-group': '1 1 Z', 'unknown-state': '1 ' + process.argv[2] + ' ?' };
    if (fault in rows) return { status: 0, stdout: rows[fault], stderr: '' };
    return spawn(...args);
  };
  if (fault === 'hidden-members') {
    const fs = require('node:fs');
    const read = fs.readFileSync;
    fs.readFileSync = (...args) => args[0] === '/proc/mounts' ? 'proc /proc proc rw,hidepid=2 0 0\\n' : read(...args);
  }
  require('node:module').syncBuiltinESMExports();
}
`,
      );
      let pgid = 0;
      const started = performance.now();
      try {
        const failure = await runMigrationProcess(
          root,
          [
            Bun.which('node')!,
            '-e',
            fault === 'live-thread'
              ? 'const cp=require("node:child_process"),fs=require("node:fs");const child=cp.spawn("/usr/bin/python3",["-c","import ctypes,threading,time; threading.Thread(target=lambda: time.sleep(100)).start(); ctypes.CDLL(None).pthread_exit(None)"],{stdio:"ignore"});fs.writeFileSync(process.argv[1],String(child.pid));child.unref();process.exit(0)'
              : 'const cp=require("node:child_process"),fs=require("node:fs");const child=cp.spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});fs.writeFileSync(process.argv[1],String(child.pid));child.unref();process.exit(0)',
            pidFile,
          ],
          {
            PATH: process.env.PATH,
            HOME: root,
            NODE_OPTIONS: `--require=${preload}`,
          },
          1000,
        ).then(
          () => new Error('incorrect success'),
          (error: Error) => error,
        );
        pgid = Number(failure.message.match(/pgid=(\d+)/)?.[1]) || 0;
        const pid = Number(await readFile(pidFile, 'utf8'));
        const probe = Bun.spawn(
          ['/bin/ps', '-p', String(pid), '-o', 'pid=,pgid=,state='],
          { stdout: 'pipe' },
        );
        const metadata = (await new Response(probe.stdout).text()).trim();
        expect(await probe.exited).toBe(0);
        const [observedPid, observedGroup, state] = metadata.split(/\s+/);
        pgid = Number(observedGroup);
        console.info(
          JSON.stringify({ fault, metadata, outcome: failure.message }),
        );
        expect(Number(observedPid)).toBe(pid);
        expect(pgid).toBeGreaterThan(0);
        if (fault === 'live') expect(state).not.toBe('Z');
        if (fault === 'live-thread') {
          expect(state).toBe('Z');
          const threads = Bun.spawn(
            ['/bin/ps', '-L', '-p', String(pid), '-o', 'pid=,pgid=,state='],
            { stdout: 'pipe' },
          );
          const threadMetadata = (
            await new Response(threads.stdout).text()
          ).trim();
          expect(await threads.exited).toBe(0);
          expect(
            threadMetadata.split('\n').some((row) => !row.endsWith('Z')),
          ).toBe(true);
          console.info(JSON.stringify({ fault, threadMetadata }));
        }
        expect(performance.now() - started).toBeLessThan(6000);
        expect(failure.message).toContain('cleanup uncertain');
        expect(Number(failure.message.match(/pgid=(\d+)/)?.[1])).toBe(pgid);
        const status = failure.message.match(/status=(.+)$/)?.[1];
        expect(
          JSON.parse(await readFile(`${status}.identity`, 'utf8')),
        ).toEqual({ supervisorPid: pgid, pgid });
        expect(JSON.parse(await readFile(status!, 'utf8')).outcome).toBe(
          'passed',
        );
      } finally {
        if (pgid > 0) {
          process.kill(-pgid, 'SIGKILL');
          const until = performance.now() + 1500;
          let metadata = '';
          do {
            const probe = Bun.spawn(
              ['/bin/ps', '-L', '-s', String(pgid), '-o', 'pid=,pgid=,state='],
              { stdout: 'pipe' },
            );
            metadata = (await new Response(probe.stdout).text()).trim();
            expect(await probe.exited).toBe(0);
            if (
              metadata
                .split('\n')
                .every((row) => /^\s*\d+\s+\d+\s+Z$/.test(row))
            )
              break;
            await Bun.sleep(20);
          } while (performance.now() < until);
          for (const row of metadata.split('\n')) {
            const [, group, state] = row.trim().split(/\s+/);
            expect(Number(group)).toBe(pgid);
            expect(state).toBe('Z');
          }
          console.info(
            JSON.stringify({
              fault,
              cleanup: 'no executable members',
              metadata,
            }),
          );
        }
        await rm(root, { recursive: true, force: true });
      }
    },
    8000,
  );
}
