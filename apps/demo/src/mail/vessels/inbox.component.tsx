import { err, ok } from '@maelstrom-co/protocol';
import type { TypedVesselProps } from '@maelstrom-co/react';
import { mailM } from '../maelstrom';
import {
  getMailSnapshot,
  mailActions,
  useMailStore,
} from '../stores/mail.store';
import type { inboxVessel } from './inbox.vessel';
import { MailCard } from './mail-card';

export default function InboxComponent({
  instanceId,
}: TypedVesselProps<typeof inboxVessel>) {
  const { emails, selectedEmailId } = useMailStore();

  mailM.useActions('inbox', instanceId, {
    openEmail: async ({ subject }) => {
      if (!mailActions.openEmail(subject)) return err(noMatchError(subject));
      return ok(undefined);
    },
  });

  return (
    <MailCard title="Inbox" meta={`${emails.length} emails`}>
      <ul className="mail-list">
        {emails.map((email) => (
          <li key={email.id}>
            <button
              type="button"
              className="mail-inbox-item"
              aria-current={email.id === selectedEmailId ? 'true' : undefined}
              onClick={() => mailActions.selectEmail(email.id)}
            >
              <span className="mail-inbox-sender">
                <span>{email.senderName}</span>
                <span className="mail-muted">{email.receivedLabel}</span>
              </span>
              <span className="mail-inbox-subject">{email.subject}</span>
              <span className="mail-inbox-preview">{email.preview}</span>
            </button>
          </li>
        ))}
      </ul>
    </MailCard>
  );
}

function noMatchError(subject: string): Error {
  const available = getMailSnapshot()
    .emails.map((email) => `"${email.subject}"`)
    .join(', ');
  return new Error(`No email matches "${subject}". Available: ${available}`);
}
