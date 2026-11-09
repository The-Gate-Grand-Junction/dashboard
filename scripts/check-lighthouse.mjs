// Runs Google Lighthouse on the live homepage now.
//
//   npm run lighthouse:check                 print the scores (dry run)
//   npm run lighthouse:check -- --write      also save them, as this month's test
//
// Needs PSI_API_KEY (or the GA4 service account) in .env; saving also needs the Pipeline connection.
import { createServer, loadEnv } from 'vite';

const write = process.argv.includes('--write');
Object.assign(process.env, loadEnv('development', process.cwd(), ''), process.env);
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });

try {
  const { runLighthouse, saveLighthouse, lighthouseConfigured, lighthouseUrl } = await vite.ssrLoadModule('/netlify/lib/lighthouse.ts');
  if (!lighthouseConfigured()) throw new Error('Set PSI_API_KEY (or GA4_CLIENT_EMAIL + GA4_PRIVATE_KEY) in .env');

  console.log(`Testing ${lighthouseUrl()} …`);
  const check = await runLighthouse();
  if (!check) throw new Error('Neither test finished. See the errors above.');
  for (const run of [check.mobile, check.desktop].filter(Boolean)) {
    const s = run.scores;
    console.log(`${run.strategy.padEnd(8)} speed ${s.performance}, accessibility ${s.accessibility}, best practices ${s.bestPractices}, search ${s.seo}`);
  }
  if (write) {
    await saveLighthouse(check);
    console.log('Saved.');
  } else {
    console.log('Dry run. Add --write to save.');
  }
} finally {
  await vite.close();
}
