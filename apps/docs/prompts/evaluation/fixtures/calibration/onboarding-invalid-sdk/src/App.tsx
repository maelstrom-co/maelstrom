import { createMaelstromWithoutThisExport } from '@maelstrom-co/react';

const app = createMaelstromWithoutThisExport({ vessels: [] });
export function App() {
  return <app.Chart />;
}
