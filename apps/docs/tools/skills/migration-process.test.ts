import { expect, test } from 'bun:test';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
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
    expect(() => process.kill(pid, 0)).toThrow();
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
    expect(() => process.kill(pid, 0)).toThrow();
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
