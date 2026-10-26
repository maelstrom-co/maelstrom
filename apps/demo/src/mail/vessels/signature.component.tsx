import { ok } from '@maelstrom-co/protocol';
import type { TypedVesselProps } from '@maelstrom-co/react';
import { mailM } from '../maelstrom';
import { settingsActions, useSettingsStore } from '../stores/settings.store';
import { MailCard } from './mail-card';
import type { signatureVessel } from './signature.vessel';

export default function SignatureComponent({
  instanceId,
}: TypedVesselProps<typeof signatureVessel>) {
  const { signature } = useSettingsStore();

  mailM.useActions('signature', instanceId, {
    setSignature: async ({ text }) => {
      settingsActions.setSignature(text);
      return ok(undefined);
    },
  });

  return (
    <MailCard title="Signature">
      <p className="mail-muted">Added to the bottom of every email you send.</p>
      <textarea
        className="mail-textarea"
        aria-label="Signature"
        rows={3}
        value={signature}
        onChange={(event) => settingsActions.setSignature(event.target.value)}
      />
    </MailCard>
  );
}
