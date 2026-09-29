import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { Page, WebSocket } from '@playwright/test';
import {
  CALENDAR_WORD,
  observeProtocol,
  projectChartRequest,
  TASK_WORD,
} from './evidence.ts';

const caption = 'Close the calendar and leave only the existing task panel.';
const makeFrame = () =>
  JSON.stringify({
    type: 'chart_request',
    id: 'message-1',
    secret: 'never-store',
    request: {
      context: {
        layoutMode: 'tiling',
        updateReasons: [{ intent: 'private words' }],
      },
      layout: {
        type: 'tiling',
        tree: ['V', 'ID:calendar-main', 'ID:tasks-main'],
        instances: [
          { instanceId: 'calendar-main' },
          { instanceId: 'tasks-main' },
        ],
      },
      instances: [
        { instanceId: 'calendar-main' },
        { instanceId: 'tasks-main' },
      ],
      vessels: [{ description: 'private vessel text' }],
    },
  });

test('accepts the actual singular transcript and the plural fixture wording', () => {
  assert.match(caption, CALENDAR_WORD);
  assert.match(caption, TASK_WORD);
  assert.match('Keep the existing tasks panel.', TASK_WORD);
  assert.match('TASK PANEL', TASK_WORD);
});

test('does not match unrelated partial words or an empty caption', () => {
  for (const value of [
    '',
    'multitasking',
    'taskforce',
    'taskbar',
    'calendar only',
  ]) {
    assert.doesNotMatch(value, TASK_WORD);
  }
});

test('projects leaf tokens and instance IDs without retaining private payloads', () => {
  const data = projectChartRequest(makeFrame());
  assert.ok(data);
  assert.deepEqual(data.tree, ['V', 'ID:calendar-main', 'ID:tasks-main']);
  assert.deepEqual(data.declaredInstanceIds, ['calendar-main', 'tasks-main']);
  const json = JSON.stringify(data);
  assert.doesNotMatch(json, /secret|never-store|private|intent|vessels/);
  assert.deepEqual(projectChartRequest(Buffer.from(makeFrame())), data);
});

test('ignores auth, non-chart, malformed, and oversized messages', () => {
  for (const payload of [
    null,
    '',
    'not-json',
    'null',
    '{"type":"playground.hello","key":"secret"}',
    '{}',
    'x'.repeat(1_048_577),
  ]) {
    assert.equal(projectChartRequest(payload), null);
  }
});

test('does not reinterpret a double-prefixed leaf before saving diagnostics', () => {
  const frame = JSON.parse(makeFrame());
  frame.request.layout.tree[1] = 'ID:ID:calendar-main';
  const projection = projectChartRequest(JSON.stringify(frame));
  assert.ok(projection);
  assert.equal(projection.tree?.[1], 'ID:ID:calendar-main');
});

test('reports the actual protocol rejection and retains the original failed step', () => {
  const page = new EventEmitter();
  const evidence = observeProtocol(page as unknown as Page);
  page.emit('console', {
    type: () => 'warning',
    text: () => 'WebSocket connection retry',
  });
  evidence.assertHealthy('startup');
  const message =
    '[RequestCoordinator] Request failed: decodeClientEnvelope: invalid envelope: Tiling tree leaf "ID:calendar-main" is not declared in layout.instances';
  page.emit('console', { type: () => 'error', text: () => message });
  const cause = new Error('original assertion');
  assert.throws(
    () => evidence.assertHealthy('voice turn', cause),
    (error) => {
      assert.ok(error instanceof Error);
      assert.equal(error.cause, cause);
      assert.match(error.message, /decodeClientEnvelope/);
      return true;
    },
  );
  assert.equal(evidence.snapshot().failures.length, 1);
  evidence.dispose();
  assert.equal(page.listenerCount('console'), 0);
});

test('observes only the app websocket and removes socket listeners', () => {
  const page = new EventEmitter();
  const evidence = observeProtocol(page as unknown as Page);
  const app = Object.assign(new EventEmitter(), {
    url: () => 'ws://localhost:3001/ws',
  });
  const other = Object.assign(new EventEmitter(), {
    url: () => 'ws://localhost:3000/hmr',
  });
  page.emit('websocket', app as unknown as WebSocket);
  page.emit('websocket', other as unknown as WebSocket);
  app.emit('framesent', { payload: makeFrame() });
  other.emit('framesent', { payload: makeFrame() });
  assert.equal(evidence.snapshot().requests.length, 1);
  evidence.dispose();
  assert.equal(app.listenerCount('framesent'), 0);
});
