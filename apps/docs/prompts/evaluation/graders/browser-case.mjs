import { createServer } from 'node:net';
import { chromium } from '@playwright/test';
import { createLogger, createServer as createViteServer } from 'vite';

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
const port = await freePort();
let serverOutput = '';
const logger = createLogger('silent');
for (const level of ['info', 'warn', 'error'])
  logger[level] = (message) => {
    serverOutput = `${serverOutput}\n${message}`.slice(-6000);
  };
const observerId = '\0virtual:maelstrom-evaluation-observer';
const observerUrl = '/@id/__x00__virtual:maelstrom-evaluation-observer';
let vite;
let browser;
let page;
let stage = 'wait-vite-server';
const pageErrors = [];
const consoleErrors = [];
const failedRequests = [];
try {
  vite = await createViteServer({
    root: candidateRoot,
    customLogger: logger,
    server: { host: '127.0.0.1', port, strictPort: true },
    // Prebundle both entrypoints together so the observer shares the app's SDK.
    optimizeDeps: { include: ['@maelstrom-co/client'] },
    plugins: [
      {
        name: 'maelstrom-evaluation-observer',
        resolveId(id) {
          if (
            id === observerId ||
            id === 'virtual:maelstrom-evaluation-observer'
          )
            return observerId;
        },
        load(id) {
          if (id !== observerId) return;
          return `import { Orchestrator } from '@maelstrom-co/client';
const evaluatorWindow = window;
evaluatorWindow.__maelstromEvaluatorSdk ??= [];
const originalConnect = Orchestrator.prototype.connect;
Orchestrator.prototype.connect = function (...args) {
  const state = this.commandProcessor.store.state;
  evaluatorWindow.__maelstromEvaluatorSdk.push({ vesselIds: this.vesselManager.getAll().map((vessel) => vessel.id), instances: Array.from(state.instances, ([instanceId, instance]) => ({ instanceId, vesselId: instance.vesselId })), layout: state.layout });
  return originalConnect.apply(this, args);
};`;
        },
        transformIndexHtml: {
          order: 'pre',
          handler(html) {
            const entry = '<script type="module" src="/src/main.tsx"></script>';
            if (!html.includes(entry))
              throw new Error(
                'Could not find fixture app entry in served index.html',
              );
            return html.replace(
              entry,
              `<script type="module" src="${observerUrl}"></script>${entry}`,
            );
          },
        },
      },
    ],
  });
  await vite.listen();
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
    undefined,
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
    undefined,
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
          const row = rows.nth(index);
          const rowBox = await row.boundingBox();
          if (
            !(await row.isVisible()) ||
            !rowBox ||
            rowBox.width <= 0 ||
            rowBox.height <= 0
          )
            throw new Error(`ticket row ${index + 1} is not visibly rendered`);
          if ((await row.innerText()).trim() !== expectedRow)
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
  if (failedRequests.length)
    throw new Error(
      `Browser app had failed requests: ${failedRequests.map(({ url, failure }) => `${url}: ${failure ?? 'unknown failure'}`).join('; ')}`,
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
            script.src.includes('maelstrom-evaluation-observer'),
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
      serverListening: vite?.httpServer?.listening ?? false,
      serverOutput: serverOutput.slice(-6000),
      pageErrors: pageErrors.slice(-8),
      consoleErrors: consoleErrors.slice(-8),
      failedRequests: failedRequests.slice(-8),
      browserState,
    })}`,
  );
  process.exitCode = 1;
} finally {
  await browser?.close();
  await vite?.close();
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
