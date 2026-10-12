import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { testVessel } from './__tests__/test-vessel.fixture.js';
import { createMaelstrom } from './create-maelstrom.js';
import type {
  MaelstromExtension,
  MaelstromExtensionContext,
} from './extension-types.js';
import { vessel } from './vessel.js';
import { resetWarnings } from './warn-once.js';

describe('createMaelstrom().with()', () => {
  const entry = vessel(testVessel, () => null);

  it('returns instance with new fields from the extension', () => {
    const ext: MaelstromExtension<{ foo: number }> = () => ({ foo: 42 });
    const m = createMaelstrom({ vessels: [entry] }).with(ext);
    expect(m.foo).toBe(42);
  });

  it('preserves original instance fields after .with()', () => {
    const ext: MaelstromExtension<{ bar: string }> = () => ({ bar: 'baz' });
    const m = createMaelstrom({ vessels: [entry] }).with(ext);
    expect(m.vessels).toBeDefined();
    expect(m.Provider).toBeDefined();
    expect(m.useMaelstrom).toBeDefined();
  });

  it('chained .with(a).with(b) exposes both extensions', () => {
    const extA: MaelstromExtension<{ a: number }> = () => ({ a: 1 });
    const extB: MaelstromExtension<{ b: string }> = () => ({ b: 'two' });
    const m = createMaelstrom({ vessels: [entry] })
      .with(extA)
      .with(extB);
    expect(m.a).toBe(1);
    expect(m.b).toBe('two');
  });

  it('extensions share React context while lifecycle registrations remain branch-local', () => {
    const capturedPairs: MaelstromExtensionContext[] = [];
    const extA: MaelstromExtension<{ a: 1 }> = (ctx) => {
      capturedPairs.push(ctx);
      return { a: 1 };
    };
    const extB: MaelstromExtension<{ b: 2 }> = (ctx) => {
      capturedPairs.push(ctx);
      return { b: 2 };
    };
    createMaelstrom({ vessels: [entry] })
      .with(extA)
      .with(extB);
    expect(capturedPairs).toHaveLength(2);
    expect(capturedPairs[0]).not.toBe(capturedPairs[1]);
    expect(capturedPairs[0]?.useMaelstromContext).toBe(
      capturedPairs[1]?.useMaelstromContext,
    );
    expect(capturedPairs[0]?.onOrchestrator).not.toBe(
      capturedPairs[1]?.onOrchestrator,
    );
  });

  it('.with() returns an instance that still supports further .with() chaining', () => {
    const extA: MaelstromExtension<{ a: 1 }> = () => ({ a: 1 });
    const extB: MaelstromExtension<{ b: 2 }> = () => ({ b: 2 });
    const extC: MaelstromExtension<{ c: 3 }> = () => ({ c: 3 });
    const m = createMaelstrom({ vessels: [entry] })
      .with(extA)
      .with(extB)
      .with(extC);
    expect(m.a).toBe(1);
    expect(m.b).toBe(2);
    expect(m.c).toBe(3);
  });

  describe('key collisions', () => {
    let warnSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
      resetWarnings();
      warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it('cross-extension collision: later extension wins and warns once', () => {
      const extA: MaelstromExtension<{ shared: string }> = () => ({
        shared: 'from-A',
      });
      const extB: MaelstromExtension<{ shared: string }> = () => ({
        shared: 'from-B',
      });
      const m = createMaelstrom({ vessels: [entry] })
        .with(extA)
        .with(extB);

      expect(m.shared).toBe('from-B');
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]?.[0]).toContain("'shared'");
    });

    it('cross-extension collision: warn fires only once per key across the lifetime', () => {
      const extA: MaelstromExtension<{ shared: number }> = () => ({
        shared: 1,
      });
      const extB: MaelstromExtension<{ shared: number }> = () => ({
        shared: 2,
      });

      createMaelstrom({ vessels: [entry] })
        .with(extA)
        .with(extB);
      createMaelstrom({ vessels: [entry] })
        .with(extA)
        .with(extB);

      expect(warnSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('branched non-mutation', () => {
    it('m.with(extA) and m.with(extB) from the same root do not cross-contaminate', () => {
      const extA: MaelstromExtension<{ a: string }> = () => ({ a: 'A' });
      const extB: MaelstromExtension<{ b: string }> = () => ({ b: 'B' });
      const root = createMaelstrom({ vessels: [entry] });

      const branchA = root.with(extA);
      const branchB = root.with(extB);

      expect(branchA.a).toBe('A');
      expect(branchB.b).toBe('B');
      expect((branchA as { b?: unknown }).b).toBeUndefined();
      expect((branchB as { a?: unknown }).a).toBeUndefined();
    });

    it('does not mutate the receiver when calling .with()', () => {
      const ext: MaelstromExtension<{ added: number }> = () => ({ added: 1 });
      const root = createMaelstrom({ vessels: [entry] });

      root.with(ext);

      expect((root as { added?: unknown }).added).toBeUndefined();
    });
  });
});
