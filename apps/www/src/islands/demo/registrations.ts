import { vessel } from '@maelstrom-co/react';
import CalendarComponent from './vessels/CalendarComponent';
import { calendarVessel } from './vessels/calendar.vessel';
import NotesComponent from './vessels/NotesComponent';
import { notesVessel } from './vessels/notes.vessel';
import TasksComponent from './vessels/TasksComponent';
import { tasksVessel } from './vessels/tasks.vessel';
import WeatherComponent from './vessels/WeatherComponent';
import { weatherVessel } from './vessels/weather.vessel';

export const weatherEntry = vessel(weatherVessel, WeatherComponent);
export const calendarEntry = vessel(calendarVessel, CalendarComponent);
export const notesEntry = vessel(notesVessel, NotesComponent);
export const tasksEntry = vessel(tasksVessel, TasksComponent);
