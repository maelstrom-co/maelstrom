import { ok } from '@maelstrom-co/protocol';
import type { TypedVesselProps } from '@maelstrom-co/react';
import { mailM } from '../maelstrom';
import { settingsActions, useSettingsStore } from '../stores/settings.store';
import { MailCard, MailToggle } from './mail-card';
import type { privacyVessel } from './privacy.vessel';

export default function PrivacyComponent({
  instanceId,
}: TypedVesselProps<typeof privacyVessel>) {
  const { readReceipts, remoteImages } = useSettingsStore();

  mailM.useActions('privacy', instanceId, {
    setReadReceipts: async ({ on }) => {
      settingsActions.setReadReceipts(on);
      return ok(undefined);
    },
    setRemoteImages: async ({ on }) => {
      settingsActions.setRemoteImages(on);
      return ok(undefined);
    },
  });

  return (
    <MailCard title="Privacy">
      <MailToggle
        label="Read receipts"
        hint="Let people know when you have read their email"
        checked={readReceipts}
        onChange={settingsActions.setReadReceipts}
      />
      <MailToggle
        label="Load pictures automatically"
        hint="Turn off to stop senders seeing when you open an email"
        checked={remoteImages}
        onChange={settingsActions.setRemoteImages}
      />
    </MailCard>
  );
}
