const tickets = [
  { id: 'T-104', subject: 'Cannot update billing address', status: 'Open' },
  { id: 'T-105', subject: 'Export is missing a column', status: 'Waiting' },
];

export function App() {
  return (
    <main>
      <h1>Support workspace</h1>
      <p>Review the open support queue.</p>
      <ul>
        {tickets.map((ticket) => (
          <li key={ticket.id}>
            <strong>{ticket.subject}</strong> — {ticket.status}
          </li>
        ))}
      </ul>
    </main>
  );
}
