import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import * as Exit from 'effect/Exit';

import { attributes, scenario } from './helpers/observation-scenario.js';

describe('partial ownership evidence cannot select a foreign physical scope', () => {
  for (const cycle of [false, true]) {
    for (const replace of [false, true]) {
      test(`reconciles resolved props without partial evidence (cycle=${cycle}, replace=${replace})`, async () => {
        const result = await scenario({ cycle, replace });
        expect(Exit.isSuccess(result.first)).toBe(true);
        expect(result.firstOutputs[0]).toBeUndefined();
        expect(result.owners.get('account/api')).toBe('SomeoneElse');
        expect(result.owners.has('tenant/api')).toBe(false);
        if (cycle) expect(result.bindings).toContain('api');
      });
      for (const retry of [false, true]) {
        test(`preserves foreign resources after interruption (cycle=${cycle}, replace=${replace}, retry=${retry})`, async () => {
          const result = await scenario({ cycle, replace, fail: true, retry });
          expect(Exit.isFailure(result.first)).toBe(true);
          expect(
            result.checkpoint && 'attr' in result.checkpoint
              ? result.checkpoint.attr
              : undefined,
          ).toBeUndefined();
          if (retry) expect(result.retry?._tag).toBe('Success');
          expect(result.owners.get('account/api')).toBe('SomeoneElse');
        });
      }
    }
    for (const replace of [false, true])
      for (const retry of [false, true]) {
        test(`keeps complete read attributes usable for cleanup (cycle=${cycle}, replace=${replace}, retry=${retry})`, async () => {
          const result = await scenario({
            cycle,
            replace,
            read: true,
            fail: true,
            retry,
          });
          expect(Exit.isFailure(result.first)).toBe(true);
          expect(result.firstOutputs[0]).toEqual(
            attributes({ name: 'api', scope: 'tenant' }),
          );
          expect(result.checkpoint).toMatchObject({
            props: { name: 'api', scope: 'tenant' },
            attr: attributes({ name: 'api', scope: 'tenant' }),
          });
          if (replace)
            expect(result.checkpoint).toMatchObject({
              old: {
                instanceId: 'old',
                attr: attributes({ name: 'api', scope: 'old' }),
              },
            });
          if (retry) expect(result.retry?._tag).toBe('Success');
          expect(result.owners.has('tenant/api')).toBe(false);
          expect(result.owners.get('account/api')).toBe('SomeoneElse');
        });
      }
    test(`recovers a replacement written after a confirmed absence (cycle=${cycle})`, async () => {
      const result = await scenario({
        cycle,
        replace: true,
        read: true,
        absent: true,
        fail: true,
        writeBeforeFailure: true,
      });
      expect(Exit.isFailure(result.first)).toBe(true);
      expect(result.checkpoint).toMatchObject({
        props: { name: 'api', scope: 'tenant' },
      });
      expect(
        result.checkpoint && 'propsIncomplete' in result.checkpoint
          ? result.checkpoint.propsIncomplete
          : undefined,
      ).toBeUndefined();
      expect(result.owners.has('tenant/api')).toBe(false);
      expect(result.owners.get('account/api')).toBe('SomeoneElse');
    });
  }
  test('clears persisted precreate attributes before interrupted delete-first reconciliation', async () => {
    const result = await scenario({
      cycle: false,
      replace: true,
      read: true,
      fail: true,
      resume: true,
    });
    expect(Exit.isFailure(result.first)).toBe(true);
    expect(result.firstOutputs[0]).toBeUndefined();
    expect(
      result.checkpoint && 'attr' in result.checkpoint
        ? result.checkpoint.attr
        : undefined,
    ).toBeUndefined();
    expect(result.checkpoint).toMatchObject({
      props: { name: 'api', scope: 'tenant' },
      old: { instanceId: 'old' },
    });
    expect(result.owners.get('account/api')).toBe('SomeoneElse');
  });
});

for (const read of [false, true]) {
  test(`keeps a canonical physical precreate through retry (read=${read})`, async () => {
    const result = await scenario({
      cycle: true,
      replace: false,
      read,
      fail: true,
      retry: true,
      absent: true,
      outsideScope: true,
    });
    expect(result.first._tag).toBe('Failure');
    expect(result.retry?._tag).toBe('Success');
    expect(result.checkpoint).toMatchObject({
      props: { name: 'api', scope: 'tenant' },
      attr: attributes({ name: 'api', scope: 'tenant' }),
    });
    expect(new Map(result.ownersBeforeDestroy).get('tenant/api')).toBe(
      'Subject',
    );
    expect(result.owners.get('account/api')).toBe('SomeoneElse');
  });
}
test('recovers a physical precreate interrupted before returning attributes', async () => {
  const result = await scenario({
    cycle: true,
    replace: false,
    read: true,
    absent: true,
    outsideScope: true,
    precreateThrows: true,
  });
  expect(result.first._tag).toBe('Failure');
  expect(result.checkpoint).toMatchObject({
    props: { name: 'api', scope: 'tenant' },
  });
  expect(result.owners.has('tenant/api')).toBe(false);
  expect(result.owners.get('account/api')).toBe('SomeoneElse');
});

test('recovers an interrupted ordinary create from a fully evaluated whole-resource input', async () => {
  const result = await scenario({
    cycle: false,
    replace: false,
    wholeResource: true,
    read: true,
    absent: true,
    fail: true,
    writeBeforeFailure: true,
  });
  expect(Exit.isFailure(result.first)).toBe(true);
  expect(result.checkpoint).toMatchObject({
    props: { name: 'api', scope: 'tenant', source: { value: 'tenant' } },
  });
  expect(result.checkpoint).not.toHaveProperty('propsIncomplete', true);
  expect(result.ownersBeforeDestroy).toContainEqual(['tenant/api', 'Subject']);
  expect(result.owners.has('tenant/api')).toBe(false);
  expect(result.owners.get('account/api')).toBe('SomeoneElse');
});

test('recovers an interrupted replacement with resolved identity and runtime wiring', async () => {
  const result = await scenario({
    cycle: true,
    replace: true,
    read: true,
    absent: true,
    outsideScope: true,
    precreateThrows: true,
    effectWiring: true,
  });
  expect(Exit.isFailure(result.first)).toBe(true);
  expect(result.ownersBeforeDestroy).toContainEqual(['tenant/api', 'Subject']);
  expect(result.checkpoint).toMatchObject({
    props: { name: 'api', scope: 'tenant' },
  });
  expect(result.checkpoint).not.toHaveProperty('propsIncomplete', true);
  expect(result.owners.has('tenant/api')).toBe(false);
  expect(result.owners.get('account/api')).toBe('SomeoneElse');
});

test('the compiled engine recovers an interrupted replacement without losing its physical identity', () => {
  const node = Bun.which('node');
  if (!node) throw new Error('Node is required to verify the compiled engine');
  const marker = 'replacement-report:';
  const child = spawnSync(
    node,
    [
      '--experimental-strip-types',
      '--input-type=module',
      '--eval',
      `
    import { scenario } from './test/helpers/observation-scenario.ts';
    const result = await scenario({cycle: true, replace: true, read: true, absent: true, outsideScope: true, precreateThrows: true, effectWiring: true});
    console.log(${JSON.stringify(marker)} + JSON.stringify({first: result.first._tag, checkpoint: result.checkpoint, ownersBeforeDestroy: result.ownersBeforeDestroy, owners: [...result.owners]}));
  `,
    ],
    { cwd: resolve(import.meta.dir, '..'), encoding: 'utf8', timeout: 30_000 },
  );
  expect(child.status, child.stderr).toBe(0);
  const line = child.stdout.split('\n').find((line) => line.startsWith(marker));
  if (!line) throw new Error('Compiled recovery probe returned no report');
  const report = JSON.parse(line.slice(marker.length));
  expect(report.first).toBe('Failure');
  expect(report.ownersBeforeDestroy).toContainEqual(['tenant/api', 'Subject']);
  expect(report.checkpoint).toMatchObject({
    props: { name: 'api', scope: 'tenant' },
  });
  expect(report.checkpoint).not.toHaveProperty('propsIncomplete', true);
  expect(report.owners).toEqual([['account/api', 'SomeoneElse']]);
}, 35_000);

test('a provider can authorize a resumed cycle with known identity and unresolved peer inputs', async () => {
  const result = await scenario({
    cycle: true,
    replace: true,
    read: true,
    resume: true,
    cyclePeer: true,
  });
  expect(Exit.isSuccess(result.first)).toBe(true);
  expect(result.firstMutations).toContain('reconcile:tenant/api');
  expect(result.checkpoint).toMatchObject({
    props: { name: 'api', scope: 'tenant', source: { value: 'tenant' } },
  });
  expect(result.owners.get('account/api')).toBe('SomeoneElse');
});

for (const partial of [true, false]) {
  test(`an inconclusive resumed cycle preserves identity before mutation (partial=${partial})`, async () => {
    const result = await scenario({
      cycle: true,
      replace: true,
      read: true,
      resume: true,
      cyclePeer: partial,
      outsideScope: !partial,
      resumeScope: partial ? undefined : 'account',
      resumePolicy: partial ? 'partial' : 'inconclusive',
    });
    expect(Exit.isFailure(result.first)).toBe(true);
    expect(JSON.stringify(result.first)).toContain('UnverifiableReplacement');
    expect(result.firstMutations).toEqual([]);
    expect(result.checkpoint).toEqual(result.initialCheckpoint);
    expect(result.checkpoint).toMatchObject({
      status: 'replacing',
      instanceId: 'replacement',
      props: { name: 'api', scope: 'tenant' },
      attr: attributes({ name: 'api', scope: 'tenant' }),
      old: { instanceId: 'old' },
    });
    expect(result.firstOwners).toContainEqual(['old/api', 'Subject']);
    expect(result.firstOwners).toContainEqual(['tenant/api', 'Subject']);
    expect(result.firstOwners).toContainEqual(['account/api', 'SomeoneElse']);
    expect(result.owners.get('account/api')).toBe('SomeoneElse');
  });
}

test('the compiled engine refuses inconclusive cycle resumes before touching either generation', () => {
  const node = Bun.which('node');
  if (!node) throw new Error('Node is required to verify the compiled engine');
  const marker = 'cycle-report:';
  const child = spawnSync(
    node,
    [
      '--experimental-strip-types',
      '--input-type=module',
      '--eval',
      `
    import {scenario} from './test/helpers/observation-scenario.ts';
    const reports=[];
    for(const partial of [true,false]) {
      const r=await scenario({cycle:true,replace:true,read:true,resume:true,cyclePeer:partial,outsideScope:!partial,resumeScope:partial?undefined:'account',resumePolicy:partial?'partial':'inconclusive'});
      reports.push({outcome:r.first._tag,error:JSON.stringify(r.first),mutations:r.firstMutations,checkpoint:r.checkpoint,initialCheckpoint:r.initialCheckpoint,owners:r.firstOwners});
    }
    console.log(${JSON.stringify(marker)}+JSON.stringify(reports));
  `,
    ],
    { cwd: resolve(import.meta.dir, '..'), encoding: 'utf8', timeout: 30_000 },
  );
  expect(child.status, child.stderr).toBe(0);
  const line = child.stdout.split('\n').find((line) => line.startsWith(marker));
  if (!line) throw new Error('Compiled cycle probe returned no report');
  const reports = JSON.parse(line.slice(marker.length));
  expect(reports).toHaveLength(2);
  for (const report of reports) {
    expect(report.outcome).toBe('Failure');
    expect(report.error).toContain('UnverifiableReplacement');
    expect(report.mutations).toEqual([]);
    expect(report.checkpoint).toEqual(report.initialCheckpoint);
    expect(report.checkpoint).toMatchObject({
      status: 'replacing',
      instanceId: 'replacement',
      props: { name: 'api', scope: 'tenant' },
      old: { instanceId: 'old' },
    });
    expect(report.owners).toContainEqual(['account/api', 'SomeoneElse']);
    expect(report.owners).toContainEqual(['old/api', 'Subject']);
    expect(report.owners).toContainEqual(['tenant/api', 'Subject']);
  }
}, 35_000);
