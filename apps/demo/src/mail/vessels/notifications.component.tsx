import { ok } from '@maelstrom-co/protocol';
import type { TypedVesselProps } from '@maelstrom-co/react';
import { mailM } from '../maelstrom';
import { settingsActions, useSettingsStore } from '../stores/settings.store';
import { MailCard, MailToggle } from './mail-card';
import type { notificationsVessel } from './notifications.vessel';

export default function NotificationsComponent({
  instanceId,
}: TypedVesselProps<typeof notificationsVessel>) {
  const { notificationsOn, soundOn } = useSettingsStore();

  mailM.useActions('notifications', instanceId, {
    setEmailNotifications: async ({ on }) => {
      settingsActions.setEmailNotifications(on);
      return ok(undefined);
    },
    setSound: async ({ on }) => {
      settingsActions.setSound(on);
      return ok(undefined);
    },
  });

  return (
    <MailCard title="Notifications">
      <MailToggle
        label="New email alerts"
        hint="Get a heads up when an email arrives"
        checked={notificationsOn}
        onChange={settingsActions.setEmailNotifications}
      />
      <MailToggle
        label="Sound"
        hint="Play a soft chime with each alert"
        checked={soundOn}
        onChange={settingsActions.setSound}
      />
    </MailCard>
  );
}
