import { describe, expect, test } from 'bun:test';
import {
  fakePluginWith,
  TOKYO_CANDIDATE,
} from './__test-helpers__/fake-planner.js';
import { armRegistry, defaultArms, pluginOf, resolveArms } from './arms.js';
import type { PlannerEvalPlugin } from './plugin.js';

const fake = fakePluginWith({ candidate: () => TOKYO_CANDIDATE });
const other: PlannerEvalPlugin = {
  name: 'other',
  arms: [
    {
      name: 'other-baseline',
      baseline: true,
      build: () => async () => {
        throw new Error('not called');
      },
    },
  ],
  defaultArms: ['other-baseline'],
};

describe('arm registry', () => {
  test('holds every arm of every plugin by name, in registration order', () => {
    expect([...armRegistry([other, fake]).keys()]).toEqual([
      'other-baseline',
      'fake-baseline',
      'fake',
      'fake-poc',
    ]);
    expect(armRegistry([fake]).get('fake')?.plugin).toBe(fake);
  });

  test('refuses two arms with one name, across plugins too', () => {
    expect(() => armRegistry([fake, fake])).toThrow(
      'arm fake-baseline is registered twice',
    );
  });

  test('runs every plugin default when --arm is not given', () => {
    expect(defaultArms([other, fake])).toEqual(['other-baseline', 'fake']);
  });

  test('resolves exact names in the order given, with the owning plugin', () => {
    const resolved = resolveArms([other, fake], ['fake', 'other-baseline']);
    expect(resolved.map(({ arm }) => arm.name)).toEqual([
      'fake',
      'other-baseline',
    ]);
    expect(resolved.map(({ plugin }) => plugin.name)).toEqual([
      'fake',
      'other',
    ]);
  });

  test('resolves a plugin alias and drops repeated names, keeping the first position', () => {
    expect(
      resolveArms([fake], ['poc', 'fake', 'fake-poc', 'poc']).map(
        ({ arm }) => arm.name,
      ),
    ).toEqual(['fake-poc', 'fake']);
  });

  test('rejects an unknown name, listing the known ones with their aliases', () => {
    expect(() => resolveArms([other, fake], ['fake', 'nope'])).toThrow(
      'unknown arm nope; known arms: other-baseline, fake-baseline, fake, fake-poc (alias poc)',
    );
    expect(() => resolveArms([fake], [])).toThrow('at least one arm');
  });

  test('names the plugin that registered an arm', () => {
    expect(pluginOf([other, fake], 'fake-poc')).toBe(fake);
    expect(pluginOf([other, fake], 'retired')).toBe(undefined);
  });
});
