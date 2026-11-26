import { tasklaneM } from './maelstrom';

const FADE_DELAY_MS = 3000;

// The band stays mounted at a fixed size so showing or hiding a line never
// resizes the Chart.
export function TasklaneCaption() {
  const { user } = tasklaneM.useVoiceCaptions({ fadeDelayMs: FADE_DELAY_MS });
  const showUser = user !== undefined && user.text.trim().length > 0;

  return (
    <div className="tasklane-caption" data-testid="tasklane-caption">
      {showUser ? (
        <p
          role="note"
          className="tasklane-caption-line"
          data-faded={user.faded}
          aria-label="Approximate user transcript"
        >
          {user.text}
        </p>
      ) : null}
    </div>
  );
}
