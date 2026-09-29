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
