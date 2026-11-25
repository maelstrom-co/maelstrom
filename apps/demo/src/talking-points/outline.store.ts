import { z } from 'zod';

export const OUTLINE_STORAGE_KEY = 'maelstrom.talking-points.outline';
export const MAX_TOPICS = 50;
export const MAX_TOPIC_LENGTH = 1000;

const contentSchema = z.string().trim().min(1).max(MAX_TOPIC_LENGTH);
const topicSchema = z.object({
  id: z
    .string()
    .regex(/^tp-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
  content: contentSchema,
});
const outlineSchema = z.object({
  version: z.literal(1),
  topics: z.array(topicSchema).max(MAX_TOPICS),
});

export interface Topic {
  readonly id: string;
  readonly content: string;
}

export interface OutlineSnapshot {
  readonly topics: readonly Topic[];
  readonly spoken: ReadonlySet<string>;
}

type OutlineStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function createPreparationOwner() {
  let active = true;
  return Object.freeze({
    generation: crypto.randomUUID(),
    isActive: () => active,
    retire: () => {
      active = false;
    },
  });
}

export type PreparationOwner = ReturnType<typeof createPreparationOwner>;

export function createOutlineStore(
  storage: () => OutlineStorage = () => window.localStorage,
) {
  let snapshot: OutlineSnapshot = { topics: [], spoken: new Set() };
  const listeners = new Set<() => void>();
  try {
    const raw = storage().getItem(OUTLINE_STORAGE_KEY);
    if (raw) {
      const parsed = outlineSchema.safeParse(JSON.parse(raw));
      if (
        parsed.success &&
        new Set(parsed.data.topics.map((topic) => topic.id)).size ===
          parsed.data.topics.length
      ) {
        snapshot = { topics: parsed.data.topics, spoken: new Set() };
      }
    }
  } catch {
    /* Unavailable browser storage must not prevent preparation. */
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    forOwner: (owner: PreparationOwner) => {
      const authorize = () => {
        if (!owner.isActive())
          throw new Error('This preparation session is retired.');
      };
      const persist = () => {
        authorize();
        const serialized = JSON.stringify({
          version: 1,
          topics: snapshot.topics.map(({ id, content }) => ({ id, content })),
        });
        try {
          const target = storage();
          authorize();
          target.setItem(OUTLINE_STORAGE_KEY, serialized);
        } catch (error) {
          if (!owner.isActive()) throw error;
          // Browsers may deny storage or exhaust their quota; the outline stays usable in memory.
        }
      };
      const commit = (
        topics: readonly Topic[],
        spoken = snapshot.spoken,
        durable = true,
      ) => {
        authorize();
        snapshot = { topics, spoken };
        for (const listener of listeners) listener();
        if (durable) persist();
      };
      const indexOf = (id: string) => {
        authorize();
        const index = snapshot.topics.findIndex((topic) => topic.id === id);
        if (index < 0) throw new Error('Topic no longer exists.');
        return index;
      };
      return {
        persist,
        clearSpoken: () => commit(snapshot.topics, new Set(), false),
        create: (content: string) => {
          authorize();
          const text = contentSchema.parse(content);
          if (snapshot.topics.length >= MAX_TOPICS)
            throw new Error(`An outline supports up to ${MAX_TOPICS} Topics.`);
          commit([
            ...snapshot.topics,
            { id: `tp-${crypto.randomUUID()}`, content: text },
          ]);
        },
        edit: (id: string, content: string) => {
          const index = indexOf(id);
          const topics = [...snapshot.topics];
          topics[index] = { id, content: contentSchema.parse(content) };
          commit(topics);
        },
        remove: (id: string) => {
          indexOf(id);
          const spoken = new Set(snapshot.spoken);
          spoken.delete(id);
          commit(
            snapshot.topics.filter((topic) => topic.id !== id),
            spoken,
          );
        },
        move: (id: string, position: number) => {
          const from = indexOf(id);
          if (
            !Number.isInteger(position) ||
            position < 1 ||
            position > snapshot.topics.length
          )
            throw new Error(
              'Position must be within the outline, starting at 1.',
            );
          const topics = [...snapshot.topics];
          const [topic] = topics.splice(from, 1);
          if (topic) topics.splice(position - 1, 0, topic);
          commit(topics);
        },
        setSpoken: (id: string, value: boolean) => {
          indexOf(id);
          const spoken = new Set(snapshot.spoken);
          if (value) spoken.add(id);
          else spoken.delete(id);
          commit(snapshot.topics, spoken, false);
        },
      };
    },
  };
}

export type OutlineStore = ReturnType<typeof createOutlineStore>;
export type OutlineWriter = ReturnType<OutlineStore['forOwner']>;
