import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

interface TasklaneCardProps {
  readonly title: string;
  readonly meta?: string;
  readonly children: ReactNode;
  readonly className?: string;
}

export function TasklaneCard({
  title,
  meta,
  children,
  className,
}: TasklaneCardProps) {
  return (
    <div className={cn('tasklane-surface tasklane-vessel h-full', className)}>
      <div className="tasklane-vessel-heading">
        <h2 className="tasklane-vessel-title">{title}</h2>
        {meta && <span className="tasklane-vessel-meta">{meta}</span>}
      </div>
      {children}
    </div>
  );
}
