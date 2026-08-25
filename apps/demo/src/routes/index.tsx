import { createFileRoute } from '@tanstack/react-router';
import { HomePage } from '../components/home-page';
import { isHosted } from '../lib/hosted-mode';

export const Route = createFileRoute('/')({
  // Hosted builds use the prerendered SPA shell and keep this route client-only.
  // Non-hosted Start builds render the route on the server.
  ssr: !isHosted(),
  component: HomePage,
});
