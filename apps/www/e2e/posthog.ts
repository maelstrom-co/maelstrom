import type { Page } from '@playwright/test';

export interface CapturedPostHogEvent {
  event: string;
  properties?: Record<string, string>;
}

export async function installPostHogRecorder(
  page: Page,
): Promise<CapturedPostHogEvent[]> {
  const captures: CapturedPostHogEvent[] = [];
  await page.exposeFunction(
    'recordPostHogCapture',
    (event: string, properties?: Record<string, string>) => {
      captures.push({ event, properties });
    },
  );
  await page.addInitScript(() => {
    const testWindow = window as typeof window & {
      posthog: {
        capture: (event: string, properties?: Record<string, string>) => void;
      };
      recordPostHogCapture: (
        event: string,
        properties?: Record<string, string>,
      ) => void;
    };
    testWindow.posthog = {
      capture: (event, properties) =>
        testWindow.recordPostHogCapture(event, properties),
    };
  });
  return captures;
}
