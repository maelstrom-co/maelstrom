import { describe, expect, test } from 'bun:test';
import {
  type LlmUsageDetails,
  type LlmUsageInput,
  normalizeLlmUsage,
  type ReportedLlmUsage,
} from './usage.js';

describe('normalizeLlmUsage', () => {
  test.each<{
    name: string;
    usage?: LlmUsageInput;
    supplemental?: LlmUsageDetails;
    expected?: ReportedLlmUsage;
  }>([
    { name: 'missing usage is not zero work' },
    { name: 'empty source snapshots are not zero work', usage: [] },
    { name: 'empty aggregate snapshots are not zero work', usage: {} },
    {
      name: 'source totals include all model work without deriving missing totals',
      usage: [{ inputTokens: 7 }, { inputTokens: 3, outputTokens: 2 }],
      expected: { inputTokens: 10, outputTokens: 2 },
    },
    {
      name: 'a reported total does not imply input or output counts',
      usage: [{ totalTokens: 9 }],
      expected: { totalTokens: 9 },
    },
    {
      name: 'aggregate cache counters do not inflate input totals',
      usage: {
        promptTokens: 12,
        completionTokens: 3,
        totalTokens: 15,
        promptTokensDetails: { cachedTokens: 8, cacheWriteTokens: 2 },
        cost: 0.01,
      },
      expected: {
        inputTokens: 12,
        outputTokens: 3,
        totalTokens: 15,
        cachedInputTokens: 8,
        cacheWriteInputTokens: 2,
        cost: 0.01,
      },
    },
    {
      name: 'duplicate supplemental cache counters are not added twice',
      usage: [
        { cachedInputTokens: 3, cacheWriteInputTokens: 1 },
        { cachedInputTokens: 5, cacheWriteInputTokens: 1 },
      ],
      supplemental: {
        promptTokensDetails: { cachedTokens: 8, cacheWriteTokens: 2 },
        cost: 0.01,
      },
      expected: { cachedInputTokens: 8, cacheWriteInputTokens: 2, cost: 0.01 },
    },
    {
      name: 'reported zero takes precedence over supplemental cache counts',
      usage: [
        {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cachedInputTokens: 0,
          cacheWriteInputTokens: 0,
        },
      ],
      supplemental: {
        promptTokensDetails: { cachedTokens: 8, cacheWriteTokens: 2 },
        cost: 0,
      },
      expected: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 0,
        cost: 0,
      },
    },
    {
      name: 'metadata-only cache and cost remain available without token totals',
      supplemental: {
        promptTokensDetails: { cachedTokens: 8, cacheWriteTokens: 2 },
        cost: 0,
      },
      expected: { cachedInputTokens: 8, cacheWriteInputTokens: 2, cost: 0 },
    },
    {
      name: 'aggregate snapshots own their details rather than mixing representations',
      usage: { promptTokens: 7 },
      supplemental: { promptTokensDetails: { cachedTokens: 8 }, cost: 1 },
      expected: { inputTokens: 7 },
    },
    {
      name: 'invalid values cannot poison benchmark sums',
      usage: [
        {
          inputTokens: Number.NaN,
          outputTokens: -1,
          totalTokens: Number.POSITIVE_INFINITY,
        },
      ],
      supplemental: {
        promptTokensDetails: { cachedTokens: -2, cacheWriteTokens: Number.NaN },
        cost: Number.POSITIVE_INFINITY,
      },
    },
    {
      name: 'invalid source cache values do not hide valid supplemental measurements',
      usage: [{ cachedInputTokens: -1, cacheWriteInputTokens: Number.NaN }],
      supplemental: {
        promptTokensDetails: { cachedTokens: 8, cacheWriteTokens: 2 },
      },
      expected: { cachedInputTokens: 8, cacheWriteInputTokens: 2 },
    },
    {
      name: 'overflowed aggregates are absent rather than infinite measurements',
      usage: [
        { inputTokens: Number.MAX_VALUE },
        { inputTokens: Number.MAX_VALUE },
      ],
    },
  ])('$name', ({ usage, supplemental, expected }) => {
    expect(normalizeLlmUsage(usage, supplemental)).toEqual(expected);
  });

  test('normalization cannot change a snapshot reused by another consumer', () => {
    const usage = Object.freeze([
      Object.freeze({ inputTokens: 12, cachedInputTokens: 8 }),
    ]);
    const supplemental = Object.freeze({
      promptTokensDetails: Object.freeze({
        cachedTokens: 8,
        cacheWriteTokens: 2,
      }),
      cost: 0,
    });
    expect(normalizeLlmUsage(usage, supplemental)).toEqual({
      inputTokens: 12,
      cachedInputTokens: 8,
      cacheWriteInputTokens: 2,
      cost: 0,
    });
    expect(usage).toEqual([{ inputTokens: 12, cachedInputTokens: 8 }]);
    expect(supplemental).toEqual({
      promptTokensDetails: { cachedTokens: 8, cacheWriteTokens: 2 },
      cost: 0,
    });
  });

  test('unknown metadata and nonnumeric runtime counters never enter usage records', () => {
    const usage = [
      {
        inputTokens: '12',
        provider: 'private',
        secret: 'private-key',
        cachedInputTokens: 0,
      },
    ] as unknown as LlmUsageInput;
    expect(normalizeLlmUsage(usage)).toEqual({ cachedInputTokens: 0 });
  });
});
