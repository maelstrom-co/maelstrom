import type {
  createMaelstrom,
  defineVessel,
  vessel,
} from '@maelstrom-co/react';
import type { ReactNode } from 'react';

export type MaelstromFactoryConfig = Parameters<typeof createMaelstrom>[0];
export type VesselDefinitionFactory = typeof defineVessel;
export type VesselEntryFactory = typeof vessel;
export function SdkImportTypeProbe({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
