import type { ChartRequest, MaelstromResponse } from '@maelstrom/protocol';
import { describe, expect, it } from 'vitest';
import { createHistoryManager } from './history-manager.js';
import { createInMemoryHistoryStore } from './memory-store.js';

function createRequest(
  userIntent: string,
  sessionId = 'session-1',
): ChartRequest {
  return {
    type: 'chart_request',
    id: `req-${Date.now()}`,
    context: {
      updateReasons: [{ type: 'user_intent', intent: userIntent }],
      chartDimensions: { columns: 12, rows: 8 },
      timestamp: Date.now(),
      sessionId,
    },
    instances: [],
    vessels: [],
    layout: [],
  };
}

function createResponse(
  requestId: string,
  userMessage: string,
  options: Partial<MaelstromResponse> = {},
): MaelstromResponse {
  return {
    type: 'maelstrom_response',
    requestId,
    userMessage,
    rationale: options.rationale ?? 'Test rationale',
    executionPlan: options.executionPlan ?? [],
    layoutDirective: options.layoutDirective ?? [],
  };
}

describe('createHistoryManager', () => {
  describe('recordTurn', () => {
    it('should record a conversation turn', async () => {
      const store = createInMemoryHistoryStore();
      const manager = createHistoryManager(store);

      const request = createRequest('Show calendar');
      const response = createResponse(request.id, 'Here is your calendar');

      await manager.recordTurn(request, response);

      const entries = await manager.getEntries('session-1');
      expect(entries).toHaveLength(1);
      expect(entries[0].userIntent).toBe('Show calendar');
      expect(entries[0].userMessage).toBe('Here is your calendar');
    });

    it('should include rationale and execution summary for standard level', async () => {
      const store = createInMemoryHistoryStore();
      const manager = createHistoryManager(store, { contentLevel: 'standard' });

      const request = createRequest('Switch to week view');
      const response = createResponse(request.id, 'Switching to week view', {
        rationale: 'User wants week view',
        executionPlan: [{ instanceId: 'cal-1', action: 'showWeek' }],
      });

      await manager.recordTurn(request, response);

      const entries = await manager.getEntries('session-1');
      expect(entries[0].rationale).toBe('User wants week view');
      expect(entries[0].executionSummary).toBe('cal-1.showWeek()');
    });

    it('should include full request/response for full level', async () => {
      const store = createInMemoryHistoryStore();
      const manager = createHistoryManager(store, { contentLevel: 'full' });

      const request = createRequest('Show calendar');
      const response = createResponse(request.id, 'Done');

      await manager.recordTurn(request, response);

      const entries = await manager.getEntries('session-1');
      expect(entries[0].fullRequest).toBeDefined();
      expect(entries[0].fullResponse).toBeDefined();
      expect(entries[0].fullRequest?.context.updateReasons[0]).toEqual({
        type: 'user_intent',
        intent: 'Show calendar',
      });
    });

    it('should exclude rationale for minimal level', async () => {
      const store = createInMemoryHistoryStore();
      const manager = createHistoryManager(store, { contentLevel: 'minimal' });

      const request = createRequest('Show calendar');
      const response = createResponse(request.id, 'Done', {
        rationale: 'Should not be stored',
      });

      await manager.recordTurn(request, response);

      const entries = await manager.getEntries('session-1');
      expect(entries[0].rationale).toBeUndefined();
      expect(entries[0].executionSummary).toBeUndefined();
    });
  });

  describe('getMessagesForSession', () => {
    it('should return empty array for new session', async () => {
      const store = createInMemoryHistoryStore();
      const manager = createHistoryManager(store);

      const messages = await manager.getMessagesForSession('new-session');
      expect(messages).toEqual([]);
    });

    it('should convert entries to AI SDK message format', async () => {
      const store = createInMemoryHistoryStore();
      const manager = createHistoryManager(store, { contentLevel: 'minimal' });

      const request = createRequest('Show calendar');
      const response = createResponse(request.id, 'Here is your calendar');

      await manager.recordTurn(request, response);

      const messages = await manager.getMessagesForSession('session-1');

      expect(messages).toHaveLength(2);
      expect(messages[0]).toEqual({
        role: 'user',
        content: 'Show calendar',
      });
      expect(messages[1]).toEqual({
        role: 'assistant',
        content: 'Here is your calendar',
      });
    });

    it('should include rationale in messages for standard level', async () => {
      const store = createInMemoryHistoryStore();
      const manager = createHistoryManager(store, { contentLevel: 'standard' });

      const request = createRequest('Show calendar');
      const response = createResponse(request.id, 'Here is your calendar', {
        rationale: 'User wants to see their schedule',
        executionPlan: [{ instanceId: 'cal-1', action: 'show' }],
      });

      await manager.recordTurn(request, response);

      const messages = await manager.getMessagesForSession('session-1');

      expect(messages[1].content).toContain('Here is your calendar');
      expect(messages[1].content).toContain(
        '[Internal reasoning: User wants to see their schedule]',
      );
      expect(messages[1].content).toContain('[Actions taken: cal-1.show()]');
    });

    it('should handle multiple conversation turns', async () => {
      const store = createInMemoryHistoryStore();
      const manager = createHistoryManager(store, { contentLevel: 'minimal' });

      // First turn
      const req1 = createRequest('Show calendar');
      const res1 = createResponse(req1.id, 'Here is your calendar');
      await manager.recordTurn(req1, res1);

      // Second turn
      const req2 = createRequest('Switch to week view');
      const res2 = createResponse(req2.id, 'Switched to week view');
      await manager.recordTurn(req2, res2);

      const messages = await manager.getMessagesForSession('session-1');

      expect(messages).toHaveLength(4);
      expect(messages[0].content).toBe('Show calendar');
      expect(messages[1].content).toBe('Here is your calendar');
      expect(messages[2].content).toBe('Switch to week view');
      expect(messages[3].content).toBe('Switched to week view');
    });

    it('should truncate to maxEntries', async () => {
      const store = createInMemoryHistoryStore();
      const manager = createHistoryManager(store, {
        contentLevel: 'minimal',
        maxEntries: 2,
      });

      // Add 3 turns
      for (let i = 1; i <= 3; i++) {
        const req = createRequest(`Intent ${i}`);
        const res = createResponse(req.id, `Response ${i}`);
        await manager.recordTurn(req, res);
      }

      const messages = await manager.getMessagesForSession('session-1');

      // Should only have last 2 turns (4 messages)
      expect(messages).toHaveLength(4);
      expect(messages[0].content).toBe('Intent 2');
      expect(messages[2].content).toBe('Intent 3');
    });
  });

  describe('clearSession', () => {
    it('should clear all history for a session', async () => {
      const store = createInMemoryHistoryStore();
      const manager = createHistoryManager(store);

      const request = createRequest('Show calendar');
      const response = createResponse(request.id, 'Done');
      await manager.recordTurn(request, response);

      await manager.clearSession('session-1');

      const messages = await manager.getMessagesForSession('session-1');
      expect(messages).toEqual([]);
    });
  });

  describe('addAssistantMessage', () => {
    it('should add a standalone assistant message to history', async () => {
      const store = createInMemoryHistoryStore();
      const manager = createHistoryManager(store);

      await manager.addAssistantMessage({
        sessionId: 'session-1',
        message: 'Welcome! How can I help you today?',
      });

      const entries = await manager.getEntries('session-1');
      expect(entries).toHaveLength(1);
      expect(entries[0].userMessage).toBe('Welcome! How can I help you today?');
      expect(entries[0].userIntent).toBeUndefined();
      expect(entries[0].updateReasons).toEqual([]);
    });

    it('should include assistant message in messages for session', async () => {
      const store = createInMemoryHistoryStore();
      const manager = createHistoryManager(store, { contentLevel: 'minimal' });

      await manager.addAssistantMessage({
        sessionId: 'session-1',
        message: 'Welcome!',
      });

      const request = createRequest('Show calendar');
      const response = createResponse(request.id, 'Here is your calendar');
      await manager.recordTurn(request, response);

      const messages = await manager.getMessagesForSession('session-1');

      expect(messages).toHaveLength(3);
      expect(messages[0]).toEqual({ role: 'assistant', content: 'Welcome!' });
      expect(messages[1]).toEqual({ role: 'user', content: 'Show calendar' });
      expect(messages[2]).toEqual({
        role: 'assistant',
        content: 'Here is your calendar',
      });
    });
  });

  describe('execution summary', () => {
    it('should summarize no actions', async () => {
      const store = createInMemoryHistoryStore();
      const manager = createHistoryManager(store, { contentLevel: 'standard' });

      const request = createRequest('Hello');
      const response = createResponse(request.id, 'Hello!', {
        executionPlan: [],
      });

      await manager.recordTurn(request, response);

      const entries = await manager.getEntries('session-1');
      expect(entries[0].executionSummary).toBe('No actions taken');
    });

    it('should summarize multiple actions', async () => {
      const store = createInMemoryHistoryStore();
      const manager = createHistoryManager(store, { contentLevel: 'standard' });

      const request = createRequest('Arrange widgets');
      const response = createResponse(request.id, 'Done', {
        executionPlan: [
          { instanceId: 'cal-1', action: 'show' },
          { instanceId: 'weather-1', action: 'expand' },
        ],
      });

      await manager.recordTurn(request, response);

      const entries = await manager.getEntries('session-1');
      expect(entries[0].executionSummary).toBe(
        'cal-1.show(), weather-1.expand()',
      );
    });
  });
});
