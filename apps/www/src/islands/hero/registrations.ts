import { vessel } from '@maelstrom-co/react';

import { appointmentsVessel } from './vessels/appointments.vessel';
import AppointmentsComponent from './vessels/AppointmentsComponent';
import { labVessel } from './vessels/lab.vessel';
import LabComponent from './vessels/LabComponent';
import { medicationsVessel } from './vessels/medications.vessel';
import MedicationsComponent from './vessels/MedicationsComponent';
import { vitalsVessel } from './vessels/vitals.vessel';
import VitalsComponent from './vessels/VitalsComponent';

export const labEntry = vessel(labVessel, LabComponent);
export const vitalsEntry = vessel(vitalsVessel, VitalsComponent);
export const medicationsEntry = vessel(medicationsVessel, MedicationsComponent);
export const appointmentsEntry = vessel(
  appointmentsVessel,
  AppointmentsComponent,
);
