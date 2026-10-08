import { createContext, useContext } from 'react';
import { m } from './maelstrom';

/** The per-page surface the shared demo chrome reads; independent of which vessels a page registers. */
export type DemoMaelstrom = Pick<
  typeof m,
  | 'Provider'
  | 'Chart'
  | 'useMaelstrom'
  | 'useVoice'
  | 'useVoiceObservations'
  | 'VoiceOrb'
  | 'useTouchedInstances'
  | 'useInstanceCount'
>;

const DemoMaelstromContext = createContext<DemoMaelstrom>(m);

/** Selects which page instance the shared chrome below it talks to. */
export const DemoMaelstromProvider = DemoMaelstromContext.Provider;

/** The page's Maelstrom instance; the home instance when no page provides one. */
export function useDemoMaelstrom(): DemoMaelstrom {
  return useContext(DemoMaelstromContext);
}
