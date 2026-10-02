import { DomainError } from '@/lib/errors';
import { localDateString, parseLocalDateTime } from '@/lib/format';

/** Records older than this are almost certainly a typo in the year. */
const EARLIEST_ARRIVAL = '2000-01-01';

/** A past date given without a time is recorded at midday, Dubai time. */
const DEFAULT_PAST_TIME = '12:00';

/**
 * When a vehicle arrived, for a job card entered now or after the fact.
 *
 * - Nothing given, or today with no time: `null` — the job opens now, as
 *   it always has.
 * - An earlier date ("YYYY-MM-DD"), optionally with a time ("HH:mm"):
 *   that moment in Dubai, so a job that came in before it was entered
 *   can be recorded on the day it really arrived.
 * - Never in the future.
 */
export function arrivalMoment(
  date: string | undefined,
  time: string | undefined,
  now: Date = new Date(),
): Date | null {
  const day = date?.trim() ?? '';
  const clock = time?.trim() ?? '';
  const today = localDateString(now);
  if (day === '' && clock === '') return null;
  if (day === '' && clock !== '') {
    throw new DomainError('Choose the date the vehicle arrived.', 'arrivedOn');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || parseLocalDateTime(`${day}T00:00`) === null) {
    throw new DomainError('Enter the date the vehicle arrived.', 'arrivedOn');
  }
  if (day > today) {
    throw new DomainError('The arrival date cannot be in the future.', 'arrivedOn');
  }
  if (day < EARLIEST_ARRIVAL) {
    throw new DomainError('That arrival date is too far back — check the year.', 'arrivedOn');
  }
  if (clock !== '' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(clock)) {
    throw new DomainError('Enter the arrival time as HH:MM, or leave it blank.', 'arrivedAt');
  }
  if (day === today && clock === '') return null;

  const moment = parseLocalDateTime(`${day}T${clock || DEFAULT_PAST_TIME}`);
  if (moment === null) throw new DomainError('Enter the date the vehicle arrived.', 'arrivedOn');
  if (moment.getTime() > now.getTime()) {
    throw new DomainError('The arrival time cannot be later than now.', 'arrivedAt');
  }
  return moment;
}
