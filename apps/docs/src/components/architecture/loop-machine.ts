export type LoopStep =
  | 'intent'
  | 'request'
  | 'decide'
  | 'respond'
  | 'layout'
  | 'actions'
  | 'observe'
  | 'loop';

// Layout must establish an Instance before an Action in the same response
// can target it.
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
  intent: 'A user intent starts a Chart update',
  request: 'The client sends the Chart state in a ChartRequestMessage',
  decide: 'The Planner proposes changes; the Engine validates them',
  respond: 'The engine returns a MaelstromResponse',
  layout: 'The client applies the new layout (set_layout)',
  actions: 'The client runs the executionPlan (execute_actions)',
  observe: 'A ResizeObserver measures the Chart container',
  loop: 'Changed cell dimensions start a new chart_resize request',
};

export function stepCaption(step: LoopStep): string {
  return CAPTIONS[step];
}
