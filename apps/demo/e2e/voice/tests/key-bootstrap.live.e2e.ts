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
        document.querySelector('#start').remove();
        document.body.dataset.voiceReady = 'yes';
        document.body.insertAdjacentHTML('beforeend', '<button class="voice-orb">Voice</button>');
      });
    </script>
  `);

  await startVoiceDemoFromKeylessLanding(page, nonSecretInput);

  await expect(page.locator('body')).toHaveAttribute('data-voice-ready', 'yes');
  await expect(page.getByRole('status')).toHaveCount(0);
});

test('bootstraps an aria-labeled keyless landing CTA', async ({ page }) => {
  await page.setContent(`
    <button id="start" aria-label="Start interactive demo">Continue</button>
    <div role="dialog" hidden>
      <input id="playground-api-key" type="password" />
      <button id="save">Save</button>
    </div>
    <script>
      document.querySelector('#start').addEventListener('click', () => {
        document.querySelector('[role="dialog"]').hidden = false;
      });
      document.querySelector('#save').addEventListener('click', () => {
        document.body.dataset.submitted = 'yes';
        document.querySelector('[role="dialog"]').hidden = true;
        document.querySelector('#start').remove();
        document.body.insertAdjacentHTML('beforeend', '<button class="voice-orb">Voice</button>');
      });
    </script>
  `);

  await startVoiceDemoFromKeylessLanding(page, nonSecretInput);

  await expect(page.locator('body')).toHaveAttribute('data-submitted', 'yes');
  await expect(page.locator('button.voice-orb')).toHaveCount(1);
});

test('bootstraps a visible keyless landing CTA without a status role', async ({
  page,
}) => {
  await page.setContent(`
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
        document.body.dataset.submitted = 'yes';
        document.querySelector('[role="dialog"]').hidden = true;
        document.querySelector('#start').remove();
        document.body.insertAdjacentHTML('beforeend', '<button class="voice-orb">Voice</button>');
      });
    </script>
  `);

  await startVoiceDemoFromKeylessLanding(page, nonSecretInput);

  await expect(page.locator('body')).toHaveAttribute('data-submitted', 'yes');
  await expect(page.getByRole('status')).toHaveCount(0);
});

for (const nameSource of ['text', 'aria-label'] as const) {
  test(`bootstraps a visible ${nameSource} Start action after a hidden match`, async ({
    page,
  }) => {
    test.setTimeout(5_000);
    const startMarkup =
      nameSource === 'text' ? 'Start interactive demo' : 'Continue';
    const startAttributes =
      nameSource === 'aria-label' ? 'aria-label="Start interactive demo"' : '';
    await page.setContent(`
      <button hidden ${startAttributes}>${startMarkup}</button>
      <button id="start" ${startAttributes}>${startMarkup}</button>
      <div role="dialog" hidden>
        <input id="playground-api-key" type="password" />
        <button id="save">Save</button>
      </div>
      <script>
        document.querySelector('#start').addEventListener('click', () => {
          document.querySelector('[role="dialog"]').hidden = false;
        });
        document.querySelector('#save').addEventListener('click', () => {
          document.body.dataset.submitted = 'yes';
          document.querySelector('[role="dialog"]').remove();
          document.querySelector('#start').remove();
          document.body.insertAdjacentHTML('beforeend', '<button class="voice-orb">Voice</button>');
        });
      </script>
    `);

    await startVoiceDemoFromKeylessLanding(page, nonSecretInput);

    await expect(page.locator('body')).toHaveAttribute('data-submitted', 'yes');
    await expect(page.locator('button.voice-orb')).toBeVisible();
  });
}

test('rejects two visible Start actions on the key-required landing page', async ({
  page,
}) => {
  test.setTimeout(5_000);
  await page.setContent(`
    <div role="status" aria-label="Connection status: key required">Key required</div>
    <button>Start interactive demo</button>
    <button>Start interactive demo</button>
  `);

  await expect(
    startVoiceDemoFromKeylessLanding(page, nonSecretInput),
  ).rejects.toThrow('without its Start interactive demo action');
});

test('waits for the keyless landing to hydrate before bootstrapping', async ({
  page,
}) => {
  await page.setContent(`
    <script>
      setTimeout(() => {
        document.body.innerHTML = '<button id="start">Start interactive demo</button><div role="dialog" hidden><input id="playground-api-key" type="password"><button id="save">Save</button></div>';
        document.querySelector('#start').addEventListener('click', () => {
          document.querySelector('[role="dialog"]').hidden = false;
        });
        document.querySelector('#save').addEventListener('click', () => {
          document.body.dataset.submitted = 'yes';
          document.querySelector('[role="dialog"]').hidden = true;
          document.querySelector('#start').remove();
          document.body.insertAdjacentHTML('beforeend', '<button class="voice-orb">Voice</button>');
        });
      }, 50);
    </script>
  `);

  await startVoiceDemoFromKeylessLanding(page, nonSecretInput);

  await expect(page.locator('body')).toHaveAttribute('data-submitted', 'yes');
});

test('waits for the start action instead of ending on key-required status alone', async ({
  page,
}) => {
  await page.setContent(`
    <div role="status" aria-label="Connection status: key required">Key required</div>
    <script>
      setTimeout(() => {
        document.body.insertAdjacentHTML('beforeend', '<button id="start">Start interactive demo</button><div role="dialog" hidden><input id="playground-api-key" type="password"><button id="save">Save</button></div>');
        document.querySelector('#start').addEventListener('click', () => {
          document.querySelector('[role="dialog"]').hidden = false;
        });
        document.querySelector('#save').addEventListener('click', () => {
          document.querySelector('[role="status"]').remove();
          document.querySelector('[role="dialog"]').remove();
          document.querySelector('button#start').remove();
          document.body.insertAdjacentHTML('beforeend', '<button class="voice-orb">Voice</button>');
        });
      }, 50);
    </script>
  `);

  await startVoiceDemoFromKeylessLanding(page, nonSecretInput);

  await expect(page.locator('button.voice-orb')).toHaveCount(1);
});

test('fails specifically when the status-less keyless landing remains after save', async ({
  page,
}) => {
  await page.setContent(`
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
    startVoiceDemoFromKeylessLanding(page, nonSecretInput, 100),
  ).rejects.toThrow('did not expose exactly one visible voice orb');
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
        document.querySelector('#start').remove();
        document.body.insertAdjacentHTML('beforeend', '<button class="voice-orb">Voice</button>');
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

test('rejects an unrecognized page instead of treating it as a completed bootstrap', async ({
  page,
}) => {
  await page.setContent('<main>Loading voice demo</main>');

  await expect(
    startVoiceDemoFromKeylessLanding(page, undefined),
  ).rejects.toThrow(
    'neither a ready voice orb nor a recognized keyless landing',
  );
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
    startVoiceDemoFromKeylessLanding(page, nonSecretInput, 100),
  ).rejects.toThrow('did not expose exactly one visible voice orb');
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
