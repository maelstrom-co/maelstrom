import { err, ok } from '@maelstrom-co/protocol';
import type { TypedVesselProps } from '@maelstrom-co/react';
import { useEffect, useId, useRef, useState } from 'react';

import { VesselCard } from '../components/vessel-card';
import {
  markDirectAction,
  recordChange,
  recordFailure,
  recordUnchanged,
} from '../lib/action-activity';
import { ACCENT_HEX, accentAlpha, VESSEL_ACCENTS } from '../lib/design-tokens';
import { m } from '../lib/maelstrom';
import {
  type EntryNotFound,
  entryReferenceLabel,
  getJournalSnapshot,
  type JournalEntry,
  journalActions,
  useJournalStore,
} from './journal.store';
import type { journalVessel } from './journal.vessel';

const RULE_COLOR = accentAlpha(ACCENT_HEX[VESSEL_ACCENTS.journal], 0.1);

export default function JournalComponent({
  instanceId,
  variantProps,
  executeAction,
}: TypedVesselProps<typeof journalVessel>) {
  const { entries, activeEntryId } = useJournalStore();
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  // Unsaved text lives here, per entry, so switching rows or entries keeps it
  // until the user saves or cancels.
  const [drafts, setDrafts] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );

  // Saves executeAction has queued but the store does not hold yet.
  const pendingSaves = useRef(new Map<string, string>());

  const setDraft = (id: string, text: string | null) => {
    if (text === null) pendingSaves.current.delete(id);
    setDrafts((current) => {
      if (text === null && !current.has(id)) return current;
      const next = new Map(current);
      if (text === null) next.delete(id);
      else next.set(id, text);
      return next;
    });
  };

  // A save confirmed after its editor closed leaves a draft equal to the
  // stored text, which would otherwise hide later dictated words. While a
  // save is queued the stored text is about to change, so a draft matching
  // it is still the user's latest words.
  useEffect(() => {
    for (const e of entries) {
      if (pendingSaves.current.get(e.id) === e.content) {
        pendingSaves.current.delete(e.id);
      }
    }
    const queued = new Set(pendingSaves.current.keys());
    setDrafts((current) => {
      const stale = entries.filter(
        (e) => !queued.has(e.id) && current.get(e.id) === e.content,
      );
      if (stale.length === 0) return current;
      const next = new Map(current);
      for (const e of stale) next.delete(e.id);
      return next;
    });
  }, [entries]);

  m.useActions('journal', instanceId, {
    createEntry: async ({ title }) => {
      const { entry } = journalActions.createEntry(title);
      recordChange(
        `Created journal entry "${entry.title}"`,
        source('createEntry'),
      );
      return ok(undefined);
    },
    openEntry: async ({ title }) => {
      const result = journalActions.openEntry(title);
      if (!result.ok) return notFound('openEntry', result);
      return ok(undefined);
    },
    writeContent: async ({ text }) => {
      const result = journalActions.writeContent(text);
      if (!result.ok) {
        recordFailure(
          "Couldn't write: no journal entry is open",
          source('writeContent'),
        );
        return err(
          new Error(
            'No active journal entry. Call openEntry or createEntry first.',
          ),
        );
      }
      recordChange(`Wrote to "${result.entry.title}"`, source('writeContent'));
      return ok(undefined);
    },
    editEntry: async ({ entry, content }) => {
      const result = journalActions.setEntryContent(entry, content);
      if (!result.ok) return notFound('editEntry', result);
      if (result.changed) {
        recordChange(
          `Updated journal entry "${result.entry.title}"`,
          source('editEntry'),
        );
      } else {
        recordUnchanged(
          `"${result.entry.title}" already had that text`,
          source('editEntry'),
        );
      }
      return ok(undefined);
    },
    backToList: async () => {
      journalActions.backToList();
      return ok(undefined);
    },
  });

  const saveEntry = (entry: JournalEntry, content: string) => {
    markDirectAction(source('editEntry'));
    pendingSaves.current.set(entry.id, content);
    executeAction('editEntry', { entry: entry.id, content });
  };

  const isEntryView = variantProps.variant === 'entry';
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
        <div className="flex-1 flex flex-col min-h-0">
          <h2 className="text-base font-medium text-ink mb-1">
            {activeEntry.title}
          </h2>
          <div className="text-xs text-ink-3 font-mono mb-4">
            {activeEntry.date}
          </div>
          <EntryEditor
            key={activeEntry.id}
            entry={activeEntry}
            draft={drafts.get(activeEntry.id) ?? null}
            onDraftChange={(text) => setDraft(activeEntry.id, text)}
            ruled
            onSave={(content) => saveEntry(activeEntry, content)}
          />
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

  const closeRow = (id: string) => {
    journalActions.selectEntry(null);
    rowRefs.current.get(id)?.focus();
  };

  const toggleRow = (id: string) =>
    journalActions.selectEntry(activeEntryId === id ? null : id);

  return (
    <VesselCard
      accent={VESSEL_ACCENTS.journal}
      label="Journal"
      meta={`${entries.length} entries`}
    >
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {entries.map((entry) => {
          const expanded = entry.id === activeEntryId;
          return (
            <div key={entry.id} className="border-b border-white/[0.06]">
              <button
                type="button"
                ref={(node) => {
                  if (node) rowRefs.current.set(entry.id, node);
                  else rowRefs.current.delete(entry.id);
                }}
                aria-expanded={expanded}
                onClick={() => toggleRow(entry.id)}
                className="journal-row w-full py-2.5 text-left"
              >
                <div className="text-sm font-medium text-ink">
                  {entry.title}
                </div>
                <div className="text-xs text-ink-3 font-mono mt-0.5">
                  {entry.date}
                </div>
                {entry.content && !expanded && (
                  <div className="text-xs text-ink-3 mt-1 line-clamp-2">
                    {entry.content}
                  </div>
                )}
              </button>
              {expanded && (
                <div className="pb-2.5">
                  <EntryEditor
                    entry={entry}
                    draft={drafts.get(entry.id) ?? null}
                    onDraftChange={(text) => setDraft(entry.id, text)}
                    // oxlint-disable-next-line jsx-a11y/no-autofocus -- The user opens this editor by activating its row.
                    autoFocus
                    onSave={(content) => saveEntry(entry, content)}
                    onSaved={() => closeRow(entry.id)}
                    onCancel={() => closeRow(entry.id)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </VesselCard>
  );
}

function EntryEditor({
  entry,
  draft,
  onDraftChange,
  ruled = false,
  autoFocus = false,
  onSave,
  onSaved,
  onCancel,
}: {
  entry: JournalEntry;
  // A null draft follows the stored text, so dictated words keep appearing
  // until the user starts typing.
  draft: string | null;
  onDraftChange: (text: string | null) => void;
  ruled?: boolean;
  autoFocus?: boolean;
  onSave: (content: string) => void;
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  // executeAction only queues the edit, so the draft stays until the store
  // holds the saved text. A skipped or failed save keeps the user's words.
  const [pendingSave, setPendingSave] = useState<string | null>(null);
  const value = draft ?? entry.content;
  const textareaId = useId();
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoFocus) editorRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [autoFocus]);

  useEffect(() => {
    if (pendingSave === null || entry.content !== pendingSave) return;
    setPendingSave(null);
    // Text typed after Save is newer than the confirmed save, so it stays.
    if (draft !== null && draft !== pendingSave) return;
    onDraftChange(null);
    onSaved?.();
  }, [entry.content, pendingSave, draft, onDraftChange, onSaved]);

  const cancel = () => {
    setPendingSave(null);
    onDraftChange(null);
    onCancel?.();
  };

  return (
    <div ref={editorRef} className="flex flex-1 flex-col gap-2 min-h-0">
      <label htmlFor={textareaId} className="sr-only">
        {`Text of ${entry.title}`}
      </label>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={cancel}
          className="btn min-h-8 px-3 text-xs"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={draft === null || draft === entry.content}
          onClick={() => {
            setPendingSave(value);
            onSave(value);
          }}
          className="btn btn-primary min-h-8 px-3 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Save
        </button>
      </div>
      <textarea
        id={textareaId}
        value={value}
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- The user opens this editor by activating its row.
        autoFocus={autoFocus}
        placeholder="Waiting for content..."
        rows={ruled ? undefined : 3}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          cancel();
        }}
        className={
          ruled
            ? 'journal-editor ruled-paper flex-1 text-sm text-ink-2'
            : 'journal-editor text-xs text-ink-2'
        }
        style={
          ruled
            ? {
                backgroundImage: `repeating-linear-gradient(to bottom, transparent, transparent 25px, ${RULE_COLOR} 25px, ${RULE_COLOR} 26px)`,
                lineHeight: '26px',
              }
            : undefined
        }
      />
    </div>
  );
}

function source(action: string) {
  return { vesselId: 'journal', action };
}

function notFound(action: string, result: EntryNotFound) {
  recordFailure(
    `Couldn't find journal entry "${result.query}"`,
    source(action),
  );
  const available = getJournalSnapshot()
    .entries.map((e) => `"${entryReferenceLabel(e)}"`)
    .join(', ');
  return err(
    new Error(
      `No journal entry matches "${result.query}". Available: ${available || 'none'}`,
    ),
  );
}
