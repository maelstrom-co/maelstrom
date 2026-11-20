import { m } from './maelstrom';

export function IntentBar() {
  const { processIntent } = m.useMaelstrom();

  // "Show me pending orders"
  // "Open order 1847"
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const intent = new FormData(event.currentTarget).get('intent');
        if (typeof intent === 'string') void processIntent(intent);
      }}
    >
      <input name="intent" placeholder="What do you need?" />
    </form>
  );
}
