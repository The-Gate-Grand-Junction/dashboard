import { requireUser } from '../lib/auth';
import { analyticsConfigured, saRange } from '../lib/simple-analytics';
import { ga4Configured, ga4MonthToDate, ga4Range } from '../lib/ga4';
import { localToday, shiftMonth } from '../lib/time';

/**
 * Analytics Proxy — fetches from Simple Analytics API on behalf of the dashboard.
 * Keeps the SA API key server-side so it's never exposed to the client.
 *
 * Auth required (see netlify/lib/auth.ts): without it this was an open proxy in front of a
 * paid API key — any caller could pull stats for any hostname. The hostname is
 * pinned server-side for the same reason; only the date range comes from the UI.
 *
 * Query params: start, end (YYYY-MM-DD) and optionally interval (day | month)
 * for a real visitor histogram over the range; or period=mtd for the
 * overview's "this month so far" card. Simple Analytics or GA4, whichever is
 * configured, in the same shape.
 * Env: see ../lib/simple-analytics.ts, ../lib/ga4.ts and ../lib/time.ts
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Responses depend on who is asking, so no shared cache may keep them. */
const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=300' };

const reply = (statusCode: number, body: unknown) => ({ statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) });

/**
 * This month through today, against the same days of last month (the 1st to
 * the same day-of-month, capped at that month's length), plus a daily series.
 */
async function monthToDate() {
  const today = localToday();
  const thisMonth = today.slice(0, 7);
  const lastMonth = shiftMonth(thisMonth, -1);
  const [y, m] = lastMonth.split('-').map(Number) as [number, number];
  const lastMonthLength = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const sameDay = String(Math.min(Number(today.slice(8)), lastMonthLength)).padStart(2, '0');

  // GA4 clients: engaged sessions over the same two ranges.
  if (!analyticsConfigured()) {
    const ga = await ga4MonthToDate(
      { startDate: `${thisMonth}-01`, endDate: today },
      { startDate: `${lastMonth}-01`, endDate: `${lastMonth}-${sameDay}` },
    );
    return { configured: true, period: 'mtd', ...ga, series: ga.series.filter((p) => p.key <= today) };
  }

  const [current, previous] = await Promise.all([
    saRange(`${thisMonth}-01`, today, ['visitors', 'pageviews', 'seconds_on_page', 'histogram']),
    saRange(`${lastMonth}-01`, `${lastMonth}-${sameDay}`, ['visitors']),
  ]);

  return {
    configured: true,
    period: 'mtd',
    current: {
      visitors: current.visitors ?? 0,
      pageviews: current.pageviews ?? 0,
      secondsOnPage: current.seconds_on_page ?? 0,
    },
    previous: { visitors: previous.visitors ?? 0 },
    series: (current.histogram ?? [])
      .filter((p) => p.date <= today)
      .map((p) => ({ key: p.date, visitors: p.visitors ?? 0 })),
  };
}

type Bucket = { date: string; pageviews: number; visitors: number };

/**
 * Every day (or month) from start to end, zero where nothing was recorded:
 * GA4 leaves out empty days, and an uneven axis misreads as a trend.
 */
function fillBuckets(buckets: Bucket[], start: string, end: string, interval: 'day' | 'month'): Bucket[] {
  const key = (date: string) => (interval === 'month' ? date.slice(0, 7) : date.slice(0, 10));
  const byDate = new Map(buckets.map((b) => [key(b.date), b]));
  const out: Bucket[] = [];
  const cursor = new Date(`${interval === 'month' ? `${start.slice(0, 7)}-01` : start}T00:00:00Z`);
  for (let i = 0; i < 400; i++) {
    const date = cursor.toISOString().slice(0, 10);
    if (date > end) break;
    const found = byDate.get(key(date));
    out.push({ date, pageviews: found?.pageviews ?? 0, visitors: found?.visitors ?? 0 });
    if (interval === 'month') cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    else cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

export async function handler(event: {
  queryStringParameters: Record<string, string> | null;
  headers: Record<string, string>;
}) {
  const auth = await requireUser(event);
  if ('statusCode' in auth) return auth;

  const { start, end, period, interval } = event.queryStringParameters || {};

  // The overview treats "not configured" as an empty state, not an error.
  if (period === 'mtd') {
    if (!analyticsConfigured() && !ga4Configured()) return reply(200, { configured: false });
    try {
      return reply(200, await monthToDate());
    } catch (err) {
      console.error('Analytics proxy (mtd) error:', err);
      return reply(502, { error: 'Could not load analytics' });
    }
  }

  if (!analyticsConfigured() && !ga4Configured()) {
    return reply(500, {
      error: 'Analytics not configured',
      message: 'Set SIMPLE_ANALYTICS_API_KEY and ANALYTICS_HOSTNAME, or the GA4 property and service account, in the Netlify environment variables.',
    });
  }
  // Only plain dates reach the upstream request.
  if (!start || !end || !DAY.test(start) || !DAY.test(end) || start > end) {
    return reply(400, { error: 'Missing or malformed params: start, end (YYYY-MM-DD)' });
  }
  const histogram = interval === 'day' || interval === 'month' ? interval : undefined;
  // Day buckets are capped at about a year (fillBuckets stops at 400)
  if (histogram === 'day' && Date.parse(end) - Date.parse(start) > 366 * 86_400_000) {
    return reply(400, { error: 'Use interval=month for ranges over a year' });
  }

  try {
    const data = analyticsConfigured()
      ? await saRange(start, end, ['pageviews', 'visitors', 'seconds_on_page', 'pages', 'referrers', ...(histogram ? ['histogram'] : [])], 20, histogram)
      : await ga4Range({ startDate: start, endDate: end }, histogram);
    return reply(200, {
      pageviews: data.pageviews ?? 0,
      visitors: data.visitors ?? 0,
      seconds_on_page: data.seconds_on_page ?? 0,
      pages: (data.pages ?? []).slice(0, 20),
      referrers: (data.referrers ?? []).slice(0, 20),
      ...(histogram
        ? {
            histogram: fillBuckets(
              (data.histogram ?? []).map((h) => ({ date: h.date.slice(0, 10), pageviews: h.pageviews ?? 0, visitors: h.visitors ?? 0 })),
              start,
              end,
              histogram,
            ),
          }
        : {}),
    });
  } catch (err) {
    console.error('Analytics proxy error:', err instanceof Error ? err.message : err);
    return reply(502, { error: 'Could not load analytics' });
  }
}
