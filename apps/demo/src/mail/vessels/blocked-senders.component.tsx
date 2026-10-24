import { err, ok } from '@maelstrom-co/protocol';
import type { TypedVesselProps } from '@maelstrom-co/react';
import { mailM } from '../maelstrom';
import {
  getSettingsSnapshot,
  settingsActions,
  useSettingsStore,
} from '../stores/settings.store';
import type { blockedSendersVessel } from './blocked-senders.vessel';
import { MailCard } from './mail-card';

export default function BlockedSendersComponent({
  instanceId,
}: TypedVesselProps<typeof blockedSendersVessel>) {
  const { blockedSenders } = useSettingsStore();

  mailM.useActions('blocked-senders', instanceId, {
    blockSender: async ({ email }) => {
      if (!settingsActions.blockSender(email)) {
        return err(new Error('Give an email address to block'));
      }
      return ok(undefined);
    },
    unblockSender: async ({ email }) => {
      if (!settingsActions.unblockSender(email)) {
        return err(notBlockedError(email));
      }
      return ok(undefined);
    },
  });

  return (
    <MailCard title="Blocked senders" meta={`${blockedSenders.length} blocked`}>
      {blockedSenders.length === 0 ? (
        <p className="mail-muted">You have not blocked anyone.</p>
      ) : (
        <ul className="mail-list">
          {blockedSenders.map((address) => (
            <li key={address} className="mail-setting-row">
              <span className="mail-setting-label">{address}</span>
              <button
                type="button"
                className="mail-button"
                onClick={() => settingsActions.unblockSender(address)}
              >
                Unblock
              </button>
            </li>
          ))}
        </ul>
      )}
    </MailCard>
  );
}

function notBlockedError(email: string): Error {
  const blocked = getSettingsSnapshot().blockedSenders;
  const listed =
    blocked.length > 0
      ? blocked.map((address) => `"${address}"`).join(', ')
      : 'none';
  return new Error(`"${email}" is not blocked. Blocked: ${listed}`);
}
