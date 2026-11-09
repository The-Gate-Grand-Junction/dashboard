import { requireUser } from '../lib/auth';
import { pipeline, pipelineConfigured } from '../lib/pipeline';

/**
 * Content Kit, read and saved through the Pipeline (client-content-kit) with
 * this dashboard's key, so the dashboard holds no database credential
 * (OVERVIEW-STANDARD section 4). The Pipeline resolves the client from the
 * key; nothing in the request can name another client.
 *
 * GET                                  → { contentKit: { section: { field: value } }, completedSections, status, completionPct }
 * PUT  { section, data: { field: … } } → saves one section
 */

const reply = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
  body: JSON.stringify(body),
});

export async function handler(event: {
  httpMethod: string;
  headers: Record<string, string>;
  body: string | null;
}) {
  const auth = await requireUser(event);
  if ('statusCode' in auth) return auth;
  if (!pipelineConfigured()) return reply(500, { error: 'The Pipeline connection is not configured' });

  try {
    if (event.httpMethod === 'GET') {
      return reply(200, await pipeline('client-content-kit'));
    }
    if (event.httpMethod !== 'PUT') return reply(405, { error: 'Method not allowed' });

    let body: { section?: unknown; data?: unknown };
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return reply(400, { error: 'Invalid JSON' });
    }
    // Only the section and its fields go upstream; the client comes from the key.
    return reply(200, await pipeline('client-content-kit', { method: 'PUT', body: { section: body.section, data: body.data } }));
  } catch (err) {
    console.error('content-kit failed:', err instanceof Error ? err.message : err);
    return reply(502, { error: 'The Content Kit could not be saved. Please try again.' });
  }
}
