import { expect, test } from '@playwright/test';

for (const width of [1440, 390]) {
  test(`makes community and social links available at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/getting-started/introduction/');

    if (width < 800) {
      await page
        .getByRole('navigation', { name: 'Main', exact: true })
        .getByRole('button', { name: 'Menu', exact: true })
        .click();
    }

    const socials = page.locator('.sidebar-bottom-links');
    for (const [label, href] of [
      ['GitHub', 'https://github.com/maelstrom-co/maelstrom'],
      ['Discord', 'https://maelstrom-ai.co/discord'],
      ['X', 'https://x.com/maelstrom_co'],
    ]) {
      const link = socials.getByRole('link', { name: label, exact: true });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('href', href);
    }

    await page.screenshot({
      path: testInfo.outputPath('community-navigation.png'),
    });
  });
}
