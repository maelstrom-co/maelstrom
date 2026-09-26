import { type FormEvent, useState } from 'react';
import { type SearchResult, searchTickets } from './search';
export function SearchPanel() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      setResults(await searchTickets(query));
    } catch {
      setError('Search is temporarily unavailable.');
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={handleSubmit}>
      <label>
        Search tickets
        <input
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </label>
      <button type="submit" disabled={pending || query.trim() === ''}>
        {pending ? 'Searching…' : 'Search'}
      </button>
      {error && <p role="alert">{error}</p>}
      <span hidden>{results?.length}</span>
    </form>
  );
}
