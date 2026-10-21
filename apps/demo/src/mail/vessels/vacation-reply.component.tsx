import { ok } from '@maelstrom-co/protocol';
import type { TypedVesselProps } from '@maelstrom-co/react';
import { mailM } from '../maelstrom';
import { settingsActions, useSettingsStore } from '../stores/settings.store';
import { MailCard, MailToggle } from './mail-card';
import type { vacationReplyVessel } from './vacation-reply.vessel';

export default function VacationReplyComponent({
  instanceId,
}: TypedVesselProps<typeof vacationReplyVessel>) {
  const { vacationReply } = useSettingsStore();

  mailM.useActions('vacation-reply', instanceId, {
    setVacationReply: async ({ on, message }) => {
      settingsActions.setVacationReply(on, message);
      return ok(undefined);
    },
  });

  return (
    <MailCard title="Vacation reply" meta={vacationReply.on ? 'On' : 'Off'}>
      <MailToggle
        label="Reply while I am away"
        hint="Sends this message to anyone who emails you"
        checked={vacationReply.on}
        onChange={(on) => settingsActions.setVacationReply(on)}
      />
      <textarea
        className="mail-textarea"
        aria-label="Away message"
        rows={3}
        value={vacationReply.message}
        onChange={(event) =>
          settingsActions.setVacationReply(vacationReply.on, event.target.value)
        }
      />
    </MailCard>
  );
}
