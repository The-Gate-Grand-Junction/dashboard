import type { LighthouseCheck, LighthouseResult, Rating } from '../../src/types/report';
import config from '../../src/config/dashboard';
import { pipeline } from './pipeline';
import { googleAccessToken, googleCredentials } from './google';

/**
 * Google Lighthouse scores for the live homepage, through the PageSpeed
 * Insights API, on a phone and on a computer.
 *
 * Google refuses anonymous PageSpeed requests (the keyless allowance is shared
 * by everyone and always spent): an API key, or the GA4 service account
 * (PageSpeed Insights API enabled in its Google Cloud project; only the
 * `openid` scope is needed — RMWS works this way).
 *
 * Env: PSI_API_KEY or GA4_CLIENT_EMAIL + GA4_PRIVATE_KEY; optional LIGHTHOUSE_URL (defaults to the homepage)
 *
 * Each test takes Google 10–20 seconds and a scheduled function gets 30, so
 * the two run side by side and anything still running near the limit is
 * dropped rather than losing the one that finished.
 */

type Strategy = LighthouseResult['strategy'];

/** Google's own thresholds: good up to the first, poor beyond the second. */
const THRESHOLDS = {
  lcp: [2500, 4000],
  cls: [0.1, 0.25],
  tbt: [200, 600],
} as const;

const TIME_LIMIT_MS = 26_000;

const rate = (value: number, [good, poor]: readonly [number, number]): Rating =>
  value <= good ? 'good' : value <= poor ? 'needs-work' : 'poor';

export const lighthouseConfigured = () => Boolean(process.env.PSI_API_KEY || googleCredentials());

/** The API key if one is set; otherwise the service account as a bearer token. */
async function authorize(params: URLSearchParams): Promise<Record<string, string>> {
  if (process.env.PSI_API_KEY) {
    params.set('key', process.env.PSI_API_KEY);
    return {};
  }
  const credentials = googleCredentials();
  if (!credentials) throw new Error('No PSI_API_KEY or Google service account');
  return { Authorization: `Bearer ${await googleAccessToken(credentials, 'openid')}` };
}
export const lighthouseUrl = () => process.env.LIGHTHOUSE_URL || `https://${config.clientDomain}/`;

async function run(url: string, strategy: Strategy, signal: AbortSignal): Promise<LighthouseResult> {
  const params = new URLSearchParams({ url, strategy });
  for (const category of ['performance', 'accessibility', 'best-practices', 'seo']) params.append('category', category);

  const headers = await authorize(params);
  const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`, { signal, headers });
  if (!res.ok) throw new Error(`PageSpeed ${strategy} ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const data = (await res.json()) as {
    lighthouseResult?: {
      categories?: Record<string, { score: number | null }>;
      audits?: Record<string, { numericValue?: number }>;
    };
  };
  const lh = data.lighthouseResult;
  if (!lh?.categories) throw new Error(`PageSpeed ${strategy}: no Lighthouse result`);

  const score = (id: string) => Math.round((lh.categories?.[id]?.score ?? 0) * 100);
  const audit = (id: string) => lh.audits?.[id]?.numericValue ?? 0;
  const lcp = Math.round(audit('largest-contentful-paint'));
  const cls = Math.round(audit('cumulative-layout-shift') * 1000) / 1000;
  const tbt = Math.round(audit('total-blocking-time'));

  return {
    strategy,
    scores: {
      performance: score('performance'),
      accessibility: score('accessibility'),
      bestPractices: score('best-practices'),
      seo: score('seo'),
    },
    metrics: {
      lcp: { value: lcp, rating: rate(lcp, THRESHOLDS.lcp) },
      cls: { value: cls, rating: rate(cls, THRESHOLDS.cls) },
      tbt: { value: tbt, rating: rate(tbt, THRESHOLDS.tbt) },
    },
  };
}

/** Tests the homepage on a phone and a computer. Null only when neither finished. */
export async function runLighthouse(): Promise<LighthouseCheck | null> {
  if (!lighthouseConfigured()) return null;
  const url = lighthouseUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIME_LIMIT_MS);

  const settle = (strategy: Strategy) =>
    run(url, strategy, controller.signal).catch((err) => {
      console.error(`Lighthouse ${strategy} failed:`, err instanceof Error ? err.message : err);
      return null;
    });

  try {
    const [mobile, desktop] = await Promise.all([settle('mobile'), settle('desktop')]);
    if (!mobile && !desktop) return null;
    return { url, checkedAt: new Date().toISOString(), mobile, desktop };
  } finally {
    clearTimeout(timer);
  }
}

export async function saveLighthouse(check: LighthouseCheck): Promise<void> {
  await pipeline('client-site-data?resource=lighthouse', { method: 'POST', body: { checkedAt: check.checkedAt, data: check } });
}

/** The earliest check between two dates (YYYY-MM-DD, inclusive), or the newest of all without them. */
export async function findLighthouse(range?: { from: string; to: string }): Promise<LighthouseCheck | null> {
  const query = range ? `&from=${range.from}&to=${range.to}` : '';
  const { lighthouse } = await pipeline<{ lighthouse: LighthouseCheck | null }>(`client-site-data?resource=lighthouse${query}`);
  return lighthouse;
}
