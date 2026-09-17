/**
 * Display + parsing helpers pinned to the workshop's time zone. Comet Autos
 * operates in Dubai (UTC+4, no daylight saving), so form inputs like
 * "2026-09-18T09:30" always mean Dubai local time regardless of where the
 * server process runs.
 */
export const WORKSHOP_TIME_ZONE = 'Asia/Dubai';
const WORKSHOP_UTC_OFFSET = '+04:00';

type DateLike = Date | string;

const toDate = (value: DateLike) => (value instanceof Date ? value : new Date(value));

export function formatDateTime(value: DateLike): string {
  return toDate(value).toLocaleString('en-AE', {
    timeZone: WORKSHOP_TIME_ZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatDate(value: DateLike): string {
  return toDate(value).toLocaleDateString('en-AE', {
    timeZone: WORKSHOP_TIME_ZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** For @db.Date columns, which Prisma returns as UTC midnight. */
export function formatCalendarDate(value: DateLike): string {
  return toDate(value).toLocaleDateString('en-AE', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatTime(value: DateLike): string {
  return toDate(value).toLocaleTimeString('en-AE', {
    timeZone: WORKSHOP_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatDayHeading(value: DateLike): string {
  return toDate(value).toLocaleDateString('en-AE', {
    timeZone: WORKSHOP_TIME_ZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

const aed = new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', minimumFractionDigits: 2 });

export function formatMoney(value: { toString(): string } | number | string): string {
  return aed.format(Number(value.toString()));
}

/** "YYYY-MM-DD" for a moment, in Dubai. */
export function localDateString(value: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: WORKSHOP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** "YYYY-MM-DDTHH:mm" (datetime-local) interpreted as Dubai time. Returns null when malformed. */
export function parseLocalDateTime(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00${WORKSHOP_UTC_OFFSET}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "YYYY-MM-DD" → the UTC-midnight Date Prisma expects for a @db.Date column. */
export function parseCalendarDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The last instant of a calendar date in Dubai. */
export function endOfLocalDay(calendarDate: Date): Date {
  const day = calendarDate.toISOString().slice(0, 10);
  return new Date(`${day}T23:59:59.999${WORKSHOP_UTC_OFFSET}`);
}

/** [start, end) of the Dubai calendar day containing `value`. */
export function localDayRange(value: Date = new Date()): { start: Date; end: Date } {
  const day = localDateString(value);
  const start = new Date(`${day}T00:00:00${WORKSHOP_UTC_OFFSET}`);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

/** A Date → "YYYY-MM-DDTHH:mm" in Dubai, for prefilling datetime-local inputs. */
export function toLocalDateTimeInput(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: WORKSHOP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}
