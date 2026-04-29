export interface GoogleCredentials {
  client_email: string;
  private_key: string;
  project_id?: string;
}

export function parseGoogleCredentialsJSON(
  credentialsJSON?: string,
): GoogleCredentials | undefined {
  if (!credentialsJSON) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(credentialsJSON);
  } catch (error) {
    throw new Error(
      `Invalid Google credentials JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('client_email' in parsed) ||
    typeof parsed.client_email !== 'string' ||
    !('private_key' in parsed) ||
    typeof parsed.private_key !== 'string'
  ) {
    throw new Error(
      'Invalid Google credentials JSON: expected client_email and private_key string fields',
    );
  }

  return {
    client_email: parsed.client_email,
    private_key: parsed.private_key,
    project_id:
      'project_id' in parsed && typeof parsed.project_id === 'string'
        ? parsed.project_id
        : undefined,
  };
}
