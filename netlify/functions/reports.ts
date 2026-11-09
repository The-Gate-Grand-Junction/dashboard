import { requireUser } from '../lib/auth';
import { pipeline, pipelineConfigured } from '../lib/pipeline';

/**
 * Reads the stored monthly reports, through the Pipeline (see ../lib/pipeline.ts).
 *
 *   GET              the newest report, the months available, and the web
 *                    team's published notes for that month
 *   GET ?month=…     a particular month (YYYY-MM)
 */
const MONTH = /^\d{4}-\d{2}$/;
const reply = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
  body: JSON.stringify(body),
});

export async function handler(event: { headers: Record<string, string>; queryStringParameters: Record<string, string> | null }) {
  const auth = await requireUser(event);
  if ('statusCode' in auth) return auth;
  if (!pipelineConfigured()) return reply(200, { configured: false });

  const month = event.queryStringParameters?.month ?? '';
  try {
    const data = await pipeline(`client-site-data?resource=reports${MONTH.test(month) ? `&month=${month}` : ''}`);
    return reply(200, { configured: true, ...data });
  } catch (err) {
    console.error('reports failed:', err instanceof Error ? err.message : err);
    return reply(502, { error: 'The report could not be loaded. Please try again.' });
  }
}
