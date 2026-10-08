// PROTOTYPE (MAE-825): throwaway agent loop, never merge.
import { useAgentSessionClient } from '../lib/agent-session-client';

/** Progress strip for the running Agent Session turn plus a metrics debug panel. */
export function AgentSessionPanel() {
  const { active, progress, reply, error, metrics } = useAgentSessionClient();
  const latest = progress.slice(-3);

  return (
    <div
      className="mx-auto mb-2 max-w-4xl text-sm"
      data-testid="agent-session-panel"
    >
      {active && (
        <ol className="flex flex-col gap-0.5 text-ink-2" aria-live="polite">
          {latest.map((entry, index) => (
            <li
              key={`${progress.length - latest.length + index}`}
              className={
                index === latest.length - 1 ? 'text-ink-1' : 'opacity-60'
              }
            >
              {entry.tool ? (
                <span className="mr-2 font-mono text-xs uppercase tracking-[.1em] text-ink-3">
                  {entry.tool}
                </span>
              ) : null}
              {entry.text}
            </li>
          ))}
          {latest.length === 0 && <li>Sending…</li>}
        </ol>
      )}
      {!active && reply && <p className="text-ink-1">{reply}</p>}
      {error && <p className="text-pink">Agent error: {error}</p>}
      {metrics && (
        <details className="mt-1 text-xs text-ink-3">
          <summary className="cursor-pointer">
            Agent metrics: {metrics.route}, first UI{' '}
            {formatMs(metrics.firstUiMs)}, total {formatMs(metrics.totalMs)}
          </summary>
          <ul className="mt-1 font-mono">
            <li>router: {formatMs(metrics.routerMs)}</li>
            <li>model turns: {metrics.modelTurns}</li>
            {metrics.plannerCalls.map((call, index) => (
              <li key={`planner-${index}-${call.name}`}>
                planner: {formatMs(call.ms)} ({call.name})
              </li>
            ))}
            {metrics.toolCalls.map((call, index) => (
              <li key={`tool-${index}-${call.name}`}>
                tool {call.name}: {formatMs(call.ms)}
              </li>
            ))}
            {(metrics.timeline ?? []).map((entry, index) => (
              <li key={`timeline-${index}-${entry.event}`}>
                +{entry.atMs}ms {entry.event} {entry.detail ?? ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function formatMs(ms: number | null): string {
  return ms === null ? 'n/a' : `${(ms / 1000).toFixed(2)}s`;
}
