import { mailM } from '../maelstrom';
import {
  type Email,
  emailIdsOpenInReaders,
  useMailStore,
} from '../stores/mail.store';
import { MailCard } from './mail-card';

export default function InboxComponent() {
  const mail = useMailStore();
  const enqueueIntent = mailM.useMaelstrom((state) => state.enqueueIntent);
  const openEmailIds = emailIdsOpenInReaders(mail);

  return (
    <MailCard title="Inbox" meta={`${mail.emails.length} emails`}>
      <ul className="mail-list">
        {mail.emails.map((email) => (
          <li key={email.id}>
            <button
              type="button"
              className="mail-inbox-item"
              aria-current={openEmailIds.has(email.id) ? 'true' : undefined}
              onClick={() => enqueueIntent(openEmailIntent(email))}
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

function openEmailIntent(email: Email): string {
  return `Open the email from ${email.senderName} titled "${email.subject}"`;
}
