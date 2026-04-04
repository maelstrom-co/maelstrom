// ── Interfaces ───────────────────────────────────────────────────────────

export interface TranscriptLine {
  speaker: 'doctor' | 'patient' | 'system';
  text: string;
  at: number;
}

export interface PanelDef {
  id: string;
  name: string;
  color: string;
}

export interface LayoutSlot {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DashboardKeyframe {
  at: number;
  label: string;
  layout: LayoutSlot[];
}

export type OrbState = 'idle' | 'listening' | 'responding';

export interface OrbKeyframe {
  at: number;
  state: OrbState;
}

// ── Data ─────────────────────────────────────────────────────────────────

export const transcript: TranscriptLine[] = [
  { speaker: 'doctor', text: '"How long have you had the chest pain?"', at: 0.10 },
  { speaker: 'patient', text: '"About two weeks, mostly at night."', at: 0.22 },
  { speaker: 'system', text: 'Showing cardiac history + recent labs.', at: 0.34 },
  { speaker: 'doctor', text: '"Any family history of heart disease?"', at: 0.50 },
  { speaker: 'patient', text: '"My father had a bypass at 55."', at: 0.60 },
  { speaker: 'system', text: 'Flagging hereditary risk factors.', at: 0.72 },
];

// All unique panels across all states
export const allPanels: PanelDef[] = [
  { id: 'patient-info', name: 'Patient Info', color: '#00f0ff' },
  { id: 'vitals', name: 'Vitals', color: '#0066ff' },
  { id: 'notes', name: 'Notes', color: '#00ffa3' },
  { id: 'schedule', name: 'Schedule', color: '#6b00ff' },
  { id: 'cardiac', name: 'Cardiac History', color: '#00f0ff' },
  { id: 'labs', name: 'Recent Labs', color: '#0066ff' },
  { id: 'family', name: 'Family History', color: '#6b00ff' },
  { id: 'risk', name: 'Risk Factors', color: '#ff4444' },
];

export const panelMap = new Map(allPanels.map((p) => [p.id, p]));

// Layouts use normalized coordinates (0-1 range, computed to px)
export const dashboardKeyframes: DashboardKeyframe[] = [
  {
    at: 0,
    label: 'Patient Visit',
    layout: [
      { id: 'patient-info', x: 0, y: 0, w: 0.48, h: 0.48 },
      { id: 'vitals', x: 0.52, y: 0, w: 0.48, h: 0.48 },
      { id: 'notes', x: 0, y: 0.52, w: 0.48, h: 0.48 },
      { id: 'schedule', x: 0.52, y: 0.52, w: 0.48, h: 0.48 },
    ],
  },
  {
    at: 0.34,
    label: 'Cardiac Context',
    layout: [
      { id: 'cardiac', x: 0, y: 0, w: 1, h: 0.55 },
      { id: 'labs', x: 0, y: 0.58, w: 0.48, h: 0.42 },
      { id: 'vitals', x: 0.52, y: 0.58, w: 0.48, h: 0.42 },
    ],
  },
  {
    at: 0.72,
    label: 'Risk Assessment',
    layout: [
      { id: 'family', x: 0, y: 0, w: 1, h: 0.55 },
      { id: 'cardiac', x: 0, y: 0.58, w: 0.48, h: 0.42 },
      { id: 'risk', x: 0.52, y: 0.58, w: 0.48, h: 0.42 },
    ],
  },
];

export const orbKeyframes: OrbKeyframe[] = [
  { at: 0, state: 'idle' },
  { at: 0.10, state: 'listening' },
  { at: 0.32, state: 'responding' },
  { at: 0.42, state: 'idle' },
  { at: 0.50, state: 'listening' },
  { at: 0.70, state: 'responding' },
  { at: 0.84, state: 'idle' },
];
