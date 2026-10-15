import { createContext, type ReactNode, useContext } from 'react';
// Type-only on purpose: a value import would pull the home Vessels (and
// maplibre) into every page that renders the shared chrome.
import type { m } from './maelstrom';

/** The slice of a demo Maelstrom instance the shared voice and intent chrome reads. */
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
