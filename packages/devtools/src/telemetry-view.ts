import { createEffect, onCleanup } from 'solid-js';
import { z } from 'zod';
import { element } from './panel-views.js';
import {
  createTelemetryDashboard,
  telemetryMessage,
} from './telemetry-dashboard.js';
import type { DevtoolsOptions } from './types.js';

const count = z.number().int().nonnegative();
const healthSnapshot = z.object({
  state: z.enum(['active', 'disabled', 'timed_out', 'disposed']),
  accepted: count,
  delivered: count,
  queued: count,
  exporting: count,
  dropped: z.object({
    invalid: count,
    overflow: count,
    exportError: count,
    timeout: count,
    disabled: count,
    disposed: count,
  }),
});

export function telemetryView(
  source: DevtoolsOptions['telemetry'],
  visible: () => boolean,
): HTMLElement {
  const view = element('section', undefined, 'telemetry-view');
  view.setAttribute('aria-label', 'Telemetry delivery health');
  view.setAttribute('role', 'region');
  view.tabIndex = 0;
  createEffect(() => {
    if (!visible()) {
      view.replaceChildren();
      return;
    }
    if (!source) {
      view.replaceChildren(
        telemetryMessage(
          'No telemetry reader supplied',
          'Connect your application-owned telemetry instance to inspect its delivery queue and loss counters.',
          true,
        ),
      );
      return;
    }
    const dashboard = createTelemetryDashboard();
    const refresh = () => {
      try {
        const value = source.getSnapshot();
        const result = healthSnapshot.safeParse(value);
        if (!result.success) {
          // A JavaScript caller can supply an async reader despite the synchronous contract.
          void Promise.resolve(value).catch(() => {});
          throw new Error('Invalid telemetry snapshot');
        }
        dashboard.update(result.data);
        if (view.firstChild !== dashboard.element)
          view.replaceChildren(dashboard.element);
      } catch {
        view.replaceChildren(
          telemetryMessage(
            'Telemetry health is unavailable',
            'The reader must return a synchronous telemetry snapshot. Retrying every second while this view is open.',
          ),
        );
      }
    };
    refresh();
    const timer = setInterval(refresh, 1000);
    onCleanup(() => clearInterval(timer));
  });
  return view;
}
