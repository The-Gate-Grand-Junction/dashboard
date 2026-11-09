/**
 * Comparing two periods, worded honestly at any size (OVERVIEW-STANDARD 4.4).
 * Shared by the overview, the reports page and the report's generated
 * sentences (netlify/lib/report.ts), so a change is never described two ways.
 *
 *   both figures 20 or more  → a percentage: "Up 32% on the month before"
 *   either under 20          → counts: "Up from 6 the month before"
 *   no earlier figure        → nothing; never "up 100%" from nothing
 *   the same number          → "The same as the month before"
 */

/** Below this, a percentage overstates what happened ("up 50%" for 2 → 3). */
export const PERCENT_FLOOR = 20;

export type Direction = 'up' | 'down' | 'flat';

export interface Against {
  /** Follows a percentage: "Up 12% {pct}", e.g. "on the month before". */
  pct: string;
  /** Follows a count: "Up from 6 {count}", e.g. "the month before". */
  count: string;
}

export function compare(now: number, before: number | null | undefined, against: Against): { text: string; dir: Direction } {
  if (before === null || before === undefined) return { text: '', dir: 'flat' };
  if (now === before) return { text: `The same as ${against.count}`, dir: 'flat' };

  if (now >= PERCENT_FLOOR && before >= PERCENT_FLOOR) {
    const pct = Math.round(((now - before) / before) * 100);
    // Within ±5% reads as noise, so it isn't painted red or green.
    if (Math.abs(pct) <= 5) return { text: `About the same as ${against.count}`, dir: 'flat' };
    return { text: `${pct > 0 ? 'Up' : 'Down'} ${Math.abs(pct)}% ${against.pct}`, dir: pct > 0 ? 'up' : 'down' };
  }
  return {
    text: `${now > before ? 'Up' : 'Down'} from ${before.toLocaleString('en-US')} ${against.count}`,
    dir: now > before ? 'up' : 'down',
  };
}

export const AGAINST_SAME_DAYS: Against = { pct: 'on the same days last month', count: 'this time last month' };
export const AGAINST_MONTH_BEFORE: Against = { pct: 'on the month before', count: 'the month before' };
export const againstLastYear = (monthName: string): Against => ({
  pct: `on ${monthName} last year`,
  count: `in ${monthName} last year`,
});

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}
