import { err, ok } from '@maelstrom-co/protocol';
import type { TypedVesselProps } from '@maelstrom-co/react';
import { mailM } from '../maelstrom';
import {
  isMailTheme,
  type MailTheme,
  settingsActions,
  THEMES,
  useSettingsStore,
} from '../stores/settings.store';
import { MailCard } from './mail-card';
import type { themeVessel } from './theme.vessel';

const THEME_LABELS: Readonly<Record<MailTheme, string>> = {
  light: 'Light',
  dark: 'Dark',
  sepia: 'Sepia',
};

export default function ThemeComponent({
  instanceId,
}: TypedVesselProps<typeof themeVessel>) {
  const { theme } = useSettingsStore();

  mailM.useActions('theme', instanceId, {
    setTheme: async ({ theme: requested }) => {
      if (!isMailTheme(requested)) {
        return err(
          new Error(
            `Unknown theme "${requested}". Use one of: ${THEMES.join(', ')}`,
          ),
        );
      }
      settingsActions.setTheme(requested);
      return ok(undefined);
    },
  });

  return (
    <MailCard title="Theme">
      <div className="mail-segmented">
        {THEMES.map((option) => (
          <button
            key={option}
            type="button"
            className="mail-segment"
            aria-pressed={option === theme}
            onClick={() => settingsActions.setTheme(option)}
          >
            {THEME_LABELS[option]}
          </button>
        ))}
      </div>
    </MailCard>
  );
}
