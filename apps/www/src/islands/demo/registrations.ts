import { vesselRegistration } from '@maelstrom-co/react-old';
import CalendarComponent from './vessels/CalendarComponent';
import { calendarVessel } from './vessels/calendar.vessel';
import NotesComponent from './vessels/NotesComponent';
import { notesVessel } from './vessels/notes.vessel';
import TasksComponent from './vessels/TasksComponent';
import { tasksVessel } from './vessels/tasks.vessel';
import WeatherComponent from './vessels/WeatherComponent';
import { weatherVessel } from './vessels/weather.vessel';

export const weatherRegistration = vesselRegistration(
  weatherVessel,
  WeatherComponent,
);
export const calendarRegistration = vesselRegistration(
  calendarVessel,
  CalendarComponent,
);
export const notesRegistration = vesselRegistration(
  notesVessel,
  NotesComponent,
);
export const tasksRegistration = vesselRegistration(
  tasksVessel,
  TasksComponent,
);
