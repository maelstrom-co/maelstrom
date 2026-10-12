import {
  createDevtools,
  type DevtoolsOptions,
  mountDevtools,
} from '@maelstrom-co/devtools/production';
import type { MaelstromExtension } from '@maelstrom-co/react';
import { type ComponentType, useEffect } from 'react';

export type { DevtoolsOptions } from '@maelstrom-co/devtools/production';

/** React fields added by the diagnostic extension. */
export interface DevtoolsExtension {
  /** Mount near the configured Providers. Retained evidence stays accessible without an active Provider. */
  readonly Devtools: ComponentType;
}

/** Adds diagnostics in every build, including production, without requiring voice. */
export function devtools(
  options: DevtoolsOptions = {},
): MaelstromExtension<DevtoolsExtension> {
  return (context) => {
    if (options.enabled === false) return { Devtools: () => null };
    const tools = createDevtools(options);
    if (context.onOrchestrator) {
      context.onOrchestrator((orchestrator) => tools.attach(orchestrator));
      function Devtools(): null {
        useEffect(() => mountDevtools(tools), []);
        return null;
      }
      return { Devtools };
    }
    function Devtools(): null {
      const { orchestrator } = context.useMaelstromContext();
      useEffect(() => {
        const detach = tools.attach(orchestrator);
        const unmount = mountDevtools(tools);
        return () => {
          unmount();
          detach?.();
        };
      }, [orchestrator]);
      return null;
    }
    return { Devtools };
  };
}
