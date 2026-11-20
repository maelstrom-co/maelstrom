import { expect, test } from '@playwright/test';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

for (const [path, expected] of [
  ['/dev/getting-started/quick-start/', 'greetingVessel'],
  ['/dev/guides/react/variants-and-actions/', 'setName'],
  ['/dev/reference/react/readme/', '@maelstrom-co/react'],
  ['/agents/skills/', 'Install the complete bundle'],
  ['/understanding/architecture/', 'The round-trip, in words'],
]) {
  test(`${path} advertises a usable Markdown representation`, async ({
    page,
    request,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(path);
    const alternate = page.locator(
      'link[rel="alternate"][type="text/markdown"]',
    );
    const url = await alternate.getAttribute('href');
    expect(url).toBe(`${path.slice(0, -1)}.md`);
    const response = await request.get(url!);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/markdown');
    const body = await response.text();
    expect(body).toContain(expected);
    expect(body).toContain('Documentation revision:');
    expect(body).toContain('@maelstrom-co/react@');
    expect(body).not.toContain('<astro-island');
    await expect(
      page.locator('link[rel="alternate"][href="/llms.txt"]'),
    ).toHaveCount(1);
    expect(errors).toEqual([]);
  });
}

test('direct retrieval and copying use the same page representation', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(
    '/dev/getting-started/quick-start/?from=docs#wire-the-provider',
  );
  const response = await request.get('/dev/getting-started/quick-start.md');
  const button = page.getByRole('button', {
    name: 'Copy for AI as markdown',
    exact: true,
  });
  await button.click();
  await expect(button).toContainText('Copied!');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(await response.text());
  expect(errors).toEqual([]);
});

test('the default abridged context fits its budget and keeps onboarding prerequisites', async ({
  request,
}) => {
  const response = await request.get('/llms-small.txt');
  expect(response.ok()).toBe(true);
  const body = await response.text();
  expect(new TextEncoder().encode(body).length).toBeLessThanOrEqual(48_000);
  expect(body).toContain('Prerequisites');
  expect(body).toContain('A running Maelstrom engine');
  expect(body).not.toContain('# @maelstrom-co/');
  const index = await (await request.get('/llms.txt')).text();
  for (const destination of [
    '/agents/skills/',
    '/agents/prompts/',
    '/getting-started/starter/',
    '#sdk-guide-coverage',
  ]) {
    expect(index).toContain(destination);
  }
});

test('missing Markdown pages retain a not-found response', async ({
  request,
}) => {
  expect(
    (await request.get('/missing-page-for-markdown-test.md')).status(),
  ).toBe(404);
});
