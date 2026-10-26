import { err, ok } from '@maelstrom-co/protocol';
import type { TypedVesselProps } from '@maelstrom-co/react';
import { mailM } from '../maelstrom';
import {
  isTextSize,
  isTextSizeDirection,
  settingsActions,
  TEXT_SIZES,
  type TextSize,
  useSettingsStore,
} from '../stores/settings.store';
import { MailCard } from './mail-card';
import type { textSizeVessel } from './text-size.vessel';

export const TEXT_SIZE_LABELS: Readonly<Record<TextSize, string>> = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
  'extra-large': 'Extra large',
};

export default function TextSizeComponent({
  instanceId,
}: TypedVesselProps<typeof textSizeVessel>) {
  const { textSize } = useSettingsStore();

  mailM.useActions('text-size', instanceId, {
    setTextSize: async ({ size }) => {
      if (!isTextSize(size)) {
        return err(
          new Error(
            `Unknown text size "${size}". Use one of: ${TEXT_SIZES.join(', ')}`,
          ),
        );
      }
      settingsActions.setTextSize(size);
      return ok(undefined);
    },
    adjustTextSize: async ({ direction }) => {
      if (!isTextSizeDirection(direction)) {
        return err(
          new Error(
            `Unknown direction "${direction}". Use "bigger" or "smaller"`,
          ),
        );
      }
      settingsActions.adjustTextSize(direction);
      return ok(undefined);
    },
  });

  return (
    <MailCard title="Text size" meta={TEXT_SIZE_LABELS[textSize]}>
      <input
        type="range"
        className="mail-slider"
        aria-label="Text size"
        min={0}
        max={TEXT_SIZES.length - 1}
        step={1}
        value={TEXT_SIZES.indexOf(textSize)}
        onChange={(event) => {
          const next = TEXT_SIZES[Number(event.target.value)];
          if (next) settingsActions.setTextSize(next);
        }}
      />
      <div className="mail-setting-row mail-muted">
        <span>Smaller</span>
        <span>Bigger</span>
      </div>
    </MailCard>
  );
}
