import { useState } from 'react';

import { SendButton, TextInput } from './app';
import { m } from './maelstrom';

export function Dashboard() {
  const { processIntent } = m.useMaelstrom();
  const [userMessage, setUserMessage] = useState('');

  // "Show me pending orders"
  // "Open order 1847"
  return (
    <>
      <TextInput value={userMessage} onChange={setUserMessage} />
      <SendButton onClick={() => processIntent(userMessage)} />
    </>
  );
}
