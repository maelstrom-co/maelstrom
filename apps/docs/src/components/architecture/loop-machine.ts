export type LoopStep =
  | 'intent'
  | 'request'
  | 'decide'
  | 'respond'
  | 'layout'
  | 'actions'
  | 'observe'
  | 'loop';

// The client applies a response in a fixed, load-bearing order: layout before
// actions. An action can transition a vessel to another variant (which carries
// its own minSize), so positions and sizes are set before actions run.
export const APPLY_ORDER: LoopStep[] = ['layout', 'actions'];

// One full round-trip of the runtime feedback loop, in order. The final beat
// ('loop') closes back to 'request': a changed grid becomes a new request.
export const STEPS: LoopStep[] = [
  'intent',
  'request',
  'decide',
  'respond',
  'layout',
  'actions',
  'observe',
  'loop',
];

export interface LoopState {
  index: number;
  playing: boolean;
}

export type LoopAction = {
  type: 'play' | 'pause' | 'next' | 'prev' | 'restart' | 'tick';
};

export const initialLoopState: LoopState = { index: 0, playing: false };

const LAST = STEPS.length - 1;

export function loopReducer(state: LoopState, action: LoopAction): LoopState {
  switch (action.type) {
    case 'play':
      // Restart from the top if we are sitting on the final step.
      return state.index >= LAST
        ? { index: 0, playing: true }
        : { ...state, playing: true };
    case 'pause':
      return { ...state, playing: false };
    case 'next':
      return { ...state, index: Math.min(state.index + 1, LAST) };
    case 'prev':
      return { ...state, index: Math.max(state.index - 1, 0) };
    case 'restart':
      return { ...initialLoopState };
    case 'tick': {
      if (state.index >= LAST) return { ...state, playing: false };
      return { ...state, index: state.index + 1 };
    }
    default:
      return state;
  }
}

const CAPTIONS: Record<LoopStep, string> = {
  intent: 'You ask for something — a user intent',
  request: 'The client sends a ChartRequest to the engine',
  decide: 'The engine runs an LLM to pick actions and a layout',
  respond: 'The engine returns a MaelstromResponse',
  layout: 'The client applies the new layout (set_layout)',
  actions: 'The client runs the executionPlan (execute_actions)',
  observe: 'A ResizeObserver measures the result in grid cells',
  loop: 'Changed cells become a chart_resize — the loop repeats',
};

export function stepCaption(step: LoopStep): string {
  return CAPTIONS[step];
}
