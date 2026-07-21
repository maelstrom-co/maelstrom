import type { Orchestrator } from '@maelstrom-co/client';
import type { MaelstromExtensionContext } from '@maelstrom-co/react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { orchestrationLegibility } from './orchestration-legibility';

function fakeContext(): MaelstromExtensionContext {
  const store = {
    subscribe: () => ({ unsubscribe: () => {} }),
    state: { instances: new Map() },
  };
  const orchestrator = {
    commandProcessor: { store, events: { subscribe: () => ({ unsubscribe: () => {} }) } },
  } as unknown as Orchestrator;

  return {
    useMaelstromContext: () => ({
      orchestrator,
      connector: {} as never,
      config: {} as never,
      onErrorRef: { current: undefined },
    }),
  };
}

describe('useInstanceCount', () => {
  it('server-renders without throwing (needs a getServerSnapshot)', () => {
    const { useInstanceCount } = orchestrationLegibility(fakeContext());

    function InstanceCount() {
      return <>{useInstanceCount()}</>;
    }

    expect(() => renderToString(<InstanceCount />)).not.toThrow();
  });
});
