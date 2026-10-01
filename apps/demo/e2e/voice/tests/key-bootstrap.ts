import type { Page } from '@playwright/test';

const missingEntryMessage =
  'The key popup is missing its Add key or Save action.';

export async function hasKeyEntryControl(page: Page) {
  const apiKeyButton = page.getByRole('button', {
    name: 'API key',
    exact: true,
  });
  if ((await apiKeyButton.count()) === 1 && (await apiKeyButton.isVisible()))
    return true;

  const addKeyButton = page.getByRole('button', { name: /^Add key$/i });
  return (await addKeyButton.count()) === 1 && (await addKeyButton.isVisible());
}

export async function enterAndSubmitApiKey(page: Page, key: string) {
  const input = page.locator('#playground-api-key');
  const inputVisible = await input.isVisible().catch(() => false);

  if (!inputVisible) {
    const popup = page.getByRole('dialog').filter({ has: input });
    if (await popup.isVisible().catch(() => false)) {
      await input.waitFor({ state: 'visible' });
    } else {
      const apiKeyButton = page.getByRole('button', {
        name: 'API key',
        exact: true,
      });
      if (
        (await apiKeyButton.count()) === 1 &&
        (await apiKeyButton.isVisible())
      ) {
        await apiKeyButton.click();
      } else {
        const addKeyButton = page.getByRole('button', {
          name: /^Add key$/i,
        });
        if (
          (await addKeyButton.count()) !== 1 ||
          !(await addKeyButton.isVisible())
        )
          throw new Error(
            'The app does not expose one unambiguous API key opener.',
          );
        await addKeyButton.click();
      }
      await input.waitFor({ state: 'visible' });
    }
  }
  await input.evaluate((element, value) => {
    const field = element as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set;
    if (!setter) throw new Error('Password input value setter is unavailable.');
    setter.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }, key);

  const popup = page.getByRole('dialog').filter({ has: input });
  await popup.waitFor({ state: 'visible' });
  const addKeySubmit = popup.getByRole('button', { name: /^Add key$/i });
  if ((await addKeySubmit.count()) === 1) {
    await addKeySubmit.click();
    return;
  }

  const saveButton = popup.getByRole('button', {
    name: 'Save',
    exact: true,
  });
  if ((await saveButton.count()) !== 1) throw new Error(missingEntryMessage);
  await saveButton.click();
}

export async function startVoiceDemoFromKeylessLanding(
  page: Page,
  apiKey: string | undefined,
) {
  await page
    .waitForFunction(
      () => {
        const isVisible = (element: Element | null) => {
          if (!element) return false;
          const style = getComputedStyle(element);
          const bounds = element.getBoundingClientRect();
          return (
            style.visibility !== 'hidden' &&
            style.display !== 'none' &&
            bounds.width > 0 &&
            bounds.height > 0
          );
        };
        const startButton = [...document.querySelectorAll('button')].find(
          (button) => button.textContent?.trim() === 'Start interactive demo',
        );
        return (
          isVisible(startButton ?? null) ||
          isVisible(document.querySelector('button.voice-orb')) ||
          isVisible(document.querySelector('#playground-api-key')) ||
          isVisible(
            document.querySelector(
              '[role="status"][aria-label*="connection status: key required" i]',
            ),
          )
        );
      },
      undefined,
      { timeout: 10_000 },
    )
    .catch(() => undefined);

  const keyRequired = page.getByRole('status', {
    name: /connection status: key required/i,
  });
  const keyInput = page.locator('#playground-api-key');
  const keyDialog = page.getByRole('dialog').filter({ has: keyInput });
  const drawerAlreadyOpen =
    (await keyInput.isVisible().catch(() => false)) ||
    (await keyDialog.isVisible().catch(() => false));
  const keyIsRequired = await keyRequired.isVisible().catch(() => false);
  const startButton = page.getByRole('button', {
    name: 'Start interactive demo',
    exact: true,
  });
  const startButtonVisible =
    (await startButton.count()) === 1 &&
    (await startButton.isVisible().catch(() => false));
  if (!keyIsRequired && !drawerAlreadyOpen && !startButtonVisible) {
    const voiceOrb = page.locator('button.voice-orb');
    if ((await voiceOrb.count()) === 1 && (await voiceOrb.isVisible())) return;
    throw new Error(
      'Voice benchmark found neither a ready voice orb nor a recognized keyless landing page.',
    );
  }

  if (!drawerAlreadyOpen) {
    if (!startButtonVisible)
      throw new Error(
        'Voice benchmark found the key-required landing page without its Start interactive demo action.',
      );
    await startButton.click();
  }

  if (!apiKey)
    throw new Error(
      'BYOK voice benchmark requires MAELSTROM_E2E_OPENAI_API_KEY',
    );
  await enterAndSubmitApiKey(page, apiKey);

  if (await keyRequired.isVisible().catch(() => false))
    throw new Error(
      'Voice benchmark API-key bootstrap completed but the page still requires a key.',
    );
  if (await startButton.isVisible().catch(() => false))
    throw new Error(
      'Voice benchmark API-key bootstrap completed but the page remains on the keyless landing.',
    );
}
