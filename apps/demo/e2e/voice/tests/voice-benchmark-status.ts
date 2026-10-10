import { writeFile } from 'node:fs/promises';
import type { Page, TestInfo } from '@playwright/test';

const failurePhases = [
  'bootstrap',
  'realtime-connection',
  'assistant-caption',
  'assistant-output-audio',
] as const;
const connectionStates = [
  'idle',
  'error',
  'connected',
  'listening',
  'thinking',
  'speaking',
] as const;

export type VoiceBenchmarkFailurePhase = (typeof failurePhases)[number];

type VoiceBenchmarkFailureInput = Readonly<{
  readonly failurePhase: unknown;
  readonly captionChanged: unknown;
  readonly assistantOutputAudioActive: unknown;
  readonly assistantOutputAudioSampleCount: unknown;
}>;

function enumValue<T extends string>(
  value: unknown,
  values: readonly T[],
): T | 'unknown' {
  return typeof value === 'string' && values.includes(value as T)
    ? (value as T)
    : 'unknown';
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

export function createVoiceBenchmarkFailureStatus(
  input: VoiceBenchmarkFailureInput & Readonly<Record<string, unknown>>,
  browser: Readonly<Record<string, unknown>>,
  diagnosticCollectionSucceeded: boolean,
) {
  const failurePhase = enumValue(input.failurePhase, failurePhases);
  const connectionState = enumValue(browser.connectionState, connectionStates);
  const captionChanged = input.captionChanged === true;
  const assistantOutputAudioActive = input.assistantOutputAudioActive === true;
  const turnCompletionState =
    connectionState === 'error'
      ? 'error'
      : ['thinking', 'speaking'].includes(connectionState)
        ? 'in-progress'
        : ['connected', 'listening'].includes(connectionState) &&
            (captionChanged || assistantOutputAudioActive)
          ? 'complete'
          : 'not-observed';

  return {
    failurePhase,
    diagnosticCollectionSucceeded,
    keyBootstrapReady: browser.keyBootstrapReady === true,
    voiceOrbCount: count(browser.voiceOrbCount),
    captionsRootCount: count(browser.captionsRootCount),
    keyInputCount: count(browser.keyInputCount),
    keyRequiredStatusCount: count(browser.keyRequiredStatusCount),
    connectionState,
    turnCompletionState,
    assistantTranscriptNodeCount: count(browser.assistantTranscriptNodeCount),
    assistantTranscriptMutationCount: count(
      browser.assistantTranscriptMutationCount,
    ),
    assistantMutationObserverInstalled:
      browser.assistantMutationObserverInstalled === true,
    captionChanged,
    assistantOutputAudioActive,
    assistantOutputAudioSampleCount: count(
      input.assistantOutputAudioSampleCount,
    ),
  } as const;
}

export async function installAssistantCaptionMutationObserver(
  page: Page,
): Promise<boolean> {
  return page.evaluate(() => {
    type DiagnosticWindow = Window & {
      __voiceBenchmarkAssistantMutationCount?: number;
      __voiceBenchmarkAssistantObserver?: MutationObserver;
      __voiceBenchmarkAssistantObserverInstalled?: boolean;
    };
    const target = window as DiagnosticWindow;
    target.__voiceBenchmarkAssistantObserver?.disconnect();
    target.__voiceBenchmarkAssistantMutationCount = 0;
    target.__voiceBenchmarkAssistantObserverInstalled = false;

    const captions = document.querySelector('[data-testid="captions"]');
    if (!captions) return false;

    const belongsToAssistantCaption = (node: Node): boolean => {
      const element =
        node instanceof Element ? node : (node.parentElement ?? undefined);
      return Boolean(
        element &&
          (element.matches('[data-role="assistant"]') ||
            element.closest('[data-role="assistant"]') ||
            element.querySelector('[data-role="assistant"]')),
      );
    };
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        const changedAssistantCaption =
          belongsToAssistantCaption(record.target) ||
          [...record.addedNodes, ...record.removedNodes].some(
            belongsToAssistantCaption,
          );
        if (changedAssistantCaption)
          target.__voiceBenchmarkAssistantMutationCount =
            (target.__voiceBenchmarkAssistantMutationCount ?? 0) + 1;
      }
    });
    observer.observe(captions, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    target.__voiceBenchmarkAssistantObserver = observer;
    target.__voiceBenchmarkAssistantObserverInstalled = true;
    return true;
  });
}

export async function collectVoiceBenchmarkFailureStatus(
  page: Page,
  input: VoiceBenchmarkFailureInput & Readonly<Record<string, unknown>>,
) {
  let browser: Record<string, unknown>;
  let diagnosticCollectionSucceeded = true;
  try {
    browser = await page.evaluate(() => {
      type DiagnosticWindow = Window & {
        __voiceBenchmarkAssistantMutationCount?: number;
        __voiceBenchmarkAssistantObserverInstalled?: boolean;
      };
      const voiceOrb = document.querySelector('button.voice-orb');
      const connectionState = voiceOrb?.getAttribute('data-state');
      const voiceOrbCount =
        document.querySelectorAll('button.voice-orb').length;
      const captionsRootCount = document.querySelectorAll(
        '[data-testid="captions"]',
      ).length;
      const keyInputCount = document.querySelectorAll(
        '#playground-api-key',
      ).length;
      const keyRequiredStatusCount = document.querySelectorAll(
        '[role="status"][aria-label*="key required" i]',
      ).length;
      return {
        keyBootstrapReady:
          voiceOrbCount === 1 &&
          captionsRootCount === 1 &&
          keyInputCount === 0 &&
          keyRequiredStatusCount === 0,
        voiceOrbCount,
        captionsRootCount,
        keyInputCount,
        keyRequiredStatusCount,
        connectionState,
        assistantTranscriptNodeCount: document.querySelectorAll(
          '[data-testid="captions"] [data-role="assistant"]',
        ).length,
        assistantTranscriptMutationCount:
          (window as DiagnosticWindow).__voiceBenchmarkAssistantMutationCount ??
          0,
        assistantMutationObserverInstalled:
          (window as DiagnosticWindow)
            .__voiceBenchmarkAssistantObserverInstalled === true,
      };
    });
  } catch {
    diagnosticCollectionSucceeded = false;
    browser = {};
  }

  return createVoiceBenchmarkFailureStatus(
    input,
    browser,
    diagnosticCollectionSucceeded,
  );
}

export async function attachVoiceBenchmarkFailureStatus(
  page: Page,
  testInfo: TestInfo,
  input: VoiceBenchmarkFailureInput & Readonly<Record<string, unknown>>,
): Promise<void> {
  const status = await collectVoiceBenchmarkFailureStatus(page, input);
  const body = JSON.stringify(status, null, 2);
  await writeFile(
    testInfo.outputPath('voice-benchmark-failure-status.json'),
    body,
    { mode: 0o600 },
  );
  await testInfo.attach('voice-benchmark-failure-status.json', {
    body,
    contentType: 'application/json',
  });
}
