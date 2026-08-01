import { createMaelstrom, defineVessel, vessel } from '@maelstrom-co/react';
import {
  type CreateAdapterContext,
  maelstromRealtime,
} from '@maelstrom-co/react-realtime';
import type { RealtimeProviderAdapter } from '@maelstrom-co/realtime';
import {
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useRef,
} from 'react';

const statusVessel = defineVessel({
  id: 'status',
  name: 'Status',
  description: 'Shows application status',
  defaultVariant: 'summary',
  variants: {
    summary: { props: {}, minSize: { width: 1, height: 1 }, actions: [] },
  },
});
const vessels = [vessel(statusVessel, () => null)] as const;
declare const createAdapter: (
  context: CreateAdapterContext,
) => RealtimeProviderAdapter;

const m = createMaelstrom({ vessels }).with(
  maelstromRealtime({ createAdapter }),
);

/* docs:livekit-hold-to-talk:start */
const LIVE_STATES = new Set(['connected', 'listening', 'thinking', 'speaking']);

export function HoldToTalk() {
  const { state, turnControl } = m.useVoice();
  const pressRequested = useRef(false);
  const requestSequence = useRef(0);
  const turnActive = useRef(false);
  const lifecycle = useRef<Promise<void>>(Promise.resolve());
  const connected = LIVE_STATES.has(state);

  // Every turn operation queues behind the previous one. A release can arrive
  // while startTurn() is still pending; without this, endTurn() would run first
  // and leave the microphone open for the rest of the session.
  const serialize = useCallback((operation: () => Promise<void>) => {
    lifecycle.current = lifecycle.current.then(operation).catch(() => {});
    return lifecycle.current;
  }, []);

  const begin = useCallback(async () => {
    if (pressRequested.current || !turnControl || !connected) return;
    pressRequested.current = true;
    requestSequence.current += 1;
    const request = requestSequence.current;

    await serialize(async () => {
      // requestSequence guards against a later press reviving a start that an
      // earlier release already invalidated.
      if (
        !pressRequested.current ||
        requestSequence.current !== request ||
        turnActive.current
      )
        return;
      await turnControl.startTurn();
      turnActive.current = true;
    });
  }, [connected, serialize, turnControl]);

  const stopTurn = useCallback(
    async (force: boolean) => {
      if (!force && !pressRequested.current) return;
      pressRequested.current = false;
      requestSequence.current += 1;

      await serialize(async () => {
        if (!turnActive.current) return;
        try {
          await turnControl?.endTurn();
        } finally {
          turnActive.current = false;
        }
      });
    },
    [serialize, turnControl],
  );

  // Release can be lost to a dropped connection, a blurred window, a hidden
  // tab, or unmount. Each one has to end the turn, or the mic stays live.
  useEffect(() => {
    if (!connected) void stopTurn(true);
  }, [connected, stopTurn]);

  useEffect(() => {
    const stopForFocusLoss = () => void stopTurn(true);
    const stopWhenHidden = () => {
      if (document.visibilityState === 'hidden') stopForFocusLoss();
    };

    window.addEventListener('blur', stopForFocusLoss);
    document.addEventListener('visibilitychange', stopWhenHidden);

    return () => {
      window.removeEventListener('blur', stopForFocusLoss);
      document.removeEventListener('visibilitychange', stopWhenHidden);
      void stopTurn(true);
    };
  }, [stopTurn]);

  const endPress = () => void stopTurn(false);
  const cancelPress = () => void stopTurn(true);
  const isTurnKey = (key: string) => key === 'Enter' || key === ' ';

  // LiveKit exposes turnControl only in manual mode. Automatic turn detection
  // leaves it undefined, and this control must not render at all.
  if (!turnControl) return null;

  return (
    <button
      type="button"
      disabled={!connected}
      onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
        if (pressRequested.current) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        void begin();
      }}
      onPointerUp={endPress}
      onPointerLeave={endPress}
      onPointerCancel={endPress}
      onLostPointerCapture={cancelPress}
      onBlur={cancelPress}
      onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
        if (!isTurnKey(event.key) || event.repeat || pressRequested.current)
          return;
        event.preventDefault();
        void begin();
      }}
      onKeyUp={(event: KeyboardEvent<HTMLButtonElement>) => {
        if (isTurnKey(event.key)) endPress();
      }}
    >
      Hold to talk
    </button>
  );
}
/* docs:livekit-hold-to-talk:end */
