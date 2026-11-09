/**
 * Calendar months in the client's timezone, not UTC's: a visit late on the
 * 31st belongs to that month, not the next.
 *
 * Env: CLIENT_TIMEZONE (default America/Denver)
 */
export const clientTimeZone = () => process.env.CLIENT_TIMEZONE || 'America/Denver';

/** Today's date (YYYY-MM-DD) where the client is. */
export function localToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: clientTimeZone() }).format(now);
}

/** First and last day of a YYYY-MM month, as YYYY-MM-DD. */
export function monthBounds(month: string) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(new Date(Date.UTC(y, m - 1, 1))), end: iso(new Date(Date.UTC(y, m, 0))) };
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
}

/** The month before the current one, where the client is. */
export const lastCompleteMonth = (now = new Date()) => shiftMonth(localToday(now).slice(0, 7), -1);

/** "2026-09" as "September" (or "September 2026"). */
export const monthLabel = (month: string, withYear = false) =>
  new Date(`${month}-15T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'long',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });

/**
 * Midnight at the start of a local date (YYYY-MM-DD), as the UTC timestamp the
 * database stores ("YYYY-MM-DD HH:MM:SS"). Submissions are counted by the
 * client's calendar, or a Friday-evening inquiry would land in the next month.
 */
export function localMidnightUtc(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: clientTimeZone(),
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
      .formatToParts(new Date(guess))
      .map((p) => [p.type, p.value]),
  );
  const asLocal = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!);
  return new Date(guess - (asLocal - guess)).toISOString().slice(0, 19).replace('T', ' ');
}
