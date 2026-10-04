export function App() {
  return (
    <main style={{ height: 600 }}>
      <h1>Support workspace</h1>
      <p>Review the open support queue.</p>
      <div
        className="support-chart"
        style={{ position: 'relative', height: 480 }}
      >
        <div data-instance-id="queue-main" style={{ height: 480 }}>
          <ul aria-label="Support ticket queue">
            <li>Cannot update billing address — Open</li>
            <li>Export is missing a column — Waiting</li>
          </ul>
        </div>
      </div>
    </main>
  );
}
