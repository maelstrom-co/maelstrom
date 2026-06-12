import { vessel } from '@maelstrom-co/react';
import AppointmentsComponent from './vessels/AppointmentsComponent';
import { appointmentsVessel } from './vessels/appointments.vessel';
import LabComponent from './vessels/LabComponent';
import { labVessel } from './vessels/lab.vessel';
import MedicationsComponent from './vessels/MedicationsComponent';
import { medicationsVessel } from './vessels/medications.vessel';
import VitalsComponent from './vessels/VitalsComponent';
import { vitalsVessel } from './vessels/vitals.vessel';

export const labEntry = vessel(labVessel, LabComponent);
export const vitalsEntry = vessel(vitalsVessel, VitalsComponent);
export const medicationsEntry = vessel(medicationsVessel, MedicationsComponent);
export const appointmentsEntry = vessel(
  appointmentsVessel,
  AppointmentsComponent,
);
