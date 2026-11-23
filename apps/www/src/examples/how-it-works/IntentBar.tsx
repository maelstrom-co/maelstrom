import { m } from './maelstrom';

export function IntentBar() {
  const { processIntent } = m.useMaelstrom();

  return (
    <button onClick={() => void processIntent('Open order 1847')}>
      Open order 1847
    </button>
  );
}
