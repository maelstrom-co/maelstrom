import { expect, test } from '@playwright/test';
import { enterAndSubmitApiKey } from './key-bootstrap.ts';

const nonSecretInput = 'not-a-real-key';

test('submits the key in an already-open popup without clicking the header opener', async ({
  page,
}) => {
  await page.setContent(`
    <button id="header-opener">API key</button>
    <div role="dialog">
      <input id="playground-api-key" type="password" />
      <button id="popup-submit">Add key</button>
    </div>
    <script>
      document.querySelector('#header-opener').addEventListener('click', () => {
        document.body.dataset.openerClicked = 'yes';
      });
      document.querySelector('#popup-submit').addEventListener('click', () => {
        document.body.dataset.submitted = 'yes';
      });
    </script>
  `);

  await enterAndSubmitApiKey(page, nonSecretInput);

  await expect(page.locator('body')).toHaveAttribute('data-submitted', 'yes');
  await expect(page.locator('body')).not.toHaveAttribute(
    'data-opener-clicked',
    'yes',
  );
});

test('opens a closed key popup from a unique API key header button', async ({
  page,
}) => {
  await page.setContent(`
    <button id="header-opener">API key</button>
    <div role="dialog" hidden>
      <input id="playground-api-key" type="password" />
      <button id="popup-submit">Save</button>
    </div>
    <script>
      document.querySelector('#header-opener').addEventListener('click', () => {
        document.querySelector('[role="dialog"]').hidden = false;
        document.body.dataset.openerClicked = 'yes';
      });
      document.querySelector('#popup-submit').addEventListener('click', () => {
        document.body.dataset.submitted = 'yes';
      });
    </script>
  `);

  await enterAndSubmitApiKey(page, nonSecretInput);

  await expect(page.locator('body')).toHaveAttribute(
    'data-opener-clicked',
    'yes',
  );
  await expect(page.locator('body')).toHaveAttribute('data-submitted', 'yes');
});

test('supports an unambiguous Add Key header opener outside the closed popup', async ({
  page,
}) => {
  await page.setContent(`
    <button id="header-opener">Add Key</button>
    <div role="dialog" hidden>
      <input id="playground-api-key" type="password" />
      <button id="popup-submit">Add key</button>
    </div>
    <script>
      document.querySelector('#header-opener').addEventListener('click', () => {
        document.querySelector('[role="dialog"]').hidden = false;
        document.body.dataset.openerClicked = 'yes';
      });
      document.querySelector('#popup-submit').addEventListener('click', () => {
        document.body.dataset.submitted = 'yes';
      });
    </script>
  `);

  await enterAndSubmitApiKey(page, nonSecretInput);

  await expect(page.locator('body')).toHaveAttribute(
    'data-opener-clicked',
    'yes',
  );
  await expect(page.locator('body')).toHaveAttribute('data-submitted', 'yes');
});
