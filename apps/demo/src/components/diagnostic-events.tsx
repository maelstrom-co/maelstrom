import { useMemo, useState } from 'react';

export function DiagnosticEvents({
  events,
  label,
}: {
  events: readonly object[];
  label: string;
}) {
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(25);
  const matches = useMemo(
    () =>
      events
        .map((value, index) => ({
          value: value as Record<string, unknown>,
          index,
          json: JSON.stringify(value, null, 2),
        }))
        .filter(({ json }) => json.toLowerCase().includes(query.toLowerCase()))
        .reverse(),
    [events, query],
  );
  return (
    <div className="debug-events">
      <label className="debug-label">
        Search {label.toLowerCase()}
        <input
          type="search"
          value={query}
          placeholder="Event, request ID, or status…"
          onChange={(event) => {
            setQuery(event.target.value);
            setLimit(25);
          }}
        />
      </label>
      <p className="debug-help">
        {matches.length} of {events.length} events · newest first
      </p>
      {matches.length === 0 ? (
        <div className="debug-empty">
          {events.length
            ? 'No matching events. Try a different search.'
            : 'No events yet. Activity will appear here as you use the playground.'}
        </div>
      ) : (
        <ol className="debug-event-list" aria-label={label}>
          {matches.slice(0, limit).map(({ value, index, json }) => (
            <li
              key={
                typeof value.entryId === 'string'
                  ? value.entryId
                  : `${String(value.at)}-${index}`
              }
            >
              <details className="debug-event">
                <summary>
                  <span className="debug-event-time">
                    {typeof value.elapsedMs === 'number'
                      ? `+${(value.elapsedMs / 1000).toFixed(2)}s`
                      : typeof value.at === 'number'
                        ? new Date(value.at).toLocaleTimeString()
                        : '—'}
                  </span>
                  <span className="debug-event-name">
                    {String(value.kind ?? 'event').replaceAll('_', ' ')}
                    <small>
                      {String(
                        value.tool ??
                          value.eventType ??
                          value.state ??
                          value.type ??
                          '',
                      )}
                    </small>
                  </span>
                  {value.ok === false ||
                  String(value.kind).endsWith('_error') ? (
                    <span className="debug-badge debug-badge-error">
                      {String(value.kind).endsWith('_error')
                        ? 'Error reported'
                        : 'Not confirmed'}
                    </span>
                  ) : typeof value.durationMs === 'number' ? (
                    <span className="debug-badge">
                      {(value.durationMs / 1000).toFixed(2)}s
                    </span>
                  ) : null}
                </summary>
                <pre>{json}</pre>
              </details>
            </li>
          ))}
        </ol>
      )}
      {matches.length > limit && (
        <button
          type="button"
          className="debug-button"
          onClick={() => setLimit(limit + 25)}
        >
          Show 25 more
        </button>
      )}
    </div>
  );
}
