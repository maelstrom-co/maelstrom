import { vessel } from '@maelstrom-co/react';

import { calendarVessel } from './vessels/calendar.vessel';
import CalendarComponent from './vessels/CalendarComponent';
import { notesVessel } from './vessels/notes.vessel';
import NotesComponent from './vessels/NotesComponent';
import { tasksVessel } from './vessels/tasks.vessel';
import TasksComponent from './vessels/TasksComponent';
import { weatherVessel } from './vessels/weather.vessel';
import WeatherComponent from './vessels/WeatherComponent';

export const weatherEntry = vessel(weatherVessel, WeatherComponent);
export const calendarEntry = vessel(calendarVessel, CalendarComponent);
export const notesEntry = vessel(notesVessel, NotesComponent);
export const tasksEntry = vessel(tasksVessel, TasksComponent);
