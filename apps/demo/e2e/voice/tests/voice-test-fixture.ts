import { test as base } from '@playwright/test';
import { createVoiceTestDriver } from './voice-test-driver.ts';

export const test = base.extend<{
  readonly voiceDriver: ReturnType<typeof createVoiceTestDriver>;
}>({
  voiceDriver: async ({ page }, use, testInfo) => {
    const driver = createVoiceTestDriver(page);
    try {
      await use(driver);
    } finally {
      try {
        const evidence = await driver.evidence();
        await testInfo.attach('voice-driver-final-evidence.json', {
          body: JSON.stringify(evidence, null, 2),
          contentType: 'application/json',
        });
        await testInfo.attach('protocol-evidence.json', {
          body: JSON.stringify(evidence.protocol, null, 2),
          contentType: 'application/json',
        });
      } catch {
        console.error('Unable to attach voice driver evidence.');
      }
      await driver.dispose();
    }
  },
});
