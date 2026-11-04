export type TeamMemberId = 'chris' | 'alex' | 'sam';

export interface TeamMember {
  readonly id: TeamMemberId;
  readonly name: string;
}

export const CURRENT_USER_ID: TeamMemberId = 'chris';

export const TEAM: readonly TeamMember[] = [
  { id: 'chris', name: 'Chris' },
  { id: 'alex', name: 'Alex' },
  { id: 'sam', name: 'Sam' },
];

export const TEAM_MEMBER_IDS: readonly TeamMemberId[] = TEAM.map(
  (member) => member.id,
);

export const UNASSIGNED = 'unassigned';

/** Team ids plus `unassigned`, the values an assignee parameter accepts. */
export const ASSIGNEE_CHOICES: readonly string[] = [
  ...TEAM_MEMBER_IDS,
  UNASSIGNED,
];

export function teamMember(id: TeamMemberId): TeamMember {
  const member = TEAM.find((candidate) => candidate.id === id);
  if (!member) throw new Error(`Unknown team member id ${id}`);
  return member;
}

/**
 * Resolves an assignee reference to a team id, `null` for unassigned, or
 * `undefined` when nothing matches. "me", "my" and "myself" mean the current
 * user.
 */
export function resolveAssignee(
  reference: string,
): TeamMemberId | null | undefined {
  const query = reference.trim().toLowerCase();
  if (query === UNASSIGNED || query === 'none' || query === 'nobody')
    return null;
  if (query === 'me' || query === 'my' || query === 'myself')
    return CURRENT_USER_ID;
  return TEAM.find(
    (member) => member.id === query || member.name.toLowerCase() === query,
  )?.id;
}

export function describeTeamChoices(): string {
  const members = TEAM.map((member) =>
    member.id === CURRENT_USER_ID
      ? `${member.id} (${member.name}, me)`
      : `${member.id} (${member.name})`,
  );
  return `${members.join(', ')}, or ${UNASSIGNED}`;
}
