import {
  decodeClientEnvelope,
  encodeEnvelope,
  InstanceId,
  isOk,
  MaelstromResponseMessage,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';
import { expect, test } from '@playwright/test';
import { DEMO_LOCATIONS, HOME } from '../src/lib/locations';

test('loads the map and its bundled worker under hosted CSP', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(() => {
    const requestFrame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) =>
      requestFrame((time) => {
        callback(time);
        const canvas =
          document.querySelector<HTMLCanvasElement>('.maplibregl-canvas');
        if (!canvas || canvas.dataset.fixtureRendered === 'true') return;
        const gl = canvas.getContext('webgl2');
        if (!gl) return;
        // Read before compositing clears MapLibre's non-preserved framebuffer.
        const pixels = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(
          0,
          0,
          canvas.width,
          canvas.height,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          pixels,
        );
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i] > 240 && pixels[i + 1] < 15 && pixels[i + 2] > 240) {
            canvas.dataset.fixtureRendered = 'true';
            break;
          }
        }
      });
  });
  await page.route('https://tiles.openfreemap.org/styles/dark', (route) =>
    route.fulfill({
      json: {
        version: 8,
        sources: {
          places: {
            type: 'geojson',
            data: {
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'Point',
                coordinates: [HOME.lng, HOME.lat],
              },
            },
          },
        },
        layers: [
          { id: 'background', type: 'background' },
          {
            id: 'places',
            type: 'circle',
            source: 'places',
            paint: { 'circle-color': '#ff00ff', 'circle-radius': 30 },
          },
        ],
      },
    }),
  );
  await page.routeWebSocket('**/ws?*', (socket) => {
    socket.onMessage((raw) => {
      const frame = decodeClientEnvelope(raw);
      if (!isOk(frame) || frame.value.type !== 'chart_request') return;
      const request = frame.value;
      socket.send(
        encodeEnvelope(
          MaelstromResponseMessage({
            requestId: request.id,
            sessionId: request.sessionId,
            response: {
              type: 'maelstrom_response',
              requestId: request.id,
              userMessage: '',
              rationale: '',
              executionPlan: [],
              layout: {
                type: 'tiling',
                tree: ['ID:map-test'],
                instances: [
                  {
                    instanceId: InstanceId('map-test'),
                    vesselId: VesselId('map'),
                    variant: VariantName('overview'),
                  },
                ],
              },
            },
          }),
        ),
      );
    });
  });
  const workerResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/assets/maplibre-gl-worker-') && response.ok(),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'API key' }).click();
  await page
    .getByRole('textbox', { name: 'API key' })
    .fill('sk-test-map-worker-not-a-real-key-1234567890');
  await page.getByRole('button', { name: 'Save' }).click();
  await page
    .getByPlaceholder('Tell Maelstrom what you want to arrange...')
    .fill('Show the map');
  await page
    .getByPlaceholder('Tell Maelstrom what you want to arrange...')
    .press('Enter');

  await workerResponse;
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  await expect(page.locator('.maplibregl-marker')).toHaveCount(
    DEMO_LOCATIONS.length,
  );
  await expect(page.locator('.maplibregl-canvas')).toHaveAttribute(
    'data-fixture-rendered',
    'true',
  );
  expect(errors).toEqual([]);
});
