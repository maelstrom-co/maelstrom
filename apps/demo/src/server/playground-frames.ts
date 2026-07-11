export interface PlaygroundHelloFrame {
  readonly type: 'playground.hello';
  readonly sessionId: string;
  readonly apiKey: string;
}

export function isPlaygroundHello(value: unknown): value is PlaygroundHelloFrame {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'playground.hello' &&
    typeof (value as { sessionId?: unknown }).sessionId === 'string' &&
    typeof (value as { apiKey?: unknown }).apiKey === 'string'
  );
}
