import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const skillRoot = resolve(
  import.meta.dir,
  '../../skills/maelstrom-voice-devtools',
);

interface VADEvent {
  sequence: number;
  timestamp: string;
  captureId: string | null;
  type: string;
  data: {
    type: string;
    source: string;
    state: string;
    id?: string;
    reason?: string;
  };
}

async function timingExamples(): Promise<VADEvent[][]> {
  const source = await readFile(
    resolve(skillRoot, 'references/vad-timing.md'),
    'utf8',
  );
  return [...source.matchAll(/```json\n([\s\S]*?)\n```/g)].map(
    (match) => JSON.parse(match[1]) as VADEvent[],
  );
}

describe('Voice DevTools skill', () => {
  test('keeps MCP operations and timing caveats separate from SDK integration', async () => {
    const skill = (
      await readFile(resolve(skillRoot, 'SKILL.md'), 'utf8')
    ).replace(/\s+/g, ' ');
    const timing = (
      await readFile(resolve(skillRoot, 'references/vad-timing.md'), 'utf8')
    ).replace(/\s+/g, ' ');
    for (const tool of [
      'get_workflow',
      'get_state',
      'get_events',
      'get_transcript',
      'speak',
      'screenshot',
    ])
      expect(skill).toContain(`${tool}(`);
    expect(skill).toContain('already-connected');
    expect(skill).toContain('does not require an installed Maelstrom SDK');
    expect(skill).toContain('there is no generic remote-response stop tool');
    expect(skill).toContain('previous injected job');
    expect(skill).toContain('paid ElevenLabs');
    expect(skill).toContain('never blindly retry');
    expect(skill).toContain('untrusted website data');
    expect(timing).toContain('outer journal receipt `timestamp`');
    expect(timing).toContain('Never subtract `streamOffsetMs` across sources');
    expect(timing).toContain('no `jobId`');
    expect(timing).toContain('before host microphone-delivery gating');
    expect(timing).toContain('`gap` or `reset` invalidates a measurement');
    expect(timing).toContain('`capture_stopped`, `replaced`,');
    expect(timing).toContain('unmeasurable');
    expect(timing).toContain(
      'not a successful live microphone or provider trial',
    );
  });

  test('benchmark protocol preserves repeated conditions, sample accounting and honest summaries', async () => {
    const source = await readFile(
      resolve(skillRoot, 'references/benchmark-protocol.md'),
      'utf8',
    );
    const prose = source.replace(/\s+/g, ' ');
    for (const constraint of [
      'exact same prompt bytes',
      'Before **each** attempt restore',
      'conversation state',
      'no generic reset tool',
      'Increase observation windows for harder tasks',
      'does not select a stronger model',
      'requesting hidden reasoning',
      'Never flood Speak concurrently',
      'at least 20 measured values for p95',
      'State the sample size and percentile method',
      'no live benchmark was executed',
    ])
      expect(prose).toContain(constraint);
    const procedure = source
      .split('## Run one attempt at a time\n')[1]
      .split('\n## ')[0]
      .replace(/\s+/g, ' ');
    expect(procedure).toContain(
      'at least five sequential independent attempts per condition',
    );
    expect(procedure).toContain(
      'same exact prompt/command within each task/difficulty tier',
    );
    expect(procedure).toContain('not five different tasks pooled together');
    expect(procedure).toContain(
      'An authorized safety/budget stop may leave fewer than five attempts',
    );
    expect(procedure).toContain('benchmark as incomplete');
    expect(procedure).toContain('Never flood Speak concurrently');
    const rows = source
      .split('\n')
      .filter((row) => /^\| (Easy|Medium|Hard) \| \d+ \|/.test(row))
      .map((row) =>
        row
          .split('|')
          .slice(1, -1)
          .map((cell) => cell.trim()),
      );
    expect(rows.map((row) => row[0])).toEqual(['Easy', 'Medium', 'Hard']);
    expect(rows.map((row) => Number(row[1]))).toEqual([15, 30, 60]);
    for (const row of rows) {
      const [
        ,
        ,
        attempted,
        measured,
        failed,
        unmeasurable,
        samples,
        median,
        range,
        p95,
      ] = row;
      const values = samples
        .split(',')
        .map(Number)
        .sort((a, b) => a - b);
      const n = values.length;
      expect(Number(attempted)).toBe(5);
      expect(Number(measured)).toBe(n);
      expect(n + Number(failed) + Number(unmeasurable)).toBe(Number(attempted));
      expect(Number(median)).toBe(
        (values[Math.floor((n - 1) / 2)] + values[Math.floor(n / 2)]) / 2,
      );
      expect(range).toBe(`${values[0]}–${values[n - 1]}`);
      expect(n).toBeLessThan(20);
      expect(p95).toBe('unavailable');
    }
    const skill = await readFile(resolve(skillRoot, 'SKILL.md'), 'utf8');
    expect(skill).toContain('(references/benchmark-protocol.md)');
  });

  test('receipt-clock examples have source-correct endpoints and documented arithmetic', async () => {
    const examples = await timingExamples();
    expect(examples).toHaveLength(2);
    for (const events of examples) {
      for (const [index, event] of events.entries()) {
        expect(event.type).toBe('vad');
        expect(event.data.type).toBe('vad');
        expect(Number.isFinite(Date.parse(event.timestamp))).toBe(true);
        if (index > 0)
          expect(event.sequence).toBeGreaterThan(events[index - 1].sequence);
        if (event.data.source === 'desktop_app') {
          expect(event.captureId).toBeNull();
          expect(event.data.id).toBeUndefined();
        } else {
          expect(event.data.source).toBe('target_app');
          expect(event.captureId).toBe(event.data.id);
        }
      }
    }
    const [, t0, t1] = examples[0];
    expect(t0.sequence).toBe(102);
    expect(t0.data).toMatchObject({
      source: 'desktop_app',
      state: 'speech_ended',
      reason: 'silence',
    });
    expect(t1.sequence).toBe(103);
    expect(t1.data).toMatchObject({
      source: 'target_app',
      state: 'speech_started',
    });
    expect(Date.parse(t1.timestamp) - Date.parse(t0.timestamp)).toBe(250);

    const [, , start, t2, t3] = examples[1];
    expect(start.data).toMatchObject({
      source: 'target_app',
      state: 'speech_started',
    });
    expect(t2.sequence).toBe(204);
    expect(t2.data).toMatchObject({
      source: 'desktop_app',
      state: 'speech_started',
    });
    expect(t3.sequence).toBe(205);
    expect(t3.data).toMatchObject({
      source: 'target_app',
      state: 'speech_ended',
      reason: 'silence',
    });
    expect(t3.captureId).toBe(start.captureId);
    expect(Date.parse(t2.timestamp)).toBeGreaterThan(
      Date.parse(start.timestamp),
    );
    expect(Date.parse(t3.timestamp) - Date.parse(t2.timestamp)).toBe(720);
  });
});
