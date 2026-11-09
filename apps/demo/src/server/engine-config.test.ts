import type { AnyTextAdapter } from '@tanstack/ai';
import { describe, expect, it } from 'vitest';

import { createDemoAgentConfig } from './engine-config';

describe('createDemoAgentConfig', () => {
  it('registers exactly one read-only Server Tool for the latest order', () => {
    const adapter = { name: 'stub-adapter' } as unknown as AnyTextAdapter;

    const config = createDemoAgentConfig(adapter);

    expect(config.model).toBe(adapter);
    expect(config.instructions).toMatch(/pet shop/);
    expect(config.budgets).toBeUndefined();
    expect(config.tools).toHaveLength(1);
    expect(config.tools?.[0]).toMatchObject({
      name: 'latest_order',
      locus: 'server',
      sideEffect: 'read_only',
    });
  });
});
