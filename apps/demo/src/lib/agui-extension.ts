import type { Orchestrator } from '@maelstrom-co/client';
import type { MaelstromExtension } from '@maelstrom-co/react';

export const aguiExperiment: MaelstromExtension<{
  useExperimentalOrchestrator: () => Orchestrator;
}> = (ctx) => ({
  useExperimentalOrchestrator: () => ctx.useMaelstromContext().orchestrator,
});
