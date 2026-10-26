import type { ReactNode } from 'react';

interface MailCardProps {
  readonly title: string;
  readonly meta?: ReactNode;
  readonly children: ReactNode;
}

export function MailCard({ title, meta, children }: MailCardProps) {
  return (
    <section className="mail-card" aria-label={title}>
      <header className="mail-card-header">
        <h2 className="mail-card-title">{title}</h2>
        {meta !== undefined ? (
          <span className="mail-card-meta">{meta}</span>
        ) : null}
      </header>
      <div className="mail-card-body">{children}</div>
    </section>
  );
}

interface MailToggleProps {
  readonly label: string;
  readonly hint?: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}

export function MailToggle({
  label,
  hint,
  checked,
  onChange,
}: MailToggleProps) {
  return (
    <div className="mail-setting-row">
      <span className="mail-setting-label">
        <span>{label}</span>
        {hint ? <span className="mail-muted">{hint}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className="mail-switch"
        onClick={() => onChange(!checked)}
      />
    </div>
  );
}

export function MailCardSkeleton({ title }: { readonly title: string }) {
  return (
    <MailCard title={title} meta="Loading">
      <div className="mail-progress" />
      <div className="mail-progress" />
    </MailCard>
  );
}
