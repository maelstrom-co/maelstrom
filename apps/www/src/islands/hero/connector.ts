import {
  InstanceId,
  type TilingLayout,
  tilingLeafToken,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';
import {
  buildScriptedSteps,
  ScriptedConnector,
  type StepMeta,
} from '../shared/ScriptedConnector';

const LAB = InstanceId('hero-lab');
const VITALS = InstanceId('hero-vitals');
const MEDS = InstanceId('hero-meds');
const APPTS = InstanceId('hero-appts');

const LAB_LEAF = tilingLeafToken(LAB);
const VITALS_LEAF = tilingLeafToken(VITALS);
const MEDS_LEAF = tilingLeafToken(MEDS);
const APPTS_LEAF = tilingLeafToken(APPTS);

type Inst = TilingLayout['instances'][number];

const labFull: Inst = {
  instanceId: LAB,
  vesselId: VesselId('lab'),
  variant: VariantName('full'),
};
const vitalsDefault: Inst = {
  instanceId: VITALS,
  vesselId: VesselId('vitals'),
  variant: VariantName('default'),
};
const vitalsWide: Inst = {
  instanceId: VITALS,
  vesselId: VesselId('vitals'),
  variant: VariantName('wide'),
};
const medsDefault: Inst = {
  instanceId: MEDS,
  vesselId: VesselId('medications'),
  variant: VariantName('default'),
};
const apptsDefault: Inst = {
  instanceId: APPTS,
  vesselId: VesselId('appointments'),
  variant: VariantName('default'),
};
const apptsBig: Inst = {
  instanceId: APPTS,
  vesselId: VesselId('appointments'),
  variant: VariantName('big'),
};

// Desktop tiling: 'V' = left/right, 'H' = top/bottom; ~50/50 splits. Each focus
// gives the emphasized vessel a whole side and stacks the rest, avoiding cramped
// 3-across rows.
const DESKTOP_LAYOUTS: TilingLayout[] = [
  // Initial: full overview — all four vessels.
  {
    type: 'tiling',
    tree: ['H', 'V', LAB_LEAF, VITALS_LEAF, 'V', MEDS_LEAF, APPTS_LEAF],
    instances: [labFull, vitalsDefault, medsDefault, apptsDefault],
  },
  // "show me my lab results" → labs only; everything irrelevant recedes.
  { type: 'tiling', tree: [LAB_LEAF], instances: [labFull] },
  // "check my vitals" → vitals strip + labs (two-up shows the tiling).
  {
    type: 'tiling',
    tree: ['H', VITALS_LEAF, LAB_LEAF],
    instances: [vitalsWide, labFull],
  },
  // "what are my appointments this week" → appointments + medications.
  {
    type: 'tiling',
    tree: ['V', APPTS_LEAF, MEDS_LEAF],
    instances: [apptsBig, medsDefault],
  },
];

// Stacks two cards as 50/50 top/bottom tiles (focused vessel on top). A flat
// pair, no nesting — so neither card gets geometrically squashed.
function stacked(top: Inst, bottom: Inst): TilingLayout {
  return {
    type: 'tiling',
    tree: [
      'H',
      tilingLeafToken(top.instanceId),
      tilingLeafToken(bottom.instanceId),
    ],
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

// Prompts/messages/actions are layout-independent; only the tiling differs per
// breakpoint, so steps are assembled from this shared metadata + the layouts.
const STEP_META: StepMeta[] = [
  {
    userMessage: 'Your health dashboard.',
    rationale: 'Opening overview.',
    executionPlan: [],
  },
  {
    prompt: 'show me my lab results',
    userMessage: 'Here are your latest lab results.',
    rationale: 'Brought labs forward with the glucose trend.',
    executionPlan: [],
  },
  {
    prompt: 'check my vitals',
    userMessage: 'Your latest vitals.',
    rationale: 'Spread vitals across the top for a quick read.',
    executionPlan: [],
  },
  {
    prompt: 'what are my appointments this week',
    userMessage: "Here's what's coming up.",
    rationale: 'Expanded your upcoming appointments.',
    executionPlan: [],
  },
];

export const createHeroConnector = (isMobile = false): ScriptedConnector =>
  new ScriptedConnector(
    buildScriptedSteps(STEP_META, isMobile ? MOBILE_LAYOUTS : DESKTOP_LAYOUTS),
  );
