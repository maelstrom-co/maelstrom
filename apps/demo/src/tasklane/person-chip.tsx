import { cn } from '../lib/cn';
import { assigneeLabel, type ProjectTask } from './stores/project-tasks.store';
import { TEAM, type TeamMemberId, UNASSIGNED } from './stores/team';

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

/** Picks a task's owner from the team, or Unassigned, in that person's colour. */
export function AssigneeSelect({
  task,
  label,
  className,
  onAssign,
}: {
  readonly task: ProjectTask;
  readonly label: string;
  readonly className?: string;
  readonly onAssign: (assignee: string) => void;
}) {
  return (
    <select
      className={cn('tasklane-select', className)}
      aria-label={label}
      data-person={task.assigneeId ?? UNASSIGNED}
      value={task.assigneeId ?? UNASSIGNED}
      onChange={(event) => onAssign(event.target.value)}
    >
      {TEAM.map((member) => (
        <option key={member.id} value={member.id}>
          {member.name}
        </option>
      ))}
      <option value={UNASSIGNED}>Unassigned</option>
    </select>
  );
}
