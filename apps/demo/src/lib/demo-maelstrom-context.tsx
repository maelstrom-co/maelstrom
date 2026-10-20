import { createContext, type ReactNode, useContext } from 'react';
// Type-only on purpose: a value import would evaluate the home instance
// (vessel definitions, realtime wiring, devtools capture) on every page that
// renders the shared chrome, even when that page hosts a different instance.
import type { m } from './maelstrom';

/** The members of a demo Maelstrom instance that the shared workspace, voice and intent chrome call. */
export type DemoMaelstrom = Pick<
  typeof m,
  | 'Provider'
  | 'Chart'
  | 'Devtools'
  | 'useMaelstrom'
  | 'useVoice'
  | 'useVoiceObservations'
  | 'VoiceOrb'
  | 'useTouchedInstances'
  | 'useInstanceCount'
>;

const DemoMaelstromContext = createContext<DemoMaelstrom | null>(null);
DemoMaelstromContext.displayName = 'DemoMaelstromContext';

export function DemoMaelstromProvider({
  maelstrom,
  children,
}: Readonly<{ maelstrom: DemoMaelstrom; children: ReactNode }>) {
  return (
    <DemoMaelstromContext.Provider value={maelstrom}>
      {children}
    </DemoMaelstromContext.Provider>
  );
}

export function useDemoMaelstrom(): DemoMaelstrom {
  const maelstrom = useContext(DemoMaelstromContext);
  if (!maelstrom)
    throw new Error(
      'useDemoMaelstrom() must be used inside a <DemoMaelstromProvider>.',
    );
  return maelstrom;
}
