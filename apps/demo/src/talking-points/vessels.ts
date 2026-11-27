import { defineVessel } from '@maelstrom-co/protocol';

import { MAX_TOPIC_LENGTH, MAX_TOPICS, type Topic } from './outline.store';

export function outlineDefinition(topics: readonly Topic[]) {
  return defineVessel({
    id: 'outline',
    name: 'Outline preparation',
    description:
      `Prepare an ordered speaking outline. Create, edit, remove or move Topics through this controller. Topic IDs are exact stable references; never invent IDs. Each Topic has its own Vessel with mark/unmark Actions and a single stable Variant. Always retain outline-main. At most ${MAX_TOPICS} Topics, each at most ${MAX_TOPIC_LENGTH} characters. New Topics are projected by the app after this batch; do not target a new Topic Vessel in the same response. Current canonical order and complete content follow.\nOrdered Topics:\n${JSON.stringify(topics)}` as string,
    defaultVariant: 'prepare',
    variants: {
      prepare: {
        description: 'Prepare and reuse the outline.',
        props: {},
        minSize: { width: 3, height: 1 },
        actions: [
          {
            name: 'createTopic',
            description: 'Append a Topic to the outline.',
            parameters: [
              {
                name: 'content',
                type: 'string',
                description: 'What the speaker wants to cover.',
              },
            ],
          },
          {
            name: 'editTopic',
            description:
              'Replace a Topic’s content without changing its identity or position.',
            parameters: [
              {
                name: 'topic',
                type: 'string',
                description: 'Exact Topic ID from the current outline.',
              },
              {
                name: 'content',
                type: 'string',
                description: 'Replacement content.',
              },
            ],
          },
          {
            name: 'removeTopic',
            description: 'Remove a Topic from the outline.',
            parameters: [
              {
                name: 'topic',
                type: 'string',
                description: 'Exact Topic ID from the current outline.',
              },
            ],
          },
          {
            name: 'moveTopic',
            description:
              'Move a Topic to an absolute one-based position, preserving other Topics’ relative order.',
            parameters: [
              {
                name: 'topic',
                type: 'string',
                description: 'Exact Topic ID from the current outline.',
              },
              {
                name: 'position',
                type: 'number',
                description: 'New one-based position within the outline.',
              },
            ],
          },
        ],
      },
    },
  });
}

export function topicDefinition(topic: Topic) {
  return defineVessel({
    id: `topic-${topic.id}` as const,
    name: 'Topic',
    description: `Speaking Topic ${topic.id}. Current content: ${JSON.stringify(topic.content)}. Spoken styling comes from app state, not a Variant change.`,
    defaultVariant: 'topic',
    variants: {
      topic: {
        description: 'A speaking Topic, with store-driven Spoken styling.',
        props: {},
        minSize: { width: 3, height: 2 },
        actions: [
          {
            name: 'mark',
            effect: 'idempotent',
            description: 'Mark this Topic as Spoken.',
          },
          {
            name: 'unmark',
            effect: 'idempotent',
            description: 'Remove the Spoken mark from this Topic.',
          },
        ],
      },
    },
  });
}
