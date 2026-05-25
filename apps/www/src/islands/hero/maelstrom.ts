import { createMaelstrom } from '@maelstrom-co/react';
import {
  appointmentsEntry,
  labEntry,
  medicationsEntry,
  vitalsEntry,
} from './registrations';

export const mHero = createMaelstrom({
  vessels: [labEntry, vitalsEntry, medicationsEntry, appointmentsEntry],
});
