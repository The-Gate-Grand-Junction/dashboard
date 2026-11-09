import config from '../../src/config/dashboard';
import { googleAccessToken, googleCredentials } from './google';
import { monthBounds, shiftMonth } from './time';

/**
 * Google search for the monthly report: clicks, times shown, average position
 * and the top searches, from Search Console (ported from the RMWS dashboard).
 *
 * Works for any analytics provider: it uses the dashboard's Google service
 * account (netlify/lib/google.ts), which needs to be added as a user on the
 * site's Search Console property. Until it has access the report simply has no
 * Google search section.
 *
 * Env: GA4_CLIENT_EMAIL + GA4_PRIVATE_KEY (the service account),
 *      GSC_SITE_URL (optional: "sc-domain:example.com" or
 *      "https://example.com/"; otherwise found from the client's domain)
 */

export const searchConsoleConfigured = () => Boolean(googleCredentials());

export async function searchConsoleMonth(month: string) {
  const credentials = googleCredentials();
  if (!credentials) return null;

  const token = await googleAccessToken(credentials, 'https://www.googleapis.com/auth/webmasters.readonly');
  const api = 'https://www.googleapis.com/webmasters/v3';

  let site = process.env.GSC_SITE_URL;
  if (!site) {
    const res = await fetch(`${api}/sites`, { headers: { Authorization: `Bearer ${token}` } });
    // No access yet is normal until the client grants it; the report goes without
    if (!res.ok) return null;
    const { siteEntry = [] } = (await res.json()) as { siteEntry?: { siteUrl: string; permissionLevel: string }[] };
    const domain = config.clientDomain.replace(/^www\./, '');
    const usable = siteEntry.filter((s) => s.permissionLevel !== 'siteUnverifiedUser' && s.siteUrl.includes(domain));
    // A domain property covers www and every protocol, so it's preferred
    site = usable.find((s) => s.siteUrl.startsWith('sc-domain:'))?.siteUrl ?? usable[0]?.siteUrl;
  }
  if (!site) return null;

  type SearchRow = { keys?: string[]; clicks: number; impressions: number; position: number };
  const query = async (m: string, dimensions?: string[]) => {
    const { start, end } = monthBounds(m);
    const res = await fetch(`${api}/sites/${encodeURIComponent(site!)}/searchAnalytics/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate: start, endDate: end, ...(dimensions ? { dimensions, rowLimit: 10 } : {}) }),
    });
    if (!res.ok) throw new Error(`Search Console ${res.status}`);
    return ((await res.json()) as { rows?: SearchRow[] }).rows ?? [];
  };

  const [now, before, terms] = await Promise.all([query(month), query(shiftMonth(month, -1)), query(month, ['query'])]);
  return {
    clicks: now[0]?.clicks ?? 0,
    impressions: now[0]?.impressions ?? 0,
    position: now[0] ? Math.round(now[0].position * 10) / 10 : null,
    prevClicks: before[0]?.clicks ?? 0,
    queries: terms.map((r) => ({
      query: r.keys?.[0] ?? '',
      clicks: r.clicks,
      impressions: r.impressions,
      position: Math.round(r.position * 10) / 10,
    })),
  };
}
