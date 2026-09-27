import type { ChartRequestMessage } from '@maelstrom-co/protocol';

export function browserCalendarContext(
  now = new Date(),
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (name: string) =>
    parts.find((value) => value.type === name)?.value;
  return {
    localDate: `${part('year')}-${part('month')}-${part('day')}`,
    timeZone,
    observedAt: now.toISOString(),
  };
}

export function withBrowserCalendarContext(
  message: ChartRequestMessage,
  calendar = browserCalendarContext(),
): ChartRequestMessage {
  if (
    !message.request.context.updateReasons.some(
      (reason) => reason.type === 'user_intent' && reason.intent.trim(),
    )
  )
    return message;
  return {
    ...message,
    request: {
      ...message.request,
      context: {
        ...message.request.context,
        updateReasons: message.request.context.updateReasons.map((reason) =>
          reason.type === 'user_intent' && reason.intent.trim()
            ? {
                ...reason,
                intent: `${reason.intent}\n\nBrowser calendar context for this request: ${JSON.stringify(calendar)}`,
              }
            : reason,
        ),
      },
    },
  };
}
