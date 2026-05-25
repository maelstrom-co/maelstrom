const MEDS: [string, string][] = [
  ['Metformin', '500 mg · Twice daily'],
  ['Lisinopril', '10 mg · Daily'],
  ['Vitamin D', '1000 IU · Morning'],
];

export default function MedicationsComponent() {
  return (
    <div className="vessel">
      <div className="vessel-head">
        <span className="vessel-title">MEDICATIONS</span>
        <span className="badge">3 ACTIVE</span>
      </div>
      <div
        style={{
          display: 'grid',
          gap: 8,
          marginTop: 14,
          gridTemplateColumns: '1fr',
        }}
      >
        {MEDS.map(([name, info]) => (
          <div
            key={name}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              padding: '8px 0',
              borderBottom: '1px solid var(--line)',
            }}
          >
            <span style={{ fontSize: 14, color: 'var(--text)' }}>{name}</span>
            <span
              style={{
                fontSize: 11,
                color: 'var(--text-2)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {info}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
