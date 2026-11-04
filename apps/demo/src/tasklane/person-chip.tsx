import { cn } from '../lib/cn';
import { assigneeLabel } from './stores/project-tasks.store';
import type { TeamMemberId } from './stores/team';

/** Names an owner in that person's colour. `null` renders a neutral "unassigned". */
export function PersonChip({
  memberId,
  className,
}: {
  readonly memberId: TeamMemberId | null;
  readonly className?: string;
}) {
  return (
    <span
      className={cn('tasklane-person', className)}
      data-person={memberId ?? 'unassigned'}
    >
      {assigneeLabel(memberId)}
    </span>
  );
}
