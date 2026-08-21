export function safeErrorMetadata(error: unknown): {
  name: string;
  code?: string;
} {
  const name = readStringProperty(error, 'name') ?? 'UnknownError';
  const code = readStringProperty(error, 'code');
  return { name, ...(code ? { code } : {}) };
}

function readStringProperty(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null || !(key in value)) {
    return undefined;
  }
  const property = Reflect.get(value, key);
  return typeof property === 'string' ? property : undefined;
}
