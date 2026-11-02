import { useEffect } from 'react';
import { beginRequestWindow, endRequestWindow } from '../lib/action-activity';
import { m } from '../lib/maelstrom';

/**
 * Renders nothing. Opens a receipt window for every Engine turn, including
 * voice and automatic ones that have no typed ticket, so their handler
 * entries share one receipt line.
 */
export function EngineActivityWindows() {
  const phase = m.useMaelstrom((state) => state.intentScheduler.phase);

  useEffect(() => {
    if (phase === 'idle') endRequestWindow();
    else beginRequestWindow();
  }, [phase]);

  return null;
}
