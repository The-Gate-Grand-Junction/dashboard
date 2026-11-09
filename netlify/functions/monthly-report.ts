import { buildReport, isComplete, saveReport, storedMonths } from '../lib/report';
import { pipelineConfigured } from '../lib/pipeline';
import { lastCompleteMonth } from '../lib/time';

/**
 * Writes last month's report, once (OVERVIEW-STANDARD 6.1).
 *
 * Runs daily from the 3rd until the month has a report, so a failed run is
 * picked up the next day without anyone running a script; each run exits
 * straight away once the month exists. The 3rd rather than the 1st lets the
 * month's last days settle. To rebuild a month on purpose, use
 * `npm run reports:generate -- <YYYY-MM> --write`.
 *
 * Scheduled functions run only on the published production deploy.
 */
export default async () => {
  if (!pipelineConfigured()) {
    console.error('Monthly report skipped: PIPELINE_FUNCTIONS_URL / PIPELINE_DASHBOARD_KEY not set.');
    return new Response('not configured', { status: 500 });
  }

  const month = lastCompleteMonth();
  if (!isComplete(month)) return new Response('tracking began mid-month; no report');
  if ((await storedMonths()).includes(month)) return new Response('exists');

  const report = await buildReport(month);
  const written = await saveReport(report);
  console.log(`Monthly report ${month} ${written ? 'written' : 'already existed'}.`);
  return new Response(written ? 'written' : 'exists');
};

// 14:00 UTC (early morning in Colorado), daily from the 3rd.
export const config = { schedule: '0 14 3-31 * *' };
