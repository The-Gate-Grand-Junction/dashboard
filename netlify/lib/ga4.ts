import { googleAccessToken, googleCredentials } from './google';

/**
 * Google Analytics 4 through the Data API, as the dashboard's service account
 * (ported from the RMWS dashboard). The property is pinned in env, never taken
 * from a request.
 *
 * Visits are **engaged sessions** (10+ seconds, a second page, or a
 * conversion), never raw sessions: on RMWS more than half of raw GA4 sessions
 * were automated (OVERVIEW-STANDARD 4.2).
 *
 * Env: GA4_PROPERTY_ID, GA4_CLIENT_EMAIL, GA4_PRIVATE_KEY (newlines as \n).
 * The service account needs Viewer access on the property.
 */

export const ga4Configured = () => Boolean(process.env.GA4_PROPERTY_ID && googleCredentials());

interface Row {
  dimensionValues?: { value: string }[];
  metricValues?: { value: string }[];
}
interface Range { startDate: string; endDate: string }

const num = (row: Row | undefined, i: number) => Number(row?.metricValues?.[i]?.value ?? 0) || 0;
const dim = (row: Row, i: number) => row.dimensionValues?.[i]?.value ?? '';
/** With several date ranges, GA4 adds a trailing dateRange dimension ("date_range_0", …). */
const inRange = (rows: Row[] | undefined, i: number) =>
  (rows ?? []).filter((r) => r.dimensionValues?.at(-1)?.value === `date_range_${i}`);
/** "20260915" → "2026-09-15" */
const isoDay = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

async function batch(requests: unknown[]): Promise<{ rows?: Row[] }[]> {
  const credentials = googleCredentials();
  const propertyId = process.env.GA4_PROPERTY_ID;
  if (!credentials || !propertyId) throw new Error('GA4 is not configured');

  const token = await googleAccessToken(credentials, 'https://www.googleapis.com/auth/analytics.readonly');
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:batchRunReports`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests }),
  });
  if (!res.ok) throw new Error(`GA4 Data API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return ((await res.json()) as { reports?: { rows?: Row[] }[] }).reports ?? [];
}

const visits = { name: 'engagedSessions' };
const byVisits = [{ metric: { metricName: 'engagedSessions' }, desc: true }];

/**
 * One month's figures, with the month before and the same month last year for
 * comparison (null where that month isn't comparable). Raw page paths: the
 * caller cleans and merges them the same way for every provider.
 */
export async function ga4Month(current: Range, previous: Range | null, lastYear: Range | null) {
  const ranges = [current, previous, lastYear].filter((r): r is Range => Boolean(r));
  const usOnly = { filter: { fieldName: 'country', stringFilter: { value: 'United States' } } };
  // The Data API takes at most five requests a batch, so where and who go in a second one
  const [[totals, series, pages, sources, devices], [cities, audience]] = await Promise.all([batch([
    { dateRanges: ranges, metrics: [visits, { name: 'screenPageViews' }, { name: 'userEngagementDuration' }] },
    { dateRanges: [current], dimensions: [{ name: 'date' }], metrics: [visits], limit: 40 },
    { dateRanges: [current], dimensions: [{ name: 'pagePath' }], metrics: [{ name: 'screenPageViews' }], limit: 100,
      orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }] },
    { dateRanges: [current], dimensions: [{ name: 'sessionSource' }], metrics: [visits], orderBys: byVisits, limit: 15 },
    { dateRanges: [current], dimensions: [{ name: 'deviceCategory' }], metrics: [visits] },
  ]), batch([
    { dateRanges: [current], dimensions: [{ name: 'city' }, { name: 'region' }], metrics: [visits], dimensionFilter: usOnly, orderBys: byVisits, limit: 10 },
    { dateRanges: [current], dimensions: [{ name: 'newVsReturning' }], metrics: [visits] },
  ])]);
  const audienceTotal = (audience?.rows ?? []).reduce((sum, r) => sum + num(r, 0), 0);
  const returning = num((audience?.rows ?? []).find((r) => dim(r, 0) === 'returning'), 0);

  // A single range has no dateRange dimension; several do.
  const total = (i: number) => (ranges.length > 1 ? inRange(totals?.rows, i)[0] : totals?.rows?.[0]);
  const engaged = num(total(0), 0);
  const pageviews = num(total(0), 1);
  const deviceRows = devices?.rows ?? [];
  const deviceTotal = deviceRows.reduce((sum, r) => sum + num(r, 0), 0);
  const mobile = num(deviceRows.find((r) => dim(r, 0) === 'mobile'), 0);

  return {
    visits: engaged,
    prevVisits: previous ? num(total(1), 0) : null,
    lastYearVisits: lastYear ? num(total(previous ? 2 : 1), 0) : null,
    pageviews,
    // Engaged time per page view: the nearest GA4 figure to "time on a page".
    secondsOnPage: pageviews ? Math.round(num(total(0), 2) / pageviews) : 0,
    mobileShare: deviceTotal ? Math.round((mobile / deviceTotal) * 100) : null,
    returningShare: audienceTotal ? Math.round((returning / audienceTotal) * 100) : null,
    cities: (cities?.rows ?? [])
      .map((r) => ({ name: dim(r, 0), region: dim(r, 1), visits: num(r, 0) }))
      .filter((c) => c.visits > 0 && c.name !== '(not set)')
      .slice(0, 6),
    series: (series?.rows ?? []).map((r) => ({ day: isoDay(dim(r, 0)), visits: num(r, 0) })).sort((a, b) => a.day.localeCompare(b.day)),
    pages: (pages?.rows ?? []).map((r) => ({ path: dim(r, 0), views: num(r, 0) })),
    sources: (sources?.rows ?? []).map((r) => ({ source: dim(r, 0) === '(direct)' ? 'direct' : dim(r, 0), visits: num(r, 0) })),
  };
}

/** Month to date against the same days of last month, for the overview. */
export async function ga4MonthToDate(current: Range, previous: Range) {
  const [totals, series] = await batch([
    { dateRanges: [current, previous], metrics: [visits, { name: 'screenPageViews' }, { name: 'userEngagementDuration' }] },
    { dateRanges: [current], dimensions: [{ name: 'date' }], metrics: [visits], limit: 40 },
  ]);
  const now = inRange(totals?.rows, 0)[0];
  const pageviews = num(now, 1);
  return {
    current: { visitors: num(now, 0), pageviews, secondsOnPage: pageviews ? Math.round(num(now, 2) / pageviews) : 0 },
    previous: { visitors: num(inRange(totals?.rows, 1)[0], 0) },
    series: (series?.rows ?? []).map((r) => ({ key: isoDay(dim(r, 0)), visitors: num(r, 0) })).sort((a, b) => a.key.localeCompare(b.key)),
  };
}

/**
 * A date range in the Analytics page's shape (the same one Simple Analytics
 * gives), so one page serves both providers. "Visitors" are engaged sessions,
 * per page and per source too; the histogram is by day or by calendar month.
 */
export async function ga4Range(range: Range, interval?: 'day' | 'month') {
  const [totals, pages, sources, series] = await batch([
    { dateRanges: [range], metrics: [visits, { name: 'screenPageViews' }, { name: 'userEngagementDuration' }] },
    { dateRanges: [range], dimensions: [{ name: 'pagePath' }], metrics: [{ name: 'screenPageViews' }, visits], limit: 20,
      orderBys: byVisits },
    { dateRanges: [range], dimensions: [{ name: 'sessionSource' }], metrics: [{ name: 'screenPageViews' }, visits], limit: 20,
      orderBys: byVisits },
    ...(interval
      ? [{ dateRanges: [range], dimensions: [{ name: interval === 'month' ? 'yearMonth' : 'date' }], metrics: [{ name: 'screenPageViews' }, visits], limit: 400 }]
      : []),
  ]);
  const total = totals?.rows?.[0];
  const pageviews = num(total, 1);
  const row = (r: Row) => ({ value: dim(r, 0), pageviews: num(r, 0), visitors: num(r, 1) });
  return {
    visitors: num(total, 0),
    pageviews,
    seconds_on_page: pageviews ? Math.round(num(total, 2) / pageviews) : 0,
    pages: (pages?.rows ?? []).map(row),
    referrers: (sources?.rows ?? []).map(row).map((r) => (r.value === '(direct)' ? { ...r, value: 'direct' } : r)),
    // "20260915" → "2026-09-15"; "202609" → "2026-09-01"
    histogram: (series?.rows ?? [])
      .map((r) => ({ ...row(r), date: isoDay(dim(r, 0).padEnd(8, '01')) }))
      .map(({ date, pageviews, visitors }) => ({ date, pageviews, visitors }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}
