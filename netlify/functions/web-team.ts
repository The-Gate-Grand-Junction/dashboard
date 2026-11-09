import { requireUser } from '../lib/auth';
import { pipeline, pipelineConfigured } from '../lib/pipeline';

/**
 * "From your web team" on the Overview: the web team's latest published
 * monthly note and the date of the next maintenance day on the agency
 * calendar, read through the Pipeline's client-web-team with this client's
 * dashboard key (so no database credential lives here).
 *
 * Env: PIPELINE_FUNCTIONS_URL, PIPELINE_DASHBOARD_KEY
 *
 * Unconfigured, it answers { configured: false } and the Overview leaves the
 * card out.
 */

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=300' };

export async function handler(event: { headers: Record<string, string> }) {
  const auth = await requireUser(event);
  if ('statusCode' in auth) return auth;

  if (!pipelineConfigured()) {
    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ configured: false }) };
  }

  try {
    const { note, nextVisit } = await pipeline<{ note: unknown; nextVisit: string | null }>('client-web-team');
    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ configured: true, note, nextVisit }) };
  } catch (err) {
    console.error('web-team failed:', err instanceof Error ? err.message : err);
    return { statusCode: 502, body: JSON.stringify({ error: 'Your web team’s notes could not be loaded.' }) };
  }
}
