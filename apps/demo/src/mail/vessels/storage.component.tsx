import type { TypedVesselProps } from '@maelstrom-co/react';
import { useSettingsStore } from '../stores/settings.store';
import { MailCard } from './mail-card';
import type { storageVessel } from './storage.vessel';

export default function StorageComponent(
  _props: TypedVesselProps<typeof storageVessel>,
) {
  const { storage } = useSettingsStore();
  const usedGb = toGigabytes(storage.usedMb);
  const totalGb = toGigabytes(storage.totalMb);
  const leftGb = toGigabytes(Math.max(0, storage.totalMb - storage.usedMb));
  const percentUsed =
    storage.totalMb > 0
      ? Math.min(100, (storage.usedMb / storage.totalMb) * 100)
      : 0;

  return (
    <MailCard title="Storage">
      <p>
        {formatGigabytes(usedGb)} GB of {formatGigabytes(totalGb)} GB used
      </p>
      <div
        className="mail-progress"
        role="progressbar"
        aria-label="Storage used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percentUsed)}
      >
        <div
          className="mail-progress-fill"
          style={{ width: `${percentUsed}%` }}
        />
      </div>
      <p className="mail-muted">{formatGigabytes(leftGb)} GB left</p>
    </MailCard>
  );
}

function toGigabytes(megabytes: number): number {
  return megabytes / 1024;
}

function formatGigabytes(gigabytes: number): string {
  const rounded = Math.round(gigabytes * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
