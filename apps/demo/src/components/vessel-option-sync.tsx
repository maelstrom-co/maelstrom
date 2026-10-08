import {
  MAX_CAPABILITY_OPTION_COUNT,
  MAX_CAPABILITY_OPTIONS_TOTAL_CHARS,
} from '@maelstrom-co/client';
import type { UpdateVesselResult } from '@maelstrom-co/react';
import { useEffect } from 'react';
import { m } from '../lib/maelstrom';
import { withActionOptions } from '../lib/vessel-options';
import { useCalendarStore } from '../vessels/calendar.store';
import { calendarVessel } from '../vessels/calendar.vessel';
import { useCartStore } from '../vessels/cart.store';
import { cartVessel } from '../vessels/cart.vessel';
import { useJournalStore } from '../vessels/journal.store';
import { journalVessel } from '../vessels/journal.vessel';
import { useOrdersStore } from '../vessels/orders.store';
import { ordersVessel } from '../vessels/orders.vessel';
import { useTasksStore } from '../vessels/tasks.store';
import { tasksVessel } from '../vessels/tasks.vessel';

// The two caps are imported rather than a local copy of the same numbers:
// the package (packages/client/src/lib/voice-session/capability-snapshot.ts)
// applies these same two limits when it projects a vessel's `enum` into
// voice `options`, dropping the parameter's options entirely
// (`optionsOmitted: true`) if either is exceeded. A hardcoded copy here
// would silently drift from the package's actual limits the moment either
// one changes.
//
// Generous for a demo: real usage tops out at a handful of seeded items per
// list, so these are headroom, not a realistic ceiling. They exist to bound
// prompt size (400 tasks would otherwise pay the full title list four times
// per request — removeTask, checkTask, uncheckTask, addSubtask) rather than
// to reflect any expected task count.

// A blank or duplicate title would otherwise flow straight into `enum`
// verbatim — two tasks named "Ship it" would serialize as
// `title: Ship it|Ship it`, wasting prompt budget without narrowing the
// engine's choice, and an empty string can never be a valid fuzzy-match
// target for the removeTask/checkTask/etc. runners.
//
// `label` identifies the option list in a dropped-title warning (e.g.
// 'tasks') so a truncation or a rejected title is traceable back to its
// source instead of surfacing only as "the assistant invents titles".
export function cleanTitles(
  titles: readonly string[],
  label: string,
): string[] {
  const safe = titles.filter(
    (title) => title.trim().length > 0 && !UNSAFE_TITLE_CHARS.test(title),
  );
  if (safe.length < titles.length) {
    console.warn(
      `[vessel-option-sync] ${label}: dropped ${titles.length - safe.length} title(s) containing a blank or unsafe character`,
    );
  }

  // Dedup is expected (two tasks can share a title) rather than a defect, so
  // it stays silent — only the rejection above and the cap/budget
  // truncations below warn.
  let result = [...new Set(safe)];

  if (result.length > MAX_CAPABILITY_OPTION_COUNT) {
    const dropped = result.length - MAX_CAPABILITY_OPTION_COUNT;
    console.warn(
      `[vessel-option-sync] ${label}: dropping ${dropped} of ${result.length} titles to stay under the ${MAX_CAPABILITY_OPTION_COUNT}-option cap`,
    );
    result = result.slice(0, MAX_CAPABILITY_OPTION_COUNT);
  }

  const totalChars = result.reduce((sum, title) => sum + title.length, 0);
  if (totalChars > MAX_CAPABILITY_OPTIONS_TOTAL_CHARS) {
    const fitted: string[] = [];
    let runningChars = 0;
    // Prefix truncation is deliberate: the first title that doesn't fit the
    // remaining budget ends the list rather than being skipped over, so the
    // published `enum` is always a prefix of the store's own order. The
    // trade-off is starvation — one near-budget title discards every shorter
    // one behind it — accepted so the published list never silently reorders
    // or holes out relative to what the user sees on screen.
    for (const title of result) {
      if (runningChars + title.length > MAX_CAPABILITY_OPTIONS_TOTAL_CHARS)
        break;
      fitted.push(title);
      runningChars += title.length;
    }
    console.warn(
      `[vessel-option-sync] ${label}: dropping ${result.length - fitted.length} of ${result.length} titles to stay under the ${MAX_CAPABILITY_OPTIONS_TOTAL_CHARS}-character budget`,
    );
    result = fitted;
  }

  // An empty result from a non-empty input is always a defect — every title
  // was blank/unsafe, or the first one alone blew the character budget. It
  // publishes identically to the ordinary empty-store case: `withActionOptions`
  // omits `enum` for an empty list, so every parameter fed from this list
  // loses its constraint and the engine goes back to inventing values. The
  // per-drop warnings above don't name that consequence, so this does.
  if (titles.length > 0 && result.length === 0) {
    console.warn(
      `[vessel-option-sync] ${label}: no titles survived cleaning — the parameter keeps no enum and the engine will invent values`,
    );
  }

  return result;
}

/**
 * Renders nothing. Keeps the option lists the engine and the voice model
 * choose from in step with what the demo's stores actually hold, so
 * `openEntry`, `removeEvent` and `checkTask` name real things instead of
 * relying on the runners' fuzzy fallback.
 */
export function VesselOptionSync() {
  const { entries } = useJournalStore();
  const { events } = useCalendarStore();
  const { tasks } = useTasksStore();
  const { orders } = useOrdersStore();
  const { lines } = useCartStore();
  // A republish refused with `batch_in_flight` exhausts its bounded backoff
  // in ~3.1s and is then abandoned — the title keys that would re-trigger the
  // effect have already changed and settled, so nothing re-attempts it and
  // the engine keeps reading the pre-mutation list until the user happens to
  // rename something. Keying the effects on this flag too means a settled
  // engine round-trip re-runs them, which is the point at which the command
  // batch that caused the refusal has drained.
  const isProcessing = m.useMaelstrom((s) => s.isProcessing);

  const entryTitles = cleanTitles(
    entries.map((entry) => entry.title),
    'journal',
  );
  const eventTitles = cleanTitles(
    events.map((event) => event.title),
    'calendar',
  );
  const taskTitles = cleanTitles(
    tasks.map((task) => task.title),
    'tasks',
  );

  const entryKey = optionKey(entryTitles);
  const eventKey = optionKey(eventTitles);
  const orderIds = cleanTitles(
    orders.map((order) => order.id),
    'orders',
  );
  const cartSkus = cleanTitles(
    lines.map((line) => line.sku),
    'cart',
  );

  const taskKey = optionKey(taskTitles);
  const orderKey = optionKey(orderIds);
  const cartKey = optionKey(cartSkus);

  useEffect(
    () =>
      republishWithRetry(() =>
        m.updateVessel(
          withActionOptions(journalVessel, {
            openEntry: { title: entryTitles },
          }),
        ),
      ),
    [entryKey, isProcessing],
  );

  useEffect(
    () =>
      republishWithRetry(() =>
        m.updateVessel(
          withActionOptions(calendarVessel, {
            removeEvent: { title: eventTitles },
            moveEvent: { title: eventTitles },
          }),
        ),
      ),
    [eventKey, isProcessing],
  );

  useEffect(
    () =>
      republishWithRetry(() =>
        m.updateVessel(
          withActionOptions(tasksVessel, {
            removeTask: { title: taskTitles },
            checkTask: { title: taskTitles },
            uncheckTask: { title: taskTitles },
            addSubtask: { taskTitle: taskTitles },
          }),
        ),
      ),
    [taskKey, isProcessing],
  );

  useEffect(
    () =>
      republishWithRetry(() =>
        m.updateVessel(
          withActionOptions(ordersVessel, {
            showOrderDetails: { orderId: orderIds },
          }),
        ),
      ),
    [orderKey, isProcessing],
  );

  // An empty cart publishes no enum, so the model still sees an
  // unconstrained sku rather than an impossible empty choice.
  useEffect(
    () =>
      republishWithRetry(() =>
        m.updateVessel(
          withActionOptions(cartVessel, {
            removeFromCart: { sku: cartSkus },
            updateCartQuantity: { sku: cartSkus },
          }),
        ),
      ),
    [cartKey, isProcessing],
  );

  return null;
}

// Serialized into a single scalar so the effects re-run on a changed *list*,
// not on a new array identity — journal writeContent replaces the entries
// array on every dictated word without touching a single title. Titles are
// free-form (LLM- or voice-transcript-produced), so any in-band delimiter
// (e.g. join('\n')) can collide — ['a\nb'] and ['a', 'b'] would flatten to
// the same key and silently skip a republish. JSON.stringify escapes
// embedded delimiters, so distinct lists always produce distinct keys.
function optionKey(values: readonly string[]): string {
  return JSON.stringify(values);
}

// A title containing the engine prompt's option delimiter ('|'), a
// newline/CR, or another control character must never reach `enum` even
// though the engine serializer escapes these itself (packages/engine's
// request-serializer.ts) — this is defence in depth from a component that
// has no visibility into how the engine renders its output, not the primary
// fix.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point — a title containing one must be rejected.
const UNSAFE_TITLE_CHARS = /[|\r\n\x00-\x1f\x7f]/;

// `'batch_in_flight'` fires whenever a command batch is queued or executing
// when the republish is attempted — the common case, since the engine
// executing an action is exactly what mutates these stores in the first
// place. It is transient: retrying later with the same payload succeeds
// once the batch settles. `useMaelstrom().isProcessing` tracks the
// *request* coordinator (whether an engine round-trip is in flight), which
// is a different signal from the command-processor idle event this actually
// depends on (`orchestrator.onSettled` / `commandProcessor.waitForIdle()`),
// and that one is not part of the public React API surface
// (`MaelstromInstanceCore`) — so `isProcessing` is used as the coarse
// re-trigger on the effect deps, and this short bounded backoff covers the
// window inside a single settled round-trip.
const MAX_BATCH_IN_FLIGHT_RETRIES = 5;
const RETRY_BASE_DELAY_MS = 100;

/**
 * Calls `publish` and, while it is refused with `'batch_in_flight'`, retries
 * on a bounded exponential backoff until it succeeds or the retry ceiling is
 * hit. `'variant_dropped'` / `'action_dropped'` are not retried — the input
 * that produced them hasn't changed, so retrying would loop forever — and
 * are logged once instead.
 *
 * Returns a cleanup function that cancels any pending retry; call it from
 * the owning effect's cleanup so an unmount or a dep-key change (a new call
 * to this function for the same vessel) never lets a stale retry chain fire
 * after the fact.
 */
function republishWithRetry(publish: () => UpdateVesselResult): () => void {
  let cancelled = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const attempt = (retryCount: number) => {
    if (cancelled) return;
    const result = publish();
    if (result.ok) return;

    const { conflict } = result;
    if (conflict.code !== 'batch_in_flight') {
      console.warn(
        `[vessel-option-sync] ${conflict.vesselId}: republish refused (${conflict.code}), not retrying — ${conflict.message}`,
      );
      return;
    }

    if (retryCount >= MAX_BATCH_IN_FLIGHT_RETRIES) {
      console.warn(
        `[vessel-option-sync] ${conflict.vesselId}: gave up republishing after ${MAX_BATCH_IN_FLIGHT_RETRIES} retries — a command batch stayed in flight the whole time.`,
      );
      return;
    }

    const delayMs = RETRY_BASE_DELAY_MS * 2 ** retryCount;
    timeoutId = setTimeout(() => attempt(retryCount + 1), delayMs);
  };

  attempt(0);

  return () => {
    cancelled = true;
    clearTimeout(timeoutId);
  };
}
