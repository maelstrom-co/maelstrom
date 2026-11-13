import { VesselCard } from '../components/vessel-card';
import { ACCENT_HEX, accentAlpha, VESSEL_ACCENTS } from '../lib/design-tokens';
import type { JournalEntryView } from '../view-data';

const RULE_COLOR = accentAlpha(ACCENT_HEX[VESSEL_ACCENTS.journal], 0.1);

/** Render app-owned entries and selection without registering Actions. */
export function JournalView({
  variant,
  entries,
  activeEntryId,
}: {
  /** Chart-selected view. */
  variant: 'list' | 'entry';
  /** Entries in display order. */
  entries: readonly JournalEntryView[];
  /** Selected entry, if any. */
  activeEntryId: string | null;
}) {
  const isEntryView = variant === 'entry';
  const activeEntry = entries.find((e) => e.id === activeEntryId);

  if (isEntryView) {
    if (!activeEntry) {
      return (
        <VesselCard
          accent={VESSEL_ACCENTS.journal}
          label="Journal"
          meta="Entry"
        >
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-2">
            <div className="text-sm text-ink">No entry selected.</div>
            <div className="text-xs text-ink-3 max-w-xs">
              Ask the assistant to open an entry by title, or create a new one.
            </div>
          </div>
        </VesselCard>
      );
    }

    return (
      <VesselCard accent={VESSEL_ACCENTS.journal} label="Journal" meta="Entry">
        <div className="flex-1 flex flex-col">
          <h2 className="text-base font-medium text-ink mb-1">
            {activeEntry.title}
          </h2>
          <div className="text-xs text-ink-3 font-mono mb-4">
            {activeEntry.date}
          </div>
          <div
            className="ruled-paper flex-1 text-sm text-ink-2 whitespace-pre-wrap"
            style={{
              backgroundImage: `repeating-linear-gradient(to bottom, transparent, transparent 25px, ${RULE_COLOR} 25px, ${RULE_COLOR} 26px)`,
              lineHeight: '26px',
            }}
          >
            {activeEntry.content || (
              <span className="text-ink-3 italic">Waiting for content...</span>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-3 text-xs text-green font-mono">
            <span
              className="w-1.5 h-1.5 rounded-full bg-green animate-scribe-pulse"
              style={{ boxShadow: '0 0 8px var(--color-green)' }}
            />
            Scribe active
          </div>
        </div>
      </VesselCard>
    );
  }

  // List view (default)
  return (
    <VesselCard
      accent={VESSEL_ACCENTS.journal}
      label="Journal"
      meta={`${entries.length} entries`}
    >
      <div className="flex-1 space-y-1">
        {entries.map((entry) => (
          <div key={entry.id} className="py-2.5 border-b border-white/[0.06]">
            <div className="text-sm font-medium text-ink">{entry.title}</div>
            <div className="text-xs text-ink-3 font-mono mt-0.5">
              {entry.date}
            </div>
            {entry.content && (
              <div className="text-xs text-ink-3 mt-1 line-clamp-2">
                {entry.content}
              </div>
            )}
          </div>
        ))}
      </div>
    </VesselCard>
  );
}
