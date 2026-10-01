import { expect, test } from '@playwright/test';
import {
  enterAndSubmitApiKey,
  startVoiceDemoFromKeylessLanding,
} from './key-bootstrap.ts';

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

test('launches the interactive demo from a key-required landing page', async ({
  page,
}) => {
  await page.setContent(`
    <div role="status" aria-label="Connection status: key required">Key required</div>
    <button id="start">Start interactive demo</button>
    <div role="dialog" hidden>
      <label for="playground-api-key">API key</label>
      <input id="playground-api-key" type="password" />
      <button id="save">Save</button>
    </div>
    <script>
      document.querySelector('#start').addEventListener('click', () => {
        document.querySelector('[role="dialog"]').hidden = false;
      });
      document.querySelector('#save').addEventListener('click', () => {
        document.querySelector('[role="dialog"]').hidden = true;
        document.querySelector('[role="status"]').remove();
        document.body.dataset.voiceReady = 'yes';
      });
    </script>
  `);

  await startVoiceDemoFromKeylessLanding(page, nonSecretInput);

  await expect(page.locator('body')).toHaveAttribute('data-voice-ready', 'yes');
  await expect(page.getByRole('status')).toHaveCount(0);
});

test('submits an already-open fullscreen key drawer without clicking its covered opener', async ({
  page,
}) => {
  await page.setContent(`
    <button id="start">Start interactive demo</button>
    <div role="dialog" aria-modal="true" style="position: fixed; inset: 0; z-index: 10; background: white">
      <div role="status" aria-label="Connection status: key required">Key required</div>
      <label for="playground-api-key">API key</label>
      <input id="playground-api-key" type="password" />
      <button id="save">Save</button>
    </div>
    <script>
      document.querySelector('#start').addEventListener('click', () => {
        document.body.dataset.openerClicked = 'yes';
      });
      document.querySelector('#save').addEventListener('click', () => {
        document.body.dataset.submitted = 'yes';
        document.querySelector('[role="status"]').remove();
        document.querySelector('[role="dialog"]').remove();
      });
    </script>
  `);

  await startVoiceDemoFromKeylessLanding(page, nonSecretInput);

  await expect(page.locator('body')).toHaveAttribute('data-submitted', 'yes');
  await expect(page.locator('body')).not.toHaveAttribute(
    'data-opener-clicked',
    'yes',
  );
});

test('preserves an already voice-ready page without requiring a key', async ({
  page,
}) => {
  await page.setContent('<button class="voice-orb">Voice</button>');

  await startVoiceDemoFromKeylessLanding(page, undefined);

  await expect(page.locator('button.voice-orb')).toHaveCount(1);
});

test('reports when the landing page still requires a key after saving', async ({
  page,
}) => {
  await page.setContent(`
    <div role="status" aria-label="Connection status: key required">Key required</div>
    <button id="start">Start interactive demo</button>
    <div role="dialog" hidden>
      <input id="playground-api-key" type="password" />
      <button id="save">Save</button>
    </div>
    <script>
      document.querySelector('#start').addEventListener('click', () => {
        document.querySelector('[role="dialog"]').hidden = false;
      });
    </script>
  `);

  await expect(
    startVoiceDemoFromKeylessLanding(page, nonSecretInput),
  ).rejects.toThrow('page still requires a key');
});

test('reports a missing start action on the key-required landing page', async ({
  page,
}) => {
  await page.setContent(
    '<div role="status" aria-label="Connection status: key required">Key required</div>',
  );

  await expect(
    startVoiceDemoFromKeylessLanding(page, nonSecretInput),
  ).rejects.toThrow('without its Start interactive demo action');
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
