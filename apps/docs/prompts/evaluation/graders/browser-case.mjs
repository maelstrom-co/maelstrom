import { spawn } from 'node:child_process';
import { access, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from '@playwright/test';

const [candidateRoot, caseId] = process.argv.slice(2);
if (
  !candidateRoot ||
  !['onboarding-implementation', 'react-conversion'].includes(caseId)
) {
  console.error(
    'usage: node browser-case.mjs CANDIDATE_ROOT <onboarding-implementation|react-conversion>',
  );
  process.exit(2);
}
const observerPath = join(candidateRoot, 'src/evaluation-observer.ts');
try {
  await access(observerPath);
  throw new Error('Candidate pre-created the reserved evaluator observer path');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await writeFile(
  observerPath,
  `import { Orchestrator } from '@maelstrom-co/client';
const evaluatorWindow = window as Window & { __maelstromEvaluatorSdk?: unknown[] };
evaluatorWindow.__maelstromEvaluatorSdk ??= [];
const originalConnect = Orchestrator.prototype.connect;
Orchestrator.prototype.connect = function (...args) {
  const state = this.commandProcessor.store.state;
  evaluatorWindow.__maelstromEvaluatorSdk.push({
    vesselIds: this.vesselManager.getAll().map((vessel) => vessel.id),
    instances: Array.from(state.instances, ([instanceId, instance]) => ({ instanceId, vesselId: instance.vesselId })),
    layout: state.layout,
  });
  return originalConnect.apply(this, args);
};
`,
  { flag: 'wx', mode: 0o600 },
);
const port = await freePort();
const vite = spawn(
  `${candidateRoot}/node_modules/.bin/vite`,
  ['--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  {
    cwd: candidateRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  },
);
let serverOutput = '';
vite.stdout.setEncoding('utf8').on('data', (chunk) => {
  serverOutput += chunk;
});
vite.stderr.setEncoding('utf8').on('data', (chunk) => {
  serverOutput += chunk;
});
let browser;
let page;
let stage = 'wait-vite-server';
const pageErrors = [];
const consoleErrors = [];
const failedRequests = [];
try {
  await waitForServer(`http://127.0.0.1:${port}/`, vite, () => serverOutput);
  stage = 'launch-browser';
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1100, height: 760 },
  });
  await context.grantPermissions(['local-network-access'], {
    origin: `http://127.0.0.1:${port}`,
  });
  page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message.slice(0, 500)));
  page.on('console', (message) => {
    if (message.type() === 'error')
      consoleErrors.push(message.text().slice(0, 500));
  });
  page.on('requestfailed', (request) =>
    failedRequests.push({
      url: request.url().slice(0, 500),
      failure: request.failure()?.errorText,
    }),
  );
  stage = 'install-index-observer-route';
  await page.route(`http://127.0.0.1:${port}/`, async (route) => {
    const response = await route.fetch();
    const html = await response.text();
    const entry = '<script type="module" src="/src/main.tsx"></script>';
    if (!html.includes(entry))
      throw new Error('Could not find fixture app entry in served index.html');
    await route.fulfill({
      response,
      body: html.replace(
        entry,
        `<script type="module" src="/src/evaluation-observer.ts"></script>${entry}`,
      ),
    });
  });
  stage = 'navigate-app';
  await page.goto(`http://127.0.0.1:${port}/`, {
    waitUntil: 'networkidle',
    timeout: 20_000,
  });
  stage = 'wait-sdk-connect-observation';
  await page.waitForFunction(
    () =>
      Array.isArray(window.__maelstromEvaluatorSdk) &&
      window.__maelstromEvaluatorSdk.length > 0,
    { timeout: 10_000 },
  );
  stage = 'wait-rendered-sdk-instance-marker';
  await page.waitForFunction(
    () => {
      const records = window.__maelstromEvaluatorSdk ?? [];
      const renderedIds = new Set(
        Array.from(document.querySelectorAll('[data-instance-id]'))
          .filter((element) => !element.hasAttribute('data-exiting'))
          .map((element) => element.getAttribute('data-instance-id')),
      );
      return records.some((record) => {
        const registeredVesselIds = new Set(record.vesselIds);
        return record.instances.some(
          (instance) =>
            registeredVesselIds.has(instance.vesselId) &&
            renderedIds.has(instance.instanceId),
        );
      });
    },
    { timeout: 10_000 },
  );
  stage = 'validate-sdk-registration-instance';
  const registeredInstances = await page.evaluate(() => {
    const records = window.__maelstromEvaluatorSdk ?? [];
    return records.flatMap((record) => {
      const registeredVesselIds = new Set(record.vesselIds);
      return record.instances
        .filter((instance) => registeredVesselIds.has(instance.vesselId))
        .map(({ instanceId, vesselId }) => ({ instanceId, vesselId }));
    });
  });
  const renderedMarkers = page.locator('[data-instance-id]');
  const markerCount = await renderedMarkers.count();
  const renderCandidates = [];
  for (let index = 0; index < markerCount; index += 1) {
    const marker = renderedMarkers.nth(index);
    const instanceId = await marker.getAttribute('data-instance-id');
    if (!instanceId || (await marker.getAttribute('data-exiting')) !== null)
      continue;
    const vesselIds = [
      ...new Set(
        registeredInstances
          .filter((instance) => instance.instanceId === instanceId)
          .map((instance) => instance.vesselId),
      ),
    ];
    for (const vesselId of vesselIds)
      renderCandidates.push({ marker, instanceId, vesselId });
  }
  if (!renderCandidates.length)
    throw new Error(
      'No rendered SDK instance marker matches an evaluator-observed registered Vessel and instance mapping',
    );

  stage = 'validate-case-ui';
  if (caseId === 'onboarding-implementation') {
    await page.getByRole('heading', { name: 'Support workspace' }).waitFor();
    await page.getByText('Review the open support queue.').waitFor();
  } else {
    await page.getByText('Search support tickets.').waitFor();
  }
  const candidateFailures = [];
  let selectedCandidate;
  for (const candidate of renderCandidates) {
    const { marker, instanceId, vesselId } = candidate;
    stage = 'validate-chart-vessel-geometry';
    const tileGeometry = await marker.boundingBox();
    const chartGeometry = await marker.evaluate((element) => {
      let parent = element.parentElement;
      while (parent && getComputedStyle(parent).position !== 'relative')
        parent = parent.parentElement;
      if (!parent) return null;
      const rect = parent.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      };
    });
    if (
      !tileGeometry ||
      !chartGeometry ||
      tileGeometry.width < 40 ||
      tileGeometry.height < 40 ||
      chartGeometry.width < 100 ||
      chartGeometry.height < 100 ||
      tileGeometry.x < chartGeometry.left - 1 ||
      tileGeometry.y < chartGeometry.top - 1 ||
      tileGeometry.x + tileGeometry.width > chartGeometry.right + 1 ||
      tileGeometry.y + tileGeometry.height > chartGeometry.bottom + 1
    ) {
      candidateFailures.push(
        `${vesselId}/${instanceId}: missing, collapsed, or out-of-Chart geometry`,
      );
      continue;
    }
    stage = 'validate-case-ui';
    try {
      if (caseId === 'onboarding-implementation') {
        const rows = marker.locator('li');
        if ((await rows.count()) !== 2)
          throw new Error('ticket queue did not render exactly two rows');
        const expectedRows = [
          'Cannot update billing address — Open',
          'Export is missing a column — Waiting',
        ];
        for (const [index, expectedRow] of expectedRows.entries()) {
          if ((await rows.nth(index).innerText()).trim() !== expectedRow)
            throw new Error(`ticket row ${index + 1} content/status changed`);
        }
      } else {
        const input = marker.getByRole('textbox', { name: 'Search tickets' });
        const button = marker.getByRole('button', { name: 'Search' });
        if ((await input.count()) !== 1 || (await button.count()) !== 1)
          throw new Error('search panel controls were not inside this Vessel');
        await input.fill('   ');
        if (!(await button.isDisabled()))
          throw new Error('whitespace-only search submit was enabled');
        await input.fill('billing');
        await button.click();
        const status = marker.getByRole('status');
        await status.waitFor({ timeout: 10_000 });
        if (!(await status.innerText()).includes('1 results'))
          throw new Error('successful simulated search result missing');
      }
      selectedCandidate = {
        ...candidate,
        tileGeometry,
        chartGeometry,
      };
      break;
    } catch (error) {
      candidateFailures.push(
        `${vesselId}/${instanceId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (!selectedCandidate)
    throw new Error(
      `No registered, rendered Vessel instance satisfied the case UI and geometry: ${candidateFailures.join('; ')}`,
    );
  console.log(
    JSON.stringify({
      caseId,
      chartGeometry: selectedCandidate.chartGeometry,
      tileGeometry: selectedCandidate.tileGeometry,
      visibleVessel: true,
      sdkVesselRegistered: selectedCandidate.vesselId,
      sdkInstanceRendered: selectedCandidate.instanceId,
      ticketRowsValidated:
        caseId === 'onboarding-implementation' ? 2 : undefined,
      appAssertions: 'passed',
    }),
  );
} catch (error) {
  const browserState = page
    ? await page
        .evaluate(() => ({
          url: location.href,
          readyState: document.readyState,
          observerScriptPresent: Array.from(document.scripts).some((script) =>
            script.src.includes('/src/evaluation-observer.ts'),
          ),
          sdkObservationCount: window.__maelstromEvaluatorSdk?.length ?? 0,
          instanceCount: document.querySelectorAll('[data-instance-id]').length,
        }))
        .catch((inspectionError) => ({
          inspectionError: String(inspectionError).slice(0, 500),
        }))
    : { pageCreated: false };
  console.error(error instanceof Error ? error.stack : String(error));
  console.error(
    `[browser-diagnostics] ${JSON.stringify({
      stage,
      viteExitCode: vite.exitCode,
      viteSignal: vite.signalCode,
      serverOutput: serverOutput.slice(-6000),
      pageErrors: pageErrors.slice(-8),
      consoleErrors: consoleErrors.slice(-8),
      failedRequests: failedRequests.slice(-8),
      browserState,
    })}`,
  );
  process.exitCode = 1;
} finally {
  await rm(observerPath, { force: true });
  await browser?.close();
  if (vite.exitCode === null) {
    try {
      if (vite.pid && process.platform !== 'win32')
        process.kill(-vite.pid, 'SIGTERM');
      else vite.kill('SIGTERM');
    } catch {}
    await Promise.race([
      new Promise((resolve) => vite.once('close', resolve)),
      sleep(1_000),
    ]);
    if (vite.exitCode === null) {
      try {
        if (vite.pid && process.platform !== 'win32')
          process.kill(-vite.pid, 'SIGKILL');
        else vite.kill('SIGKILL');
      } catch {}
    }
  }
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) =>
    server.once('error', reject).listen(0, '127.0.0.1', resolve),
  );
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Could not reserve an ephemeral port');
  const port = address.port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}
async function waitForServer(url, child, output) {
  const deadline = Date.now() + 20_000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`Vite exited early (${child.exitCode}): ${output()}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw new Error(
    `Vite failed to become ready: ${String(lastError)} ${output()}`,
  );
}
