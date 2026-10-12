import { expect, test } from 'bun:test';

test.each([
  'promise',
  'thenable',
  'throwing-then-getter',
  'pending',
] as const)('optional progress observers cannot crash or delay Actions: %s', (mode) => {
  const probe = `
      import { ActionManager } from '../../index.ts';
      import { ActionName, InstanceId, ok } from '@maelstrom-co/protocol';
      const manager = new ActionManager();
      const instanceId = InstanceId('observer-instance');
      let executed = 0;
      manager.registerRunner(instanceId, { run: () => { executed++; return ok(undefined); } });
      const plan = [{ instanceId, action: ActionName('run'), params: {} }];
      const mode = ${JSON.stringify(mode)};
      const fail = () => new Error('optional progress observer failed');
      const observer = mode === 'promise' ? async () => { throw fail(); }
        : mode === 'thenable' ? () => {
          const rejected = Promise.reject(fail());
          return { then(resolve, reject) { return rejected.then(resolve, reject); } };
        } : mode === 'throwing-then-getter' ? () => ({ get then() { throw fail(); } })
        : () => new Promise(() => {});
      const first = await manager.executeActions(plan, observer);
      const phases = [];
      const second = await manager.executeActions(plan, progress => phases.push(progress.phase));
      if (!first.allSucceeded || !second.allSucceeded || executed !== 2)
        throw new Error('Observer changed an Action result');
      if (phases.join(',') !== 'waiting,ready,started')
        throw new Error('Healthy observer missed Action progress');
      await new Promise(resolve => setTimeout(resolve, 10));
      console.log('Actions completed');
    `;
  const child = Bun.spawnSync(
    [process.execPath, '--no-env-file', '--eval', probe],
    { cwd: import.meta.dir, timeout: 5000 },
  );
  expect(child.exitCode, child.stderr.toString()).toBe(0);
  expect(child.stdout.toString()).toContain('Actions completed');
});
