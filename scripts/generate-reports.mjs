// Builds monthly reports by hand: to backfill past months, or to rebuild one.
//
//   npm run reports:generate                     last complete month (dry run)
//   npm run reports:generate -- 2026-09          one month (dry run)
//   npm run reports:generate -- --last 12        the last 12 complete months
//   …add --write to save; an existing month is replaced.
//
// Months before analytics tracking began (config trackingSince) are skipped.
// Saving goes through the Pipeline, so PIPELINE_FUNCTIONS_URL and
// PIPELINE_DASHBOARD_KEY must be in .env. The report code is TypeScript shared
// with the Netlify functions, so it is loaded through Vite, not duplicated.
import { createServer, loadEnv } from 'vite';

const args = process.argv.slice(2);
const write = args.includes('--write');
const lastN = args.includes('--last') ? Number(args[args.indexOf('--last') + 1]) : 0;
const explicit = args.find((a) => /^\d{4}-\d{2}$/.test(a));

Object.assign(process.env, loadEnv('development', process.cwd(), ''), process.env);
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });

try {
  const { buildReport, saveReport, isComplete } = await vite.ssrLoadModule('/netlify/lib/report.ts');
  const { lastCompleteMonth, shiftMonth } = await vite.ssrLoadModule('/netlify/lib/time.ts');

  const latest = lastCompleteMonth();
  const months = (explicit ? [explicit] : Array.from({ length: Math.max(1, lastN) }, (_, i) => shiftMonth(latest, -i)).reverse())
    .filter((m) => isComplete(m) || (console.log(`${m}: skipped, tracking began partway through`), false));

  for (const month of months) {
    const report = await buildReport(month);
    const t = report.traffic;
    console.log(
      `${month}: ${t ? `${t.visits} visits (month before ${t.prevVisits ?? '—'}, last year ${t.lastYearVisits ?? '—'})` : 'no analytics'}, ` +
        `lighthouse ${report.lighthouse ? 'yes' : 'no'}`
    );
    for (const line of report.highlights) console.log(`   · ${line}`);
    if (write) await saveReport(report, true);
  }
  console.log(write ? `\nSaved ${months.length} report(s).` : '\nDry run. Add --write to save.');
} finally {
  await vite.close();
}
