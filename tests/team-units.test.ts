/**
 * Unit tests for the team module's pure rules: where someone is against the
 * workshop's location lock, reading a pasted Google Maps position, who may
 * do what with a task, the voice-note formats kept, and the live board's
 * lanes. No database.
 *
 *   npm run test:unit
 */
import './unit-env';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFence, distanceM, dubaiTimeOn, formatDistance, parseCoordinates } from '@/lib/team/geo';
import { nextStatuses, taskAbilities, type TaskActor, type TaskFacts } from '@/lib/team/task-rules';
import { addDays, splitTaskText } from '@/lib/team/client';
import { sniffAudio } from '@/lib/storage';
import { laneOf } from '@/lib/workshop/live-board';
import { isRtl, languageLabel } from '@/lib/team/labels';
import { splitWorked } from '@/lib/hr/attendance';

const WORKSHOP = { latitude: 25.2862, longitude: 55.389, radiusM: 150 };
/** A point `metres` north of the workshop (1° latitude ≈ 111,195 m). */
const north = (metres: number) => ({ latitude: WORKSHOP.latitude + metres / 111_195, longitude: WORKSHOP.longitude });

describe('the location lock', () => {
  test('distance is measured in metres', () => {
    assert.ok(Math.abs(distanceM(WORKSHOP, north(100)) - 100) < 1);
    assert.equal(Math.round(distanceM(WORKSHOP, WORKSHOP)), 0);
  });

  test('inside the radius with a good fix: allowed', () => {
    assert.deepEqual(checkFence({ ...north(80), accuracy: 15 }, WORKSHOP), { ok: true, distanceM: 80 });
  });

  test('just outside, but within the phone’s own uncertainty (capped at 50 m): allowed', () => {
    assert.equal(checkFence({ ...north(180), accuracy: 40 }, WORKSHOP).ok, true);
    assert.equal(checkFence({ ...north(220), accuracy: 120 }, WORKSHOP).ok, false, 'the allowance is capped');
  });

  test('a kilometre away: refused as outside', () => {
    const result = checkFence({ ...north(1000), accuracy: 10 }, WORKSHOP);
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.reason, 'outside');
  });

  test('a rough fix (Wi-Fi or towers only) is refused even at the workshop', () => {
    const result = checkFence({ ...north(0), accuracy: 900 }, WORKSHOP);
    assert.equal(!result.ok && result.reason, 'imprecise');
  });

  test('distances read naturally', () => {
    assert.equal(formatDistance(40.4), '40 m');
    assert.equal(formatDistance(1234), '1.2 km');
    assert.equal(formatDistance(25_000), '25 km');
  });

  test('a shift end is a Dubai time on the day', () => {
    assert.equal(dubaiTimeOn('2026-10-04', '20:00').toISOString(), '2026-10-04T16:00:00.000Z');
  });
});

describe('reading a pasted position', () => {
  test('plain numbers', () => {
    assert.deepEqual(parseCoordinates('25.2862, 55.3890'), { latitude: 25.2862, longitude: 55.389 });
    assert.deepEqual(parseCoordinates('25.2862 55.3890'), { latitude: 25.2862, longitude: 55.389 });
  });

  test('a Google Maps link: the pin beats the view centre', () => {
    const link =
      'https://www.google.com/maps/place/Garage/@25.2800,55.3800,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d25.2862!4d55.389';
    assert.deepEqual(parseCoordinates(link), { latitude: 25.2862, longitude: 55.389 });
    assert.deepEqual(parseCoordinates('https://maps.google.com/?q=25.2862,55.389'), { latitude: 25.2862, longitude: 55.389 });
    assert.deepEqual(parseCoordinates('https://www.google.com/maps/@25.2862,55.389,18z'), { latitude: 25.2862, longitude: 55.389 });
  });

  test('nonsense, short links and 0,0 are not positions', () => {
    assert.equal(parseCoordinates('Al Qusais Industrial 1'), null);
    assert.equal(parseCoordinates('https://maps.app.goo.gl/abc123'), null);
    assert.equal(parseCoordinates('0, 0'), null);
    assert.equal(parseCoordinates('95, 55'), null);
  });
});

describe('who may do what with a task', () => {
  const technician: TaskActor = { userId: 'u-tech', employeeId: 'e-tech', canViewAll: false, canEditAll: false, canCancelAll: false };
  const manager: TaskActor = { userId: 'u-boss', employeeId: 'e-boss', canViewAll: true, canEditAll: true, canCancelAll: true };
  const colleague: TaskActor = { userId: 'u-other', employeeId: 'e-other', canViewAll: false, canEditAll: false, canCancelAll: false };
  const assigned: TaskFacts = { assigneeEmployeeId: 'e-tech', createdByUserId: 'u-boss', isAssigned: true, status: 'TODO' };
  const ownTodo: TaskFacts = { assigneeEmployeeId: 'e-tech', createdByUserId: 'u-tech', isAssigned: false, status: 'TODO' };

  test('a task the manager gave: the technician works it, moves it with a reason, stars it — nothing more', () => {
    const can = taskAbilities(technician, assigned);
    assert.equal(can.see, true);
    assert.equal(can.progress, true);
    assert.equal(can.comment, true);
    assert.equal(can.move, true);
    assert.equal(can.highlight, true);
    assert.equal(can.edit, false, 'wording and priority stay with the manager');
    assert.equal(can.dueDate, false, 'the date only changes by moving it, with a reason');
    assert.equal(can.cancel, false, 'only the manager deletes it');
    assert.equal(can.reassign, false);
  });

  test('their own to-do: edit and delete too, but the date still moves with a reason', () => {
    const can = taskAbilities(technician, ownTodo);
    assert.equal(can.edit, true);
    assert.equal(can.cancel, true);
    assert.equal(can.move, true);
    assert.equal(can.dueDate, false);
  });

  test('a manager can do everything except star someone else’s task', () => {
    const can = taskAbilities(manager, assigned);
    assert.deepEqual(
      { ...can },
      { see: true, comment: true, progress: true, edit: true, dueDate: true, move: true, highlight: false, reassign: true, cancel: true },
    );
  });

  test('a colleague without task.view does not see it at all', () => {
    assert.equal(taskAbilities(colleague, assigned).see, false);
    assert.equal(taskAbilities(colleague, assigned).progress, false);
  });

  test('a done task is not edited or moved, only reopened', () => {
    const can = taskAbilities(technician, { ...assigned, status: 'DONE' });
    assert.equal(can.progress, true);
    assert.equal(can.edit, false);
    assert.equal(can.move, false);
    assert.deepEqual(nextStatuses('DONE'), ['TODO']);
  });

  test('a cancelled assigned task can only be brought back by the manager', () => {
    assert.equal(taskAbilities(technician, { ...assigned, status: 'CANCELLED' }).progress, false);
    assert.equal(taskAbilities(manager, { ...assigned, status: 'CANCELLED' }).progress, true);
  });
});

describe('voice notes and text', () => {
  test('recordings are recognised by their bytes', () => {
    assert.equal(sniffAudio(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0]))?.extension, 'webm');
    assert.equal(sniffAudio(Buffer.from('OggS\0\0\0\0', 'latin1'))?.extension, 'ogg');
    assert.equal(sniffAudio(Buffer.from('\0\0\0\x20ftypM4A \0\0\0\0', 'latin1'))?.extension, 'm4a');
    assert.equal(sniffAudio(Buffer.from('RIFF\0\0\0\0WAVEfmt ', 'latin1'))?.extension, 'wav');
    assert.equal(sniffAudio(Buffer.from('ID3\x04\0\0', 'latin1'))?.extension, 'mp3');
    assert.equal(sniffAudio(Buffer.from('<html>', 'latin1')), null);
  });

  test('the first line is the task, the rest is detail', () => {
    assert.deepEqual(splitTaskText('Change oil on the Patrol\nUse 5W-30\nCheck filter'), {
      title: 'Change oil on the Patrol',
      details: 'Use 5W-30\nCheck filter',
    });
    const long = splitTaskText('word '.repeat(60).trim());
    assert.ok(long.title.length <= 122);
    assert.ok(long.details.length > 0, 'nothing is lost');
  });

  test('days are added on the calendar', () => {
    assert.equal(addDays('2026-10-31', 1), '2026-11-01');
    assert.equal(addDays('2026-10-01', -1), '2026-09-30');
  });

  test('languages', () => {
    assert.equal(languageLabel('ml-IN'), 'Malayalam');
    assert.equal(isRtl('ar-AE'), true);
    assert.equal(isRtl('ur-PK'), true);
    assert.equal(isRtl('hi-IN'), false);
  });
});

describe('normal hours and overtime', () => {
  const day = (inAt: string, outAt: string | null) => ({
    attendanceDate: new Date('2026-10-05T00:00:00Z'),
    clockInAt: new Date(`2026-10-05T${inAt}:00+04:00`),
    clockOutAt: outAt ? new Date(`2026-10-05T${outAt}:00+04:00`) : null,
  });

  test('a day that ends before 9 pm is all normal time', () => {
    assert.deepEqual(splitWorked(day('08:00', '19:30'), '21:00'), { normal: 690, overtime: 0 });
  });

  test('time after 9 pm is overtime; the rest stays normal', () => {
    assert.deepEqual(splitWorked(day('08:00', '22:15'), '21:00'), { normal: 780, overtime: 75 });
  });

  test('someone who came in after 9 pm worked only overtime', () => {
    assert.deepEqual(splitWorked(day('21:30', '23:00'), '21:00'), { normal: 0, overtime: 90 });
  });

  test('a day still open has no split yet', () => {
    assert.equal(splitWorked(day('08:00', null), '21:00'), null);
  });
});

describe('the live board', () => {
  test('every workflow status lands in one lane', () => {
    assert.equal(laneOf('ARRIVED'), 'in');
    assert.equal(laneOf('INSPECTION'), 'in');
    assert.equal(laneOf('WAITING_APPROVAL'), 'approval');
    assert.equal(laneOf('REPAIR'), 'work');
    assert.equal(laneOf('ON_HOLD'), 'hold');
    assert.equal(laneOf('READY'), 'ready');
    assert.equal(laneOf('PAID'), 'ready');
    assert.equal(laneOf('IN_PROGRESS'), 'work', 'legacy statuses too');
  });
});
