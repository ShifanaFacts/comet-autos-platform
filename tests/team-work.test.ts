/**
 * Integration tests for the team module: checking yourself in at the
 * workshop (location lock, forgotten check-outs, review), and tasks — given
 * to people, kept as your own, ticked off, moved with a reason, starred.
 *
 *   npm run test:integration
 */
import 'dotenv/config';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@/lib/prisma';
import { AuthError } from '@/lib/auth/authorize';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { NotFoundError } from '@/lib/errors';
import { localDateString, parseCalendarDate } from '@/lib/format';
import { updateBranchLocation } from '@/lib/organization/branches';
import {
  getMyDay,
  listAttendanceToReview,
  reportLeftAt,
  reviewAttendance,
  selfClock,
} from '@/lib/hr/self-attendance';
import {
  addTaskUpdate,
  createTasks,
  editTask,
  getTask,
  getTeamBoard,
  listMyTasks,
  moveTask,
  setTaskHighlight,
  setTaskStatus,
} from '@/lib/team/tasks';
import { getLiveBoard } from '@/lib/workshop/live-board';
import { addDays } from '@/lib/team/client';
import { createTestOrg, expectDomainError, type TestOrg } from './support';

const WORKSHOP = { latitude: 25.2862, longitude: 55.389 };
const north = (metres: number, accuracy = 10) => ({
  latitude: WORKSHOP.latitude + metres / 111_195,
  longitude: WORKSHOP.longitude,
  accuracy,
});

let a: TestOrg;
let b: TestOrg;
let tech: AuthenticatedUser;
let mate: AuthenticatedUser;
let techEmployee: string;
let mateEmployee: string;
const today = () => localDateString();

/** A login for one of the test org's technicians, with only what a technician has. */
async function technicianLogin(org: TestOrg, employeeId: string, email: string): Promise<AuthenticatedUser> {
  const user = await prisma.user.create({
    data: { organizationId: org.organizationId, primaryBranchId: org.branchId, email, passwordHash: 'not-used', fullName: email.split('@')[0] },
  });
  await prisma.employee.update({ where: { id: employeeId }, data: { userId: user.id } });
  return {
    ...org.owner,
    id: user.id,
    email,
    fullName: user.fullName,
    roleNames: ['Technician'],
    orgWidePermissions: new Set(['job_card.view', 'job_card.edit']),
  };
}

before(async () => {
  a = await createTestOrg('TeamA');
  b = await createTestOrg('TeamB');
  [techEmployee, mateEmployee] = a.technicianIds;
  tech = await technicianLogin(a, techEmployee, 'tech1@test.local');
  mate = await technicianLogin(a, mateEmployee, 'tech2@test.local');
});

after(async () => {
  await prisma.$disconnect();
});

describe('checking yourself in', () => {
  test('nobody can check in from a phone until the workshop’s location is set', async () => {
    await expectDomainError(selfClock(tech, 'IN', north(10)), /location hasn’t been set/);
  });

  test('only settings.edit sets the location', async () => {
    await assert.rejects(
      updateBranchLocation(tech, a.branchId, { ...WORKSHOP, radius: 150, shiftEndTime: '20:00' }),
      AuthError,
    );
    await updateBranchLocation(a.owner, a.branchId, { ...WORKSHOP, radius: 150, shiftEndTime: '20:00' });
  });

  test('a kilometre away: refused, with the distance', async () => {
    await expectDomainError(selfClock(tech, 'IN', north(1000)), /1\.0 km from the workshop/);
  });

  test('a rough fix: refused, asking for precise location', async () => {
    await expectDomainError(selfClock(tech, 'IN', north(20, 800)), /precise location/);
  });

  test('at the workshop: checked in, with where the phone was', async () => {
    const { record } = await selfClock(tech, 'IN', north(40));
    assert.equal(record.clockInMethod, 'SELF');
    assert.equal(record.clockInDistanceM, 40);
    await expectDomainError(selfClock(tech, 'IN', north(40)), /already checked in/);
    const day = await getMyDay(tech);
    assert.equal(day?.next, 'OUT');
  });

  test('checking out away from the workshop is refused — they can report the time instead', async () => {
    await expectDomainError(selfClock(tech, 'OUT', north(5000)), /from the workshop/);
  });

  test('checking out at the workshop closes the day', async () => {
    const { record } = await selfClock(tech, 'OUT', north(30));
    assert.equal(record.clockOutMethod, 'SELF');
    assert.equal((await getMyDay(tech))?.next, 'DONE');
  });

  test('a forgotten check-out: the next check-in asks when they left, and flags that day', async () => {
    const yesterday = addDays(today(), -1);
    const day = await prisma.attendance.create({
      data: {
        organizationId: a.organizationId,
        branchId: a.branchId,
        employeeId: mateEmployee,
        attendanceDate: parseCalendarDate(yesterday)!,
        clockInAt: new Date(`${yesterday}T08:05:00+04:00`),
        status: 'PRESENT',
        clockInMethod: 'SELF',
      },
    });
    const myDay = await getMyDay(mate);
    assert.equal(myDay?.openEarlier?.id, day.id, 'the open day is shown to them');

    await expectDomainError(selfClock(mate, 'IN', north(10)), /Enter the time you left/);
    await expectDomainError(
      selfClock(mate, 'IN', { ...north(10), previousLeftAt: '07:00' }),
      /must be after/,
    );
    const { closed } = await selfClock(mate, 'IN', { ...north(10), previousLeftAt: '18:10' });
    assert.deepEqual(closed, [yesterday]);
    const after = await prisma.attendance.findUniqueOrThrow({ where: { id: day.id } });
    assert.equal(after.clockOutMethod, 'REPORTED');
    assert.equal(after.needsReview, true);
    assert.equal(after.clockOutAt?.toISOString(), new Date(`${yesterday}T18:10:00+04:00`).toISOString());

    const toReview = await listAttendanceToReview(a.owner);
    assert.ok(toReview.some((row) => row.id === day.id));
  });

  test('the employee can correct the time they gave; the manager confirms or corrects it', async () => {
    const day = await prisma.attendance.findFirstOrThrow({
      where: { employeeId: mateEmployee, clockOutMethod: 'REPORTED' },
    });
    const date = day.attendanceDate.toISOString().slice(0, 10);
    await expectDomainError(reportLeftAt(mate, day.id, { leftAt: '07:00' }), /must be after/);
    await reportLeftAt(mate, day.id, { leftAt: '18:30' });
    let row = await prisma.attendance.findUniqueOrThrow({ where: { id: day.id } });
    assert.equal(row.clockOutMethod, 'REPORTED');
    assert.equal(row.needsReview, true);

    await assert.rejects(reviewAttendance(mate, day.id, {}), AuthError);
    await reviewAttendance(a.owner, day.id, { clockOut: '18:45' });
    row = await prisma.attendance.findUniqueOrThrow({ where: { id: day.id } });
    assert.equal(row.needsReview, false);
    assert.equal(row.clockOutAt?.toISOString(), new Date(`${date}T18:45:00+04:00`).toISOString());
    assert.equal(row.reviewedByUserId, a.owner.id);
  });

  test('someone else’s day can’t be reported on', async () => {
    const day = await prisma.attendance.findFirstOrThrow({ where: { employeeId: techEmployee } });
    await assert.rejects(reportLeftAt(mate, day.id, { leftAt: '18:00' }), NotFoundError);
  });
});

describe('tasks', () => {
  let given: string;
  let ownTodo: string;

  test('a technician can’t give tasks to others', async () => {
    await assert.rejects(createTasks(tech, { title: 'Wash the Patrol', assigneeIds: [mateEmployee] }), AuthError);
  });

  test('the manager gives one task to two people: one copy each, dated today unless chosen', async () => {
    const created = await createTasks(a.owner, {
      title: 'Check tyre pressures on every car in the bay',
      details: 'Front and back',
      language: 'ml-IN',
      assigneeIds: [techEmployee, mateEmployee],
      priority: 'HIGH',
    });
    assert.equal(created.length, 2);
    given = created.find((task) => task.assigneeEmployeeId === techEmployee)!.id;
    const task = await prisma.task.findUniqueOrThrow({ where: { id: given } });
    assert.equal(task.isAssigned, true);
    assert.equal(task.language, 'ml-IN');
    assert.equal(task.dueDate?.toISOString().slice(0, 10), today());
    assert.equal(task.originalDueDate?.toISOString().slice(0, 10), today());
  });

  test('a past due date is refused', async () => {
    await expectDomainError(createTasks(tech, { title: 'Old', dueDate: addDays(today(), -1) }), /past/);
  });

  test('a technician adds their own to-do', async () => {
    const [task] = await createTasks(tech, { title: 'Order brake pads', dueDate: addDays(today(), 2) });
    ownTodo = task.id;
    const row = await prisma.task.findUniqueOrThrow({ where: { id: ownTodo } });
    assert.equal(row.isAssigned, false);
    assert.equal(row.assigneeEmployeeId, techEmployee);
  });

  test('the assigned task: wording and deleting stay with the manager', async () => {
    await expectDomainError(
      editTask(tech, given, { title: 'Something else', priority: 'LOW' }),
      /only be changed by a manager/,
    );
    await expectDomainError(setTaskStatus(tech, given, { status: 'CANCELLED' }), /only a manager can cancel/);
  });

  test('moving needs a reason, and the move is kept', async () => {
    const tomorrow = addDays(today(), 1);
    await assert.rejects(moveTask(tech, given, { dueDate: tomorrow }));
    await moveTask(tech, given, { dueDate: tomorrow, reason: 'Waiting for the gauge to come back' });
    const task = await getTask(tech, given);
    assert.equal(task.dueKey, tomorrow);
    assert.equal(task.timesMoved, 1);
    assert.equal(task.originalDueDate?.toISOString().slice(0, 10), today());
    const move = task.updates.find((update) => update.kind === 'MOVED');
    assert.equal(move?.body, 'Waiting for the gauge to come back');
    await expectDomainError(moveTask(tech, given, { dueDate: addDays(today(), -1), reason: 'x x x' }), /past/);
  });

  test('ticking it off, and back', async () => {
    await setTaskStatus(tech, given, { status: 'DONE' });
    let task = await getTask(tech, given);
    assert.equal(task.status, 'DONE');
    assert.ok(task.completedAt);
    await setTaskStatus(tech, given, { status: 'TODO' });
    task = await getTask(tech, given);
    assert.equal(task.status, 'TODO');
    assert.equal(task.completedAt, null);
  });

  test('starring is the assignee’s own marker', async () => {
    await setTaskHighlight(tech, given, true);
    assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: given } })).highlighted, true);
    await expectDomainError(setTaskHighlight(a.owner, given, true), /your own list/);
  });

  test('a note needs something in it', async () => {
    await expectDomainError(addTaskUpdate(tech, given, {}), /note/);
    await addTaskUpdate(tech, given, { body: 'Two cars done', language: 'en-IN' });
  });

  test('their own to-do: editing and deleting are theirs', async () => {
    await editTask(tech, ownTodo, { title: 'Order brake pads (front)', priority: 'URGENT' });
    await setTaskStatus(tech, ownTodo, { status: 'CANCELLED' });
    assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: ownTodo } })).status, 'CANCELLED');
  });

  test('a colleague can’t see someone else’s task; the board needs task.view', async () => {
    await assert.rejects(getTask(mate, ownTodo), NotFoundError);
    await assert.rejects(getTeamBoard(tech), AuthError);
    const board = await getTeamBoard(a.owner, { show: 'all' });
    assert.ok(board.tasks.some((task) => task.id === given));
    assert.ok(board.team.some((member) => member.id === techEmployee && member.presence === 'LEFT'));
  });

  test('another workshop sees none of it', async () => {
    await assert.rejects(getTask(b.owner, given), NotFoundError);
    const board = await getTeamBoard(b.owner, { show: 'all' });
    assert.equal(board.tasks.length, 0);
  });

  test('my list: pending earlier days under their own heading, oldest first', async () => {
    const [old] = await createTasks(a.owner, { title: 'Return the jack', assigneeIds: [mateEmployee] });
    await prisma.task.update({ where: { id: old.id }, data: { dueDate: parseCalendarDate(addDays(today(), -3))! } });
    const list = await listMyTasks(mate);
    assert.ok(list);
    const dates = list.groups.map((group) => group.date);
    assert.deepEqual(dates, [...dates].sort());
    assert.equal(list.groups[0].kind, 'overdue');
    assert.equal(list.groups[0].date, addDays(today(), -3));
    assert.ok(list.groups.some((group) => group.kind === 'today'));

    const history = await listMyTasks(mate, addDays(today(), -3));
    assert.ok(history);
    assert.equal(history.view, 'day');
    assert.ok(history.groups[0].tasks.some((task) => task.id === old.id));
  });
});

describe('the live board', () => {
  test('needs job_card.view, and shows the whole team', async () => {
    const board = await getLiveBoard(a.owner);
    assert.ok(board.team.length >= 2);
    assert.ok(board.team.some((member) => member.id === techEmployee && member.left));
    const viewerOnly = { ...tech, orgWidePermissions: new Set<string>() };
    await assert.rejects(getLiveBoard(viewerOnly), AuthError);
  });
});
