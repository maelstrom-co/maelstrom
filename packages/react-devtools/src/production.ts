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
  /**
   * Permanently unmounts this factory's panels and releases its diagnostic observers and collector.
   * A disposed factory cannot resume diagnostics.
   * Caller-supplied capture stores keep their recording and content; owned stores are stopped and cleared.
   * Repeated calls are inert.
   */
  readonly disposeDevtools: () => void;
}

/** Adds diagnostics in every build, including production, without requiring voice. */
export function devtools(
  options: DevtoolsOptions = {},
): MaelstromExtension<DevtoolsExtension> {
  return (context) => {
    if (options.enabled === false)
      return { Devtools: () => null, disposeDevtools: () => {} };
    const tools = createDevtools(options);
    const preserveCapture = tools.capture === options.capture;
    let disposed = false;
    const panels = new Set<() => void>();
    const mountPanel = () => {
      if (disposed) return;
      const release = mountDevtools(tools);
      const unmount = () => {
        panels.delete(unmount);
        release();
      };
      panels.add(unmount);
      return unmount;
    };
    const unregister = context.onOrchestrator?.((orchestrator) =>
      tools.attach(orchestrator),
    );
    const disposeDevtools = () => {
      if (disposed) return;
      disposed = true;
      for (const unmount of [...panels]) unmount();
      unregister?.();
      tools.dispose({ preserveCapture });
    };
    if (context.onOrchestrator) {
      function Devtools(): null {
        useEffect(mountPanel, []);
        return null;
      }
      return { Devtools, disposeDevtools };
    }
    function Devtools(): null {
      const { orchestrator } = context.useMaelstromContext();
      useEffect(() => {
        if (disposed) return;
        const detach = tools.attach(orchestrator);
        const unmount = mountPanel();
        return () => {
          unmount?.();
          detach?.();
        };
      }, [orchestrator]);
      return null;
    }
    return { Devtools, disposeDevtools };
  };
}
