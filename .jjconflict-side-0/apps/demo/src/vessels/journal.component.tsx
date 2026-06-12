import { err, ok } from '@maelstrom-co/protocol';
import type { TypedVesselProps } from '@maelstrom-co/react';
import { VesselCard } from '../components/vessel-card';
import { m } from '../lib/maelstrom';
import {
  getJournalSnapshot,
  journalActions,
  useJournalStore,
} from './journal.store';
import type { journalVessel } from './journal.vessel';

export default function JournalComponent({
  instanceId,
  variantProps,
}: TypedVesselProps<typeof journalVessel>) {
  const { entries, activeEntryId } = useJournalStore();

  m.useActions('journal', instanceId, {
    createEntry: async ({ title }) => {
      journalActions.createEntry(title);
      return ok(undefined);
    },
    openEntry: async ({ title }) => {
      const match = journalActions.openEntry(title);
      if (!match) {
        const available = getJournalSnapshot().entries.map(
          (e) => `"${e.title}"`,
        );
        return err(
          new Error(
            `No journal entry matches "${title}". Available: ${available.join(
              ', ',
            )}`,
          ),
        );
      }
      return ok(undefined);
    },
    writeContent: async ({ text }) => {
      if (!journalActions.writeContent(text)) {
        return err(
          new Error(
            'No active journal entry. Call openEntry or createEntry first.',
          ),
        );
      }
      return ok(undefined);
    },
    backToList: async () => {
      journalActions.backToList();
      return ok(undefined);
    },
  });

  const isEntryView = variantProps.variant === 'entry';
  const activeEntry = entries.find((e) => e.id === activeEntryId);

  if (isEntryView) {
    if (!activeEntry) {
      return (
        <VesselCard accent="seafoam" label="Journal" meta="Entry">
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-2">
            <div className="text-sm text-white/70">No entry selected.</div>
            <div className="text-xs text-gray-500 max-w-xs">
              Ask the assistant to open an entry by title, or create a new one.
            </div>
          </div>
        </VesselCard>
      );
    }

    return (
      <VesselCard accent="seafoam" label="Journal" meta="Entry">
        <div className="flex-1 flex flex-col">
          <h2 className="text-lg font-semibold text-white/90 mb-1">
            {activeEntry.title}
          </h2>
          <div className="text-xs text-gray-500 font-mono mb-4">
            {activeEntry.date}
          </div>
          <div className="flex-1 text-sm text-white/70 leading-relaxed whitespace-pre-wrap">
            {activeEntry.content || (
              <span className="text-gray-600 italic">
                Waiting for content...
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-3 text-xs text-seafoam-accent/50 font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-seafoam-accent/50 animate-scribe-pulse" />
            Scribe active
          </div>
        </div>
      </VesselCard>
    );
  }

  // List view (default)
  return (
    <VesselCard
      accent="seafoam"
      label="Journal"
      meta={`${entries.length} entries`}
    >
      <div className="flex-1 space-y-1">
        {entries.map((entry) => (
          <div
            key={entry.id}
            className="py-2.5 border-b border-seafoam-accent/6"
          >
            <div className="text-sm font-medium text-white/85">
              {entry.title}
            </div>
            <div className="text-xs text-gray-500 font-mono mt-0.5">
              {entry.date}
            </div>
            {entry.content && (
              <div className="text-xs text-gray-500 mt-1 line-clamp-2">
                {entry.content}
              </div>
            )}
          </div>
        ))}
      </div>
    </VesselCard>
  );
}
