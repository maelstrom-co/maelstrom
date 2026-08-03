import { describe, expect, it } from 'bun:test';
import { NODES, nodeById } from '../nodes';

describe('NODES', () => {
  it('contains exactly the five core packages', () => {
    expect(NODES.map((n) => n.id).sort()).toEqual(
      ['client', 'demo', 'engine', 'protocol', 'react'].sort(),
    );
  });

  it('every dependsOn id resolves to a known node', () => {
    const ids = new Set(NODES.map((n) => n.id));
    for (const n of NODES) {
      for (const dep of n.dependsOn) {
        expect(ids.has(dep)).toBe(true);
      }
    }
  });

  it('assigns protocol to the contract zone and engine to server', () => {
    expect(nodeById('protocol')?.zone).toBe('contract');
    expect(nodeById('engine')?.zone).toBe('server');
  });

  it('gives every node a non-empty role and an absolute deep-dive href', () => {
    for (const n of NODES) {
      expect(n.role.length).toBeGreaterThan(0);
      expect(n.deepDiveHref.startsWith('/')).toBe(true);
    }
  });
});
