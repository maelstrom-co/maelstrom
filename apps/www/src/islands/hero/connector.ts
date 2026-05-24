import { InstanceId, type TilingLayout } from '@maelstrom-co/protocol';
import {
  ScriptedConnector,
  type ScriptedStep,
} from '../shared/ScriptedConnector';
import type { DemoScriptStep } from '../shared/MaelstromDemo';

const LAB = InstanceId('hero-lab');
const VITALS = InstanceId('hero-vitals');
const MEDS = InstanceId('hero-meds');
const APPTS = InstanceId('hero-appts');

type Inst = TilingLayout['instances'][number];

const labFull: Inst = { instanceId: LAB, vesselId: 'lab', variant: 'full' };
const vitalsDefault: Inst = {
  instanceId: VITALS,
  vesselId: 'vitals',
  variant: 'default',
};
const vitalsWide: Inst = {
  instanceId: VITALS,
  vesselId: 'vitals',
  variant: 'wide',
};
const medsDefault: Inst = {
  instanceId: MEDS,
  vesselId: 'medications',
  variant: 'default',
};
const apptsDefault: Inst = {
  instanceId: APPTS,
  vesselId: 'appointments',
  variant: 'default',
};
const apptsBig: Inst = {
  instanceId: APPTS,
  vesselId: 'appointments',
  variant: 'big',
};

// Desktop tiling: 'V' = left/right, 'H' = top/bottom; ~50/50 splits. Each focus
// gives the emphasized vessel a whole side and stacks the rest, avoiding cramped
// 3-across rows.
const DESKTOP_LAYOUTS: TilingLayout[] = [
  // Initial: full overview — all four vessels.
  {
    type: 'tiling',
    tree: ['H', 'V', LAB, VITALS, 'V', MEDS, APPTS],
    instances: [labFull, vitalsDefault, medsDefault, apptsDefault],
  },
  // "show me my lab results" → labs only; everything irrelevant recedes.
  { type: 'tiling', tree: [LAB], instances: [labFull] },
  // "check my vitals" → vitals strip + labs (two-up shows the tiling).
  {
    type: 'tiling',
    tree: ['H', VITALS, LAB],
    instances: [vitalsWide, labFull],
  },
  // "what are my appointments this week" → appointments + medications.
  {
    type: 'tiling',
    tree: ['V', APPTS, MEDS],
    instances: [apptsBig, medsDefault],
  },
];

// Stacks two cards as 50/50 top/bottom tiles (focused vessel on top). A flat
// pair, no nesting — so neither card gets geometrically squashed.
function stacked(top: Inst, bottom: Inst): TilingLayout {
  return {
    type: 'tiling',
    tree: ['H', top.instanceId, bottom.instanceId],
    instances: [top, bottom],
  };
}

// At a fixed height a single column only fits ~2 cards, so each mobile step
// shows the two most relevant — the engine bringing what fits into focus rather
// than squashing all four. 'default' appointments (not the desktop 'big'
// variant) so the card fits a stacked row.
const MOBILE_LAYOUTS: TilingLayout[] = [
  stacked(labFull, apptsDefault), // overview: glucose trend + what's coming up
  stacked(labFull, vitalsWide), // labs + vitals
  stacked(vitalsWide, labFull), // vitals + labs
  stacked(apptsDefault, medsDefault), // appointments + medications
];

type StepMeta = { prompt?: string; userMessage: string; rationale: string };

const STEP_META: StepMeta[] = [
  { userMessage: 'Your health dashboard.', rationale: 'Opening overview.' },
  {
    prompt: 'show me my lab results',
    userMessage: 'Here are your latest lab results.',
    rationale: 'Brought labs forward with the glucose trend.',
  },
  {
    prompt: 'check my vitals',
    userMessage: 'Your latest vitals.',
    rationale: 'Spread vitals across the top for a quick read.',
  },
  {
    prompt: 'what are my appointments this week',
    userMessage: "Here's what's coming up.",
    rationale: 'Expanded your upcoming appointments.',
  },
];

const buildSteps = (layouts: TilingLayout[]): ScriptedStep[] => {
  if (layouts.length !== STEP_META.length) {
    throw new Error(
      `buildSteps: expected ${STEP_META.length} layouts, got ${layouts.length}`,
    );
  }
  return STEP_META.map((meta, i) => ({
    ...meta,
    executionPlan: [],
    layout: layouts[i],
  }));
};

export const createHeroConnector = (isMobile = false) =>
  new ScriptedConnector(buildSteps(isMobile ? MOBILE_LAYOUTS : DESKTOP_LAYOUTS));

/** Prompts + rationales for MaelstromDemo, aligned with STEP_META[1..]. */
export const HERO_SCRIPT: DemoScriptStep[] = STEP_META.slice(1).map((meta) => ({
  prompt: meta.prompt!,
  rationale: meta.rationale,
}));
