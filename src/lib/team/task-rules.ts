import type { TaskStatus } from '@/generated/prisma/enums';

/*
 * Who may do what with a task — one pure function, used by the service to
 * enforce and by the screens to show only the buttons that will work.
 *
 *   The assignee             works it: starts it, comments, adds photos and
 *                            voice notes, ticks it done or reopens it, stars
 *                            it, and moves it to another day — with a
 *                            reason, which shows in its history.
 *   …on their own to-do      also edits its wording and priority, and
 *                            deletes it (cancelled, kept in the history).
 *   …on an assigned task     can NOT change its wording, priority or who it
 *                            is for, and can't delete it — that stays
 *                            with whoever holds task.edit / task.delete.
 *   task.view                sees everyone's tasks and can comment on them.
 *   task.edit                changes any task, reassigns it, moves any status.
 *   task.delete              cancels any task.
 *   The person who gave it   always sees it and can comment.
 */

export interface TaskActor {
  userId: string;
  /** The actor's own employee record, if their login has one. */
  employeeId: string | null;
  canViewAll: boolean;
  canEditAll: boolean;
  canCancelAll: boolean;
}

export interface TaskFacts {
  assigneeEmployeeId: string;
  createdByUserId: string;
  isAssigned: boolean;
  status: TaskStatus;
}

export interface TaskAbilities {
  see: boolean;
  comment: boolean;
  /** Move between To do, Working on it and Done (and reopen). */
  progress: boolean;
  /** Title, details, priority, linked job card. */
  edit: boolean;
  /** Set the date in the edit form, without a reason (managers only). */
  dueDate: boolean;
  /** Move to another day, giving a reason. */
  move: boolean;
  /** Star it on one's own list. */
  highlight: boolean;
  reassign: boolean;
  cancel: boolean;
}

const NONE: TaskAbilities = {
  see: false,
  comment: false,
  progress: false,
  edit: false,
  dueDate: false,
  move: false,
  highlight: false,
  reassign: false,
  cancel: false,
};

export function taskAbilities(actor: TaskActor, task: TaskFacts): TaskAbilities {
  const mine = actor.employeeId !== null && actor.employeeId === task.assigneeEmployeeId;
  const gaveIt = task.createdByUserId === actor.userId;
  const see = mine || gaveIt || actor.canViewAll;
  if (!see) return NONE;

  const ownTodo = mine && !task.isAssigned;
  const cancelled = task.status === 'CANCELLED';
  const open = task.status === 'TODO' || task.status === 'IN_PROGRESS';
  const editor = actor.canEditAll || ownTodo;

  return {
    see,
    comment: !cancelled,
    // A cancelled task is brought back only by someone who could cancel it.
    progress: cancelled ? actor.canCancelAll || ownTodo : mine || actor.canEditAll,
    edit: open && editor,
    dueDate: open && actor.canEditAll,
    move: open && (mine || actor.canEditAll),
    highlight: mine && !cancelled,
    reassign: open && actor.canEditAll,
    cancel: open && (actor.canCancelAll || ownTodo),
  };
}

/** Which statuses a task may move to from where it is. */
export function nextStatuses(status: TaskStatus): TaskStatus[] {
  switch (status) {
    case 'TODO':
      return ['IN_PROGRESS', 'DONE'];
    case 'IN_PROGRESS':
      return ['DONE', 'TODO'];
    case 'DONE':
      return ['TODO'];
    case 'CANCELLED':
      return ['TODO'];
  }
}
