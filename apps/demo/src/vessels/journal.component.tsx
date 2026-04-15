import { Success } from '@maelstrom-co/protocol-old';
import type { TypedVesselProps } from '@maelstrom-co/react';
import { useState } from 'react';
import { VesselCard } from '../components/vessel-card';
import { m } from '../lib/maelstrom';
import type { journalVessel } from './journal.vessel';

interface JournalEntry {
  id: string;
  title: string;
  content: string;
  date: string;
}

const SEED_ENTRIES: JournalEntry[] = [
  {
    id: '1',
    title: 'Project kickoff',
    content:
      'Discussed roadmap and milestones for Q2. Team aligned on priorities.',
    date: 'Apr 3, 2026',
  },
  {
    id: '2',
    title: 'Architecture review',
    content:
      'Reviewed the new module boundaries. Agreed to split the auth service.',
    date: 'Apr 4, 2026',
  },
];

export default function JournalComponent({
  instanceId,
  variantProps,
}: TypedVesselProps<typeof journalVessel>) {
  const [entries, setEntries] = useState<JournalEntry[]>(SEED_ENTRIES);
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);

  m.useActions('journal', instanceId, {
    createEntry: async ({ title }) => {
      const newEntry: JournalEntry = {
        id: crypto.randomUUID(),
        title,
        content: '',
        date: new Date().toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }),
      };
      setEntries((prev) => [newEntry, ...prev]);
      setActiveEntryId(newEntry.id);
      return Success<undefined>();
    },
    writeContent: async ({ text }) => {
      if (!activeEntryId) return Success<undefined>();
      setEntries((prev) =>
        prev.map((e) =>
          e.id === activeEntryId
            ? { ...e, content: e.content ? `${e.content} ${text}` : text }
            : e,
        ),
      );
      return Success<undefined>();
    },
    backToList: async () => {
      setActiveEntryId(null);
      return Success<undefined>();
    },
  });

  const isEntryView = variantProps.variant === 'entry';
  const activeEntry = entries.find((e) => e.id === activeEntryId);

  if (isEntryView && activeEntry) {
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
