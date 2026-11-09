import { clientTimeZone } from './time';

/**
 * Simple Analytics, read server-side so the API key never reaches the browser.
 * The hostname is pinned in env, never taken from a request.
 *
 * Its visitor count already leaves out bots and crawlers, so it is used as is
 * for "visits" (OVERVIEW-STANDARD 4.2).
 *
 * Env: SIMPLE_ANALYTICS_API_KEY, ANALYTICS_HOSTNAME
 */

export interface SaRow {
  value: string;
  pageviews: number;
  visitors: number;
}

export interface SaResult {
  visitors?: number;
  pageviews?: number;
  seconds_on_page?: number;
  histogram?: { date: string; visitors: number; pageviews: number }[];
  pages?: SaRow[];
  referrers?: SaRow[];
  device_types?: SaRow[];
}

export const analyticsConfigured = () => Boolean(process.env.SIMPLE_ANALYTICS_API_KEY && process.env.ANALYTICS_HOSTNAME);

/**
 * One request for a date range (YYYY-MM-DD, both inclusive) in the client's
 * timezone. `interval` buckets the histogram by day (the default) or month.
 */
export async function saRange(
  start: string,
  end: string,
  fields: string[],
  limit?: number,
  interval?: 'day' | 'month',
): Promise<SaResult> {
  const apiKey = process.env.SIMPLE_ANALYTICS_API_KEY;
  const hostname = process.env.ANALYTICS_HOSTNAME;
  if (!apiKey || !hostname) throw new Error('Simple Analytics is not configured');

  const params = new URLSearchParams({
    version: '5',
    start,
    end,
    timezone: clientTimeZone(),
    info: 'false',
    fields: fields.join(','),
    ...(limit ? { limit: String(limit) } : {}),
    ...(interval ? { interval } : {}),
  });
  const res = await fetch(`https://simpleanalytics.com/${encodeURIComponent(hostname)}.json?${params}`, {
    headers: { 'Api-Key': apiKey },
  });
  if (!res.ok) throw new Error(`Simple Analytics API returned ${res.status}`);
  return res.json() as Promise<SaResult>;
}
