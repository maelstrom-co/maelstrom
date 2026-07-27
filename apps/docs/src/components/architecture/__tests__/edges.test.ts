import { describe, expect, it } from 'bun:test';
import { channelDirectionForStep, EDGES } from '../edges';
import { STEPS } from '../loop-machine';
import { NODES } from '../nodes';

describe('EDGES', () => {
  it('every endpoint references a known node', () => {
    const ids = new Set(NODES.map((n) => n.id));
    for (const e of EDGES) {
      expect(ids.has(e.from)).toBe(true);
      expect(ids.has(e.to)).toBe(true);
    }
  });

  it('dependency edges mirror the build dependencies declared in nodes.ts', () => {
    const deps = new Set(
      NODES.flatMap((n) => n.dependsOn.map((d) => `${n.id}<-${d}`)),
    );
    for (const e of EDGES.filter((e) => e.kind === 'dependency')) {
      expect(deps.has(`${e.to}<-${e.from}`)).toBe(true);
    }
  });

  it('the channel is the spine client → protocol → engine', () => {
    const channel = EDGES.filter((e) => e.kind === 'channel');
    expect(channel.map((e) => e.id)).toEqual([
      'client-protocol',
      'protocol-engine',
    ]);
  });
});

describe('channelDirectionForStep', () => {
  it('travels forward on request and reverse on respond', () => {
    expect(channelDirectionForStep('request')).toBe('forward');
    expect(channelDirectionForStep('respond')).toBe('reverse');
  });

  it('is null for every other beat (apply/observe/intent/decide/loop)', () => {
    for (const step of STEPS.filter(
      (s) => s !== 'request' && s !== 'respond',
    )) {
      expect(channelDirectionForStep(step)).toBeNull();
    }
  });
});
