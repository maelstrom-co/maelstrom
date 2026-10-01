import assert from 'node:assert/strict';
import { test } from '@playwright/test';
import {
  attachVoiceBenchmarkFailureStatus,
  installAssistantCaptionMutationObserver,
} from './voice-benchmark-status.ts';

test('attaches only status fields for synthetic benchmark failures', async ({
  page,
}, testInfo) => {
  await page.setContent(`
    <button class="voice-orb" data-state="listening"></button>
    <div data-testid="captions">
      <p data-role="assistant"><span>synthetic-transcript-value</span></p>
    </div>
    <input id="playground-api-key" type="password" value="synthetic-api-key-value" />
    <div role="status" aria-label="Connection status: key required"></div>
  `);
  assert.equal(await installAssistantCaptionMutationObserver(page), true);
  await page.evaluate(() => {
    const caption = document.querySelector('[data-role="assistant"] span');
    if (caption) caption.textContent = 'synthetic-updated-transcript-value';
  });
  await page.waitForTimeout(0);

  await attachVoiceBenchmarkFailureStatus(page, testInfo, {
    failurePhase: 'assistant-caption',
    captionChanged: true,
    assistantOutputAudioActive: true,
    assistantOutputAudioSampleCount: 48_000,
    transcript: 'synthetic-transcript-value',
    apiKey: 'synthetic-api-key-value',
    inputValue: 'synthetic-input-value',
  });

  const attachment = testInfo.attachments.find(
    ({ name }) => name === 'voice-benchmark-failure-status.json',
  );
  assert.ok(attachment?.body);
  const serialized = attachment.body.toString('utf8');
  const status = JSON.parse(serialized) as Record<string, unknown>;
  assert.deepEqual(Object.keys(status).sort(), [
    'assistantMutationObserverInstalled',
    'assistantOutputAudioActive',
    'assistantOutputAudioSampleCount',
    'assistantTranscriptMutationCount',
    'assistantTranscriptNodeCount',
    'captionChanged',
    'captionsRootCount',
    'connectionState',
    'diagnosticCollectionSucceeded',
    'failurePhase',
    'keyBootstrapReady',
    'keyInputCount',
    'keyRequiredStatusCount',
    'turnCompletionState',
    'voiceOrbCount',
  ]);
  assert.equal(status.failurePhase, 'assistant-caption');
  assert.equal(status.connectionState, 'listening');
  assert.equal(status.keyBootstrapReady, false);
  assert.equal(status.keyInputCount, 1);
  assert.equal(status.keyRequiredStatusCount, 1);
  assert.equal(status.assistantTranscriptNodeCount, 1);
  assert.equal(status.assistantMutationObserverInstalled, true);
  assert.ok(Number(status.assistantTranscriptMutationCount) > 0);
  assert.equal(status.captionChanged, true);
  assert.equal(status.assistantOutputAudioActive, true);
  assert.equal(status.assistantOutputAudioSampleCount, 48_000);
  assert.doesNotMatch(
    serialized,
    /synthetic-transcript-value|synthetic-updated-transcript-value|synthetic-api-key-value|synthetic-input-value/,
  );
});
