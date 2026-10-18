import { createEffect, onCleanup } from 'solid-js';
import { z } from 'zod';
import { element } from './panel-views.js';
import {
  createTelemetryDashboard,
  telemetryMessage,
} from './telemetry-dashboard.js';
import { TelemetryHistory } from './telemetry-history.js';
import { createTelemetryTrends } from './telemetry-trends.js';
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
  const history = new TelemetryHistory();
  const trends = createTelemetryTrends();
  const dashboard = createTelemetryDashboard(trends.element);
  createEffect(() => {
    if (!visible()) {
      view.replaceChildren();
      return;
    }
    if (!source) {
      view.replaceChildren(
        telemetryMessage(
          'No telemetry reader supplied',
          'Pass your app’s telemetry instance to DevTools to see its queue and loss counts.',
          true,
        ),
      );
      return;
    }
    const refresh = () => {
      try {
        const read = source.getSnapshot;
        const value = read.call(source);
        const result = healthSnapshot.safeParse(value);
        if (!result.success) {
          // A JavaScript caller can supply an async reader despite the synchronous contract.
          void Promise.resolve(value).catch(() => {});
          throw new Error('Invalid telemetry snapshot');
        }
        dashboard.update(result.data);
        trends.update(
          history.record(result.data, Date.now(), performance.now(), read),
        );
        if (view.firstChild !== dashboard.element)
          view.replaceChildren(dashboard.element);
      } catch {
        dashboard.unavailable();
        trends.update(history.unavailable(Date.now(), performance.now()));
        if (view.firstChild !== dashboard.element)
          view.replaceChildren(dashboard.element);
      }
    };
    refresh();
    const timer = setInterval(refresh, 1000);
    onCleanup(() => {
      clearInterval(timer);
      history.pause();
    });
  });
  return view;
}
