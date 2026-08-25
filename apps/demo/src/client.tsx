import { StartClient } from '@tanstack/react-start/client';
import { StrictMode, startTransition } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { installStaleAssetRecovery } from './lib/stale-asset-recovery';

installStaleAssetRecovery(window, {
  storage: window.sessionStorage,
  entryUrl: import.meta.url,
  reload: () => window.location.reload(),
});

const client = (
  <StrictMode>
    <StartClient />
  </StrictMode>
);

startTransition(() => {
  if (import.meta.env.VITE_HOSTED === '1') {
    // Workers serves the empty prerendered SPA shell, not route HTML. Mounting
    // avoids hydrating that shell against the client-only index route.
    createRoot(document).render(client);
  } else {
    hydrateRoot(document, client);
  }
});
