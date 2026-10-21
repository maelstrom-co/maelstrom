import { ok } from '@maelstrom-co/protocol';
import type { TypedVesselProps } from '@maelstrom-co/react';
import { type CSSProperties, useState } from 'react';
import { mailM } from '../maelstrom';
import { selectedEmail, useMailStore } from '../stores/mail.store';
import { useSettingsStore } from '../stores/settings.store';
import { MailCard } from './mail-card';
import type { messageVessel } from './message.vessel';
import { MESSAGE_FONT_SIZE_PX } from './message-font-size';

export default function MessageComponent({
  instanceId,
}: TypedVesselProps<typeof messageVessel>) {
  const mail = useMailStore();
  const { textSize, signature, remoteImages } = useSettingsStore();
  const email = selectedEmail(mail);
  const [replyStartedFor, setReplyStartedFor] = useState<string | null>(null);

  mailM.useActions('message', instanceId, {
    reply: () => {
      setReplyStartedFor(email?.id ?? null);
      return ok(undefined);
    },
  });

  if (!email) {
    return (
      <MailCard title="Message">
        <p className="mail-muted">Pick an email from your inbox to read it.</p>
      </MailCard>
    );
  }

  const bodyStyle = {
    '--mail-message-font-size': `${MESSAGE_FONT_SIZE_PX[textSize]}px`,
  } as CSSProperties;

  return (
    <MailCard title="Message" meta={email.receivedLabel}>
      <div>
        <h3 className="mail-message-subject">{email.subject}</h3>
        <div className="mail-message-from">
          {email.senderName} &lt;{email.senderEmail}&gt;
        </div>
        {remoteImages ? null : <p className="mail-muted">Images hidden</p>}
        <div className="mail-message-body" style={bodyStyle}>
          {email.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          {signature ? (
            <p className="mail-message-signature">{signature}</p>
          ) : null}
        </div>
        {replyStartedFor === email.id ? (
          <p className="mail-muted">Reply started</p>
        ) : null}
      </div>
    </MailCard>
  );
}
