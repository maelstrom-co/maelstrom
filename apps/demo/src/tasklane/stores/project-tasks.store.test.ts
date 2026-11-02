import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetProjectTasksStoreForTests,
  describeTaskFailure,
  getProjectTasksSnapshot,
  projectTaskActions,
  rememberRequestReferences,
  resolveTaskReference,
  taskReferenceLabel,
} from './project-tasks.store';

beforeEach(() => {
  __resetProjectTasksStoreForTests();
});

describe('project tasks seed', () => {
  it('starts with two existing tasks on the Maelstrom demo project and no priorities', () => {
    const { project, tasks, myPriorities } = getProjectTasksSnapshot();
    expect(project).toBe('Maelstrom demo');
    expect(tasks).toEqual([
      expect.objectContaining({
        id: 'TL-1',
        title: 'Update demo README',
        assigneeId: 'alex',
        parentId: null,
        urgency: 'normal',
      }),
      expect.objectContaining({
        id: 'TL-2',
        title: 'Record launch video',
        assigneeId: 'sam',
        parentId: null,
        urgency: 'normal',
      }),
    ]);
    expect(myPriorities).toEqual([]);
  });
});

describe('createTask', () => {
  it('gives each task the next sequential id and sensible defaults', () => {
    const result = projectTaskActions.createTask({ title: 'Write demo copy' });
    expect(result).toMatchObject({
      ok: true,
      task: {
        id: 'TL-3',
        title: 'Write demo copy',
        description: '',
        parentId: null,
        assigneeId: null,
        urgency: 'normal',
      },
    });
    expect(projectTaskActions.createTask({ title: 'Second' })).toMatchObject({
      ok: true,
      task: { id: 'TL-4' },
    });
  });

  it('trims the title and refuses an empty one', () => {
    expect(projectTaskActions.createTask({ title: '   ' })).toEqual({
      ok: false,
      reason: 'empty_title',
    });
    expect(
      projectTaskActions.createTask({ title: '  Spaced  ' }),
    ).toMatchObject({ ok: true, task: { title: 'Spaced' } });
  });

  it('creates a parent and then a child under it by title within one sequence', () => {
    projectTaskActions.createTask({ title: 'Improve the demo' });
    const child = projectTaskActions.createTask({
      title: 'Write demo copy',
      parent: 'Improve the demo',
      assignee: 'me',
      urgency: 'high',
    });
    expect(child).toMatchObject({
      ok: true,
      task: { parentId: 'TL-3', assigneeId: 'chris', urgency: 'high' },
    });
  });

  it('refuses an unknown parent, assignee or urgency without creating anything', () => {
    expect(
      projectTaskActions.createTask({ title: 'A', parent: 'Nope' }),
    ).toMatchObject({ ok: false, reason: 'parent_not_found', query: 'Nope' });
    expect(
      projectTaskActions.createTask({ title: 'A', assignee: 'Robin' }),
    ).toMatchObject({ ok: false, reason: 'unknown_assignee', query: 'Robin' });
    expect(
      projectTaskActions.createTask({ title: 'A', urgency: 'urgent' }),
    ).toMatchObject({ ok: false, reason: 'unknown_urgency', query: 'urgent' });
    expect(getProjectTasksSnapshot().tasks).toHaveLength(2);
  });
});

describe('task references', () => {
  it('resolves an id, a published label or a fuzzy title', () => {
    expect(resolveTaskReference('TL-2')).toMatchObject({
      kind: 'found',
      task: { id: 'TL-2' },
    });
    expect(
      resolveTaskReference(
        'TL-1 Update demo README (Alex, normal, not in priorities)',
      ),
    ).toMatchObject({ kind: 'found', task: { id: 'TL-1' } });
    expect(resolveTaskReference('launch video')).toMatchObject({
      kind: 'found',
      task: { id: 'TL-2' },
    });
    expect(resolveTaskReference('update DEMO readme')).toMatchObject({
      kind: 'found',
      task: { id: 'TL-1' },
    });
  });

  it('reports an ambiguous title with its candidates', () => {
    projectTaskActions.createTask({ title: 'Demo copy for the home page' });
    projectTaskActions.createTask({ title: 'Demo copy for the docs' });
    expect(resolveTaskReference('demo copy')).toEqual({
      kind: 'ambiguous',
      candidates: ['TL-3', 'TL-4'],
    });
  });

  it('prefers an exact title over a fuzzy match', () => {
    projectTaskActions.createTask({ title: 'Demo' });
    projectTaskActions.createTask({ title: 'Demo polish' });
    expect(resolveTaskReference('demo')).toMatchObject({
      kind: 'found',
      task: { id: 'TL-3' },
    });
  });

  it('does not resolve an unknown id or a blank reference', () => {
    expect(resolveTaskReference('TL-99')).toEqual({ kind: 'not_found' });
    expect(resolveTaskReference('  ')).toEqual({ kind: 'not_found' });
  });

  it('labels a task with its id, title, assignee, urgency and priority place', () => {
    projectTaskActions.addToMyPriorities('TL-2');
    const [readme, video] = getProjectTasksSnapshot().tasks;
    expect(taskReferenceLabel(readme!)).toBe(
      'TL-1 Update demo README (Alex, normal, not in priorities)',
    );
    expect(taskReferenceLabel(video!)).toBe(
      'TL-2 Record launch video (Sam, normal, priority #1)',
    );
    const created = projectTaskActions.createTask({ title: 'Loose end' });
    if (!created.ok) throw new Error('expected a task');
    expect(taskReferenceLabel(created.task)).toBe(
      'TL-3 Loose end (unassigned, normal, not in priorities)',
    );
  });
});

describe('updateTask', () => {
  it('changes title and description and reports whether anything changed', () => {
    expect(
      projectTaskActions.updateTask('TL-1', {
        description: 'Explain the host app',
      }),
    ).toMatchObject({
      ok: true,
      changed: true,
      task: {
        title: 'Update demo README',
        description: 'Explain the host app',
      },
    });
    expect(
      projectTaskActions.updateTask('TL-1', {
        description: 'Explain the host app',
      }),
    ).toMatchObject({ ok: true, changed: false });
  });

  it('refuses an empty title and an unknown task', () => {
    expect(projectTaskActions.updateTask('TL-1', { title: ' ' })).toEqual({
      ok: false,
      reason: 'empty_title',
    });
    expect(
      projectTaskActions.updateTask('Ghost', { title: 'X' }),
    ).toMatchObject({ ok: false, reason: 'task_not_found', query: 'Ghost' });
  });
});

describe('hierarchy', () => {
  it('moves a task under a parent and back to the top level', () => {
    expect(projectTaskActions.setParent('TL-2', 'TL-1')).toMatchObject({
      ok: true,
      changed: true,
      task: { parentId: 'TL-1' },
    });
    expect(projectTaskActions.setParent('TL-2', 'none')).toMatchObject({
      ok: true,
      task: { parentId: null },
    });
  });

  it('refuses a task as its own parent and any cycle', () => {
    expect(projectTaskActions.setParent('TL-1', 'TL-1')).toMatchObject({
      ok: false,
      reason: 'cycle',
    });
    projectTaskActions.setParent('TL-2', 'TL-1');
    projectTaskActions.createTask({ title: 'Grandchild', parent: 'TL-2' });
    expect(projectTaskActions.setParent('TL-1', 'TL-3')).toMatchObject({
      ok: false,
      reason: 'cycle',
    });
    expect(getProjectTasksSnapshot().tasks[0]?.parentId).toBeNull();
  });

  it('re-parents children to the top level and drops the task from priorities when it is removed', () => {
    projectTaskActions.setParent('TL-2', 'TL-1');
    projectTaskActions.addToMyPriorities('TL-1');
    expect(projectTaskActions.removeTask('TL-1')).toMatchObject({
      ok: true,
      task: { id: 'TL-1' },
      reparentedChildren: 1,
    });
    const { tasks, myPriorities } = getProjectTasksSnapshot();
    expect(tasks.map((task) => task.id)).toEqual(['TL-2']);
    expect(tasks[0]?.parentId).toBeNull();
    expect(myPriorities).toEqual([]);
  });
});

describe('assignment, urgency and personal priorities', () => {
  it('assigns by team id, name or "me", and unassigns', () => {
    expect(projectTaskActions.assignTask('TL-1', 'me')).toMatchObject({
      ok: true,
      changed: true,
      task: { assigneeId: 'chris' },
    });
    expect(projectTaskActions.assignTask('TL-1', 'Sam')).toMatchObject({
      ok: true,
      task: { assigneeId: 'sam' },
    });
    expect(projectTaskActions.assignTask('TL-1', 'unassigned')).toMatchObject({
      ok: true,
      task: { assigneeId: null },
    });
    expect(projectTaskActions.assignTask('TL-1', 'robin')).toMatchObject({
      ok: false,
      reason: 'unknown_assignee',
    });
  });

  it('keeps urgency and personal priorities independent', () => {
    projectTaskActions.addToMyPriorities('TL-1');
    expect(getProjectTasksSnapshot().tasks[0]?.urgency).toBe('normal');
    projectTaskActions.setUrgency('TL-1', 'high');
    expect(getProjectTasksSnapshot().myPriorities).toEqual(['TL-1']);
    projectTaskActions.removeFromMyPriorities('TL-1');
    expect(getProjectTasksSnapshot().tasks[0]?.urgency).toBe('high');
  });

  it('appends to priorities, inserts at a 1-based position and moves an existing entry', () => {
    projectTaskActions.addToMyPriorities('TL-1');
    projectTaskActions.createTask({ title: 'Third' });
    projectTaskActions.addToMyPriorities('TL-3');
    expect(projectTaskActions.addToMyPriorities('TL-2', 1)).toMatchObject({
      ok: true,
      changed: true,
      position: 1,
    });
    expect(getProjectTasksSnapshot().myPriorities).toEqual([
      'TL-2',
      'TL-1',
      'TL-3',
    ]);
    expect(projectTaskActions.addToMyPriorities('TL-3', 2)).toMatchObject({
      ok: true,
      position: 2,
    });
    expect(getProjectTasksSnapshot().myPriorities).toEqual([
      'TL-2',
      'TL-3',
      'TL-1',
    ]);
    expect(projectTaskActions.addToMyPriorities('TL-3', 2)).toMatchObject({
      ok: true,
      changed: false,
    });
    expect(projectTaskActions.addToMyPriorities('TL-1', 99)).toMatchObject({
      ok: true,
      position: 3,
    });
  });

  it('refuses a position below 1 or not a whole number, and removing a task not in priorities', () => {
    expect(projectTaskActions.addToMyPriorities('TL-1', 0)).toMatchObject({
      ok: false,
      reason: 'bad_position',
    });
    expect(projectTaskActions.addToMyPriorities('TL-1', 1.5)).toMatchObject({
      ok: false,
      reason: 'bad_position',
    });
    expect(projectTaskActions.removeFromMyPriorities('TL-1')).toMatchObject({
      ok: false,
      reason: 'not_in_priorities',
    });
  });

  it('refuses an unknown urgency', () => {
    expect(projectTaskActions.setUrgency('TL-1', 'critical')).toMatchObject({
      ok: false,
      reason: 'unknown_urgency',
    });
  });
});

describe('describeTaskFailure', () => {
  it('lists the current task references when a task is not found', () => {
    const result = projectTaskActions.assignTask('Ghost', 'alex');
    if (result.ok) throw new Error('expected a failure');
    expect(describeTaskFailure(result)).toBe(
      'No task matches "Ghost". Current tasks: TL-1 Update demo README, TL-2 Record launch video',
    );
  });

  it('lists the team ids for an unknown assignee', () => {
    const result = projectTaskActions.assignTask('TL-1', 'robin');
    if (result.ok) throw new Error('expected a failure');
    expect(describeTaskFailure(result)).toBe(
      'No team member matches "robin". Team ids: chris (Chris, me), alex (Alex), sam (Sam), or unassigned',
    );
  });

  it('names the candidates of an ambiguous reference', () => {
    projectTaskActions.createTask({ title: 'Demo copy A' });
    projectTaskActions.createTask({ title: 'Demo copy B' });
    const result = projectTaskActions.removeTask('demo copy');
    if (result.ok) throw new Error('expected a failure');
    expect(describeTaskFailure(result)).toBe(
      '"demo copy" matches more than one task: TL-3, TL-4. Pass the task id.',
    );
  });
});

describe('published references', () => {
  it('cleans and shortens titles in the label so it can travel as an enum value', () => {
    const created = projectTaskActions.createTask({
      title: `Pipe | and\nnewline ${'x'.repeat(80)}`,
    });
    if (!created.ok) throw new Error('expected a task');
    const label = taskReferenceLabel(created.task);
    expect(label).not.toMatch(/[|\r\n]/);
    expect(label.startsWith('TL-3 Pipe and newline x')).toBe(true);
    expect(label).toContain('... (unassigned, normal, not in priorities)');
    expect(resolveTaskReference(label)).toMatchObject({
      kind: 'found',
      task: { id: 'TL-3' },
    });
  });

  it('refuses a label whose status no longer matches the task', () => {
    const before = taskReferenceLabel(firstTask());
    projectTaskActions.assignTask('TL-1', 'sam');
    expect(resolveTaskReference(before)).toMatchObject({
      kind: 'stale',
      task: { id: 'TL-1', assigneeId: 'sam' },
    });
    const result = projectTaskActions.updateTask(before, {
      description: 'Stale',
    });
    expect(result).toMatchObject({ ok: false, reason: 'stale_reference' });
    if (result.ok) throw new Error('expected a failure');
    expect(describeTaskFailure(result)).toBe(
      `"${before}" is out of date. TL-1 is now "TL-1 Update demo README (Sam, normal, not in priorities)". Use the current reference.`,
    );
  });

  it('accepts labels remembered for a response even after its own Actions change them', () => {
    const remembered = taskReferenceLabel(firstTask());
    rememberRequestReferences();
    expect(projectTaskActions.assignTask(remembered, 'chris')).toMatchObject({
      ok: true,
    });
    expect(projectTaskActions.addToMyPriorities(remembered)).toMatchObject({
      ok: true,
      previousPosition: null,
    });
  });

  it('reports the previous values of a change', () => {
    expect(projectTaskActions.assignTask('TL-1', 'chris')).toMatchObject({
      ok: true,
      previous: { assigneeId: 'alex' },
      task: { assigneeId: 'chris' },
    });
    projectTaskActions.addToMyPriorities('TL-1');
    expect(projectTaskActions.addToMyPriorities('TL-2', 1)).toMatchObject({
      previousPosition: null,
    });
    expect(projectTaskActions.addToMyPriorities('TL-1', 1)).toMatchObject({
      previousPosition: 2,
      position: 1,
    });
  });
});

function firstTask() {
  const task = getProjectTasksSnapshot().tasks[0];
  if (!task) throw new Error('expected a seeded task');
  return task;
}
