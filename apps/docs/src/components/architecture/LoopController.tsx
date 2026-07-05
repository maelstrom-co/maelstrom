import type { LoopAction, LoopState } from './loop-machine';

const ICONS = {
  restart:
    'M17.65 6.35A8 8 0 1 0 19.73 14h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4z',
  prev: 'M14 6l-6 6 6 6V6z',
  next: 'M10 6l6 6-6 6V6z',
  play: 'M8 5v14l11-7L8 5z',
  pause: 'M7 5h3v14H7zM14 5h3v14h-3z',
} as const;

function Icon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

export function LoopController({
  state,
  dispatch,
  showDetail,
  onToggleDetail,
}: {
  state: LoopState;
  dispatch: (a: LoopAction) => void;
  showDetail: boolean;
  onToggleDetail: () => void;
}) {
  return (
    <div className="arch-controls">
      <div className="arch-controls__buttons">
        <button
          type="button"
          className="arch-controls__btn"
          onClick={() => dispatch({ type: 'restart' })}
          aria-label="Restart"
        >
          <Icon path={ICONS.restart} />
        </button>
        <button
          type="button"
          className="arch-controls__btn"
          onClick={() => dispatch({ type: 'prev' })}
          aria-label="Previous step"
        >
          <Icon path={ICONS.prev} />
        </button>
        {state.playing ? (
          <button
            type="button"
            className="arch-controls__btn arch-controls__btn--play"
            onClick={() => dispatch({ type: 'pause' })}
            aria-label="Pause"
          >
            <Icon path={ICONS.pause} />
          </button>
        ) : (
          <button
            type="button"
            className="arch-controls__btn arch-controls__btn--play"
            onClick={() => dispatch({ type: 'play' })}
            aria-label="Play"
          >
            <Icon path={ICONS.play} />
          </button>
        )}
        <button
          type="button"
          className="arch-controls__btn"
          onClick={() => dispatch({ type: 'next' })}
          aria-label="Next step"
        >
          <Icon path={ICONS.next} />
        </button>
      </div>
      <button
        type="button"
        className={`arch-controls__toggle${showDetail ? ' arch-controls__toggle--on' : ''}`}
        aria-pressed={showDetail}
        onClick={onToggleDetail}
      >
        {showDetail ? 'Hide details' : 'Show details'}
      </button>
    </div>
  );
}
