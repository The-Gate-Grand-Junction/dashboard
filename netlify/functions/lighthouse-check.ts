import { findLighthouse, lighthouseConfigured, runLighthouse, saveLighthouse } from '../lib/lighthouse';
import { pipelineConfigured } from '../lib/pipeline';
import { localToday } from '../lib/time';

/**
 * Tests the live homepage with Google Lighthouse, once a month
 * (OVERVIEW-STANDARD 6.1). That test is the one the month's own report shows,
 * so each report reflects the site going into its month.
 *
 * Runs daily from the 2nd until the month has a test on both a phone and a
 * computer: Google's test occasionally fails to load a page, and a run that
 * finished only one device is completed by a later one.
 *
 * Scheduled functions run only on the published production deploy.
 */
export default async () => {
  if (!lighthouseConfigured() || !pipelineConfigured()) {
    console.log('Lighthouse check skipped: PSI_API_KEY or the Pipeline connection is not set.');
    return new Response('not configured');
  }

  const today = localToday();
  const existing = await findLighthouse({ from: `${today.slice(0, 7)}-01`, to: today });
  if (existing?.mobile && existing?.desktop) return new Response('done for this month');

  const check = await runLighthouse();
  if (!check) return new Response('no result', { status: 502 });
  await saveLighthouse(check);
  console.log(`Lighthouse: phone ${check.mobile?.scores.performance ?? '—'}, computer ${check.desktop?.scores.performance ?? '—'}`);
  return new Response('saved');
};

// 14:00 UTC, daily from the 2nd.
export const config = { schedule: '0 14 2-31 * *' };
