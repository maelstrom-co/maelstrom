import { MailCardSkeleton } from './mail-card';

export function BlockedSendersSkeleton(_props: { vesselId: string }) {
  return <MailCardSkeleton title="Blocked senders" />;
}
