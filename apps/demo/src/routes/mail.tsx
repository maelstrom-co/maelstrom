import { createFileRoute } from '@tanstack/react-router';
import { isHosted } from '../lib/hosted-mode';
import { MailPage } from '../mail/mail-page';

export const Route = createFileRoute('/mail')({
  // Hosted builds use the prerendered SPA shell and keep this route client-only.
  // Non-hosted Start builds render the route on the server.
  ssr: !isHosted(),
  component: MailPage,
});
