import { expect, test } from '@playwright/test';

const playgroundUrl = process.env.PLAYGROUND_URL;
if (!playgroundUrl) {
  throw new Error('PLAYGROUND_URL is required to test the Playground link');
}

test('main navigation links to the configured Playground', async ({ page }) => {
  await page.goto('/');

  const navigation = page.getByRole('navigation', {
    name: 'Main navigation',
  });
  await expect(
    navigation.getByRole('link', { name: 'Playground', exact: true }),
  ).toHaveAttribute('href', playgroundUrl);
});
