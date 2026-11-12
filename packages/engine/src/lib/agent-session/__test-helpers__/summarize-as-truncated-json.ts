const SUMMARY_LIMIT = 200;

/** Summarizer for test doubles: the output as JSON, cut to 200 characters with an ellipsis. */
export function summarizeAsTruncatedJson(output: unknown): string {
  const json = JSON.stringify(output) ?? String(output);
  return json.length > SUMMARY_LIMIT
    ? `${json.slice(0, SUMMARY_LIMIT - 1)}…`
    : json;
}
