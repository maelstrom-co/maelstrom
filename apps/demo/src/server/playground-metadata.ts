export interface PlaygroundMetadata {
  readonly type: 'playground.metadata';
  readonly engineModel: string;
  readonly source: 'server-configuration';
}

export function parsePlaygroundMetadata(
  raw: string,
): PlaygroundMetadata | undefined {
  if (raw.length > 2048) return;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value !== 'object' ||
      value === null ||
      !('type' in value) ||
      value.type !== 'playground.metadata' ||
      !('source' in value) ||
      value.source !== 'server-configuration' ||
      !('engineModel' in value) ||
      typeof value.engineModel !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(value.engineModel)
    )
      return;
    return {
      type: 'playground.metadata',
      engineModel: value.engineModel,
      source: value.source,
    };
  } catch {
    return;
  }
}
