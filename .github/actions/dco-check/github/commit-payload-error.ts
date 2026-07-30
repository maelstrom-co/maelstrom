export class CommitPayloadError extends Error {
  constructor(problem: string, sha?: string) {
    super(
      sha === undefined
        ? `malformed commit payload: ${problem}`
        : `malformed commit payload for ${sha}: ${problem}`,
    );
    this.name = 'CommitPayloadError';
  }
}
