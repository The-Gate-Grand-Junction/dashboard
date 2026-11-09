import { requireUser } from '../lib/auth';
import { findLighthouse } from '../lib/lighthouse';
import { pipelineConfigured } from '../lib/pipeline';

/** The most recent Lighthouse test, for the overview's Site health card. */
export async function handler(event: { headers: Record<string, string> }) {
  const auth = await requireUser(event);
  if ('statusCode' in auth) return auth;

  const reply = (statusCode: number, body: unknown) => ({
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
    body: JSON.stringify(body),
  });
  if (!pipelineConfigured()) return reply(200, { lighthouse: null });

  try {
    return reply(200, { lighthouse: await findLighthouse() });
  } catch (err) {
    console.error('site-health failed:', err instanceof Error ? err.message : err);
    return reply(502, { error: 'Site health could not be loaded.' });
  }
}
