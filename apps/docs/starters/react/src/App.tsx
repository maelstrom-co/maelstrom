import {
  createMaelstrom,
  defineVessel,
  HttpConnector,
  vessel,
} from '@maelstrom-co/react';
import { useState } from 'react';

function Greeting() {
  return (
    <section className="greeting" aria-label="Greeting capability">
      <h2>Hello from Maelstrom</h2>
      <p>The local Engine placed this React component in the Chart.</p>
    </section>
  );
}

const greeting = defineVessel({
  id: 'greeting',
  name: 'Greeting',
  description: 'Show a greeting card',
  defaultVariant: 'card',
  variants: {
    card: { props: {}, minSize: { width: 2, height: 2 }, actions: [] },
  },
});
const m = createMaelstrom({ vessels: [vessel(greeting, Greeting)] });
const connector = new HttpConnector({ baseUrl: '/api' });

function Workspace() {
  const [intent, setIntent] = useState('Show the greeting');
  const {
    processIntent,
    connectionStatus,
    isProcessing,
    lastError,
    lastResponse,
  } = m.useMaelstrom();
  return (
    <>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (intent.trim()) void processIntent(intent.trim());
        }}
      >
        <label htmlFor="intent">Intent</label>
        <input
          id="intent"
          value={intent}
          onChange={(event) => setIntent(event.target.value)}
          maxLength={500}
        />
        <button
          type="submit"
          disabled={connectionStatus !== 'connected' || isProcessing}
        >
          {isProcessing ? 'Processing…' : 'Send intent'}
        </button>
      </form>
      <p role="status">
        {lastError
          ? 'The request failed. Check the local server and try again.'
          : (lastResponse?.userMessage ?? 'Ready for your first intent.')}
      </p>
      <div className="chart">
        <m.Chart />
      </div>
    </>
  );
}

export function App() {
  return (
    <main>
      <h1>Maelstrom React starter</h1>
      <p>
        This preview uses a deterministic local planner. It shows one greeting
        capability for any submitted intent. No model or provider key is used.
      </p>
      <m.Provider connector={connector} layoutMode="tiling">
        <Workspace />
      </m.Provider>
    </main>
  );
}
