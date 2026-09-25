import { useState } from 'react';

const tickets = [
  { id: 'T-104', subject: 'Cannot update billing address', status: 'Open' },
  { id: 'T-105', subject: 'Export is missing a column', status: 'Waiting' },
];

export function Queue() {
  const [query, setQuery] = useState('');
  const visibleTickets = tickets.filter((ticket) =>
    ticket.subject.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <section aria-label="Support queue">
      <label>
        Search tickets
        <input
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </label>
      <button type="button" onClick={() => setQuery('')}>
        Reset
      </button>
      {visibleTickets.length === 0 ? (
        <p role="status">No matching tickets</p>
      ) : (
        <ul>
          {visibleTickets.map((ticket) => (
            <li key={ticket.id}>
              <strong>{ticket.subject}</strong> — {ticket.status}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
