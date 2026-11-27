import type { AdapterTurnControl, TurnMode } from '@maelstrom-co/realtime';

// Renders only while the adapter can switch modes on this connection. Turning
// hold to talk off hands turns back to automatic detection.
export function TurnModeToggle({
  turnControl,
  turnMode,
  switching = false,
  className,
}: {
  readonly turnControl: AdapterTurnControl | undefined;
  readonly turnMode: TurnMode;
  readonly switching?: boolean;
  readonly className?: string;
}) {
  if (turnControl?.setTurnMode === undefined) return null;
  const holdToTalk = turnMode === 'manual';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={holdToTalk}
      title="Hold to talk instead of automatic turn detection"
      disabled={switching}
      className={className}
      onClick={() => {
        void turnControl
          .setTurnMode?.(holdToTalk ? 'automatic' : 'manual')
          ?.catch(() => {});
      }}
    >
      Hold mode
    </button>
  );
}
