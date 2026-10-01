export type SearchResult = { id: string; subject: string };

export async function searchTickets(query: string): Promise<SearchResult[]> {
  if (query.trim() === '') throw new Error('Search query must not be empty');
  // In this fixture, the real network boundary is intentionally stubbed.
  return Promise.resolve([{ id: 'T-104', subject: `Result for ${query}` }]);
}
