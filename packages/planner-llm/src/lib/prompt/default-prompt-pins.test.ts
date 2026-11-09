import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';

import {
  makeGridRequest,
  makeTilingRequest,
} from '@maelstrom-co/engine/_testing';
import {
  GridModelOutputSchema,
  TilingModelOutputSchema,
} from '@maelstrom-co/protocol';
import { convertSchemaToJsonSchema } from '@tanstack/ai';

import { buildRetryPrompt } from '../retry-prompt.js';
import { buildSystemPrompt, buildUserPrompt } from './prompt-builder.js';

describe('default prompt and schema bytes unchanged', () => {
  const customizers = {
    vars: { assistantName: 'Aria' },
    system: { rules: { append: 'X' } },
  };
  const diagnostics = {
    feedback: 'Instance "a" overlaps instance "b".',
  } as Parameters<typeof buildRetryPrompt>[1];

  const pins: Record<string, { actual: () => string; sha256: string }> = {
    'grid system prompt': {
      actual: () => buildSystemPrompt('grid'),
      sha256:
        '4d7092050bef6ae35b23018be4b9d8d54c9a5b5af44dbc663bf54a2a62f4036d',
    },
    'tiling system prompt': {
      actual: () => buildSystemPrompt('tiling'),
      sha256:
        '8f20e462bcb2bb0f424915741c97c7c438ca1cdd0216b20531b0d3ad53aa5c0a',
    },
    'grid system prompt with customizers': {
      actual: () => buildSystemPrompt('grid', customizers),
      sha256:
        'a5d4f27add1e237dc6bfbcdd8ed27e98ee6cc4cdc9fd2eded1b233074b85447c',
    },
    'tiling system prompt with customizers': {
      actual: () => buildSystemPrompt('tiling', customizers),
      sha256:
        'f7e6fddf4d9e29b4a4bca21980ec0c4c5bf78be725ac821cb35d5f6d8cd83782',
    },
    'grid user prompt': {
      actual: () => buildUserPrompt(makeGridRequest()),
      sha256:
        '8eaa6f1e1f2a5d8a06b5ecba8d446768b805f17a995c354bd7889ed9712a4632',
    },
    'tiling user prompt': {
      actual: () => buildUserPrompt(makeTilingRequest()),
      sha256:
        '9825dc04ad23d5cabc37bd4334c1813317ce9a0458fa6db6bce79d48a178af51',
    },
    'grid retry prompt': {
      actual: () =>
        buildRetryPrompt(buildUserPrompt(makeGridRequest()), diagnostics),
      sha256:
        '523b141e4ddad4f3470d36859302f7b0c133b159b1c0a81a478e50858a1b9da7',
    },
    'grid model output JSON schema': {
      actual: () =>
        JSON.stringify(convertSchemaToJsonSchema(GridModelOutputSchema)),
      sha256:
        'b273289a4a8a809582aae5a8af74cdb848acfa629d02e41d3aaf2a7c6badffa7',
    },
    'tiling model output JSON schema': {
      actual: () =>
        JSON.stringify(convertSchemaToJsonSchema(TilingModelOutputSchema)),
      sha256:
        '05fc8ac24e4bf67dc334cc047e70f3679b53c68120b2f217b60fdb6c91191636',
    },
  };

  for (const [name, pin] of Object.entries(pins)) {
    test(`${name} matches its pinned hash`, () => {
      expect(sha256Hex(pin.actual())).toBe(pin.sha256);
    });
  }
});

function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
