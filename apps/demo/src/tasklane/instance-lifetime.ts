import type {
  MaelstromExtension,
  MaelstromExtensionContext,
} from '@maelstrom-co/react';
import { useEffect, useRef } from 'react';

export interface TasklaneInstanceLifetime {
  /** Runs `onChange` with the live Instance ids on mount and whenever the set of Instances changes. */
  useLiveInstances: (
    onChange: (liveInstanceIds: ReadonlySet<string>) => void,
  ) => void;
}

/**
 * A Vessel component unmounts on a variant switch or while hidden, and its
 * Instance still exists, so per-Instance state must follow the command
 * processor's Instances rather than the component's lifetime.
 */
export const tasklaneInstanceLifetime: MaelstromExtension<
  TasklaneInstanceLifetime
> = (ctx: MaelstromExtensionContext) => ({
  useLiveInstances: (onChange) => {
    const { orchestrator } = ctx.useMaelstromContext();
    const latest = useRef(onChange);
    latest.current = onChange;
    useEffect(() => {
      const store = orchestrator.commandProcessor.store;
      let seen = store.state.instances;
      const report = () =>
        latest.current(new Set([...seen.keys()].map(String)));
      report();
      const subscription = store.subscribe(() => {
        if (store.state.instances === seen) return;
        seen = store.state.instances;
        report();
      });
      return () => subscription.unsubscribe();
    }, [orchestrator]);
  },
});
