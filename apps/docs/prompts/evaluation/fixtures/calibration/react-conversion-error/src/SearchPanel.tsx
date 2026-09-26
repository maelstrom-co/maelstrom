import { type FormEvent, useState } from 'react';
import { type SearchResult, searchTickets } from './search';
export function SearchPanel() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [pending, setPending] = useState(false);
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setResults(await searchTickets(query));
    setPending(false);
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
      {results && <p role="status">{results.length} results</p>}
    </form>
  );
}
