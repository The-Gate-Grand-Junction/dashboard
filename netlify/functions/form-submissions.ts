import { timingSafeEqual } from 'node:crypto';
import { requireUser } from '../lib/auth';
import { pipeline, pipelineConfigured } from '../lib/pipeline';
import { inboxEnabled, kindOf } from '../lib/submissions';
import { localMidnightUtc, localToday } from '../lib/time';

/**
 * The website form inbox (OVERVIEW-STANDARD 3.2, 3.5), stored in the agency
 * database through the Pipeline's client-form-submissions with this
 * dashboard's key. Ported from the RMWS dashboard.
 *
 * Two kinds of caller:
 *
 *   The signed-in client (Auth0, see netlify/lib/auth.ts):
 *     GET     list (?kind=&status=&q=&offset=&all=), ?summary=1, ?id=…, ?file=…
 *     PATCH   { id, status?, notes? }
 *     DELETE  { id }
 *
 *   The client's website, with the write-only FORMS_INTAKE_SECRET in the
 *   `X-Forms-Secret` header (pws-foundation-template send-message.ts):
 *     POST    { formSlug?, formTitle, pagePath?, fields[], files[]?, status?, notes? }
 *
 * The website never holds the dashboard key: the secret can add a submission
 * to this client's inbox and do nothing else.
 */

const reply = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
  body: JSON.stringify(body),
});

/** Query keys passed through to the Pipeline; anything else is dropped. */
const PASS_THROUGH = ['kind', 'status', 'q', 'offset', 'all', 'id', 'file'];

function intakeAllowed(headers: Record<string, string | undefined>): boolean {
  const expected = process.env.FORMS_INTAKE_SECRET;
  const given = headers['x-forms-secret'] || headers['X-Forms-Secret'];
  if (!expected || !given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function handler(event: {
  httpMethod: string;
  headers: Record<string, string>;
  queryStringParameters: Record<string, string> | null;
  body: string | null;
}) {
  if (event.httpMethod === 'POST') {
    if (!intakeAllowed(event.headers)) return reply(401, { error: 'Unauthorized' });
    if (!inboxEnabled() || !pipelineConfigured()) return reply(503, { error: 'Inbox not configured' });

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return reply(400, { error: 'Invalid JSON' });
    }
    const formTitle = String(body.formTitle ?? '').trim();
    if (!formTitle || !Array.isArray(body.fields)) return reply(400, { error: 'Expected { formTitle, fields[] }' });

    try {
      const saved = await pipeline('client-form-submissions', {
        method: 'POST',
        body: {
          kind: kindOf(String(body.formSlug ?? ''), formTitle),
          formSlug: body.formSlug,
          formTitle,
          pagePath: body.pagePath,
          fields: body.fields,
          files: body.files,
          status: body.status === 'archived' ? 'archived' : 'new',
          notes: body.notes,
        },
      });
      return reply(201, saved);
    } catch (err) {
      console.error('form intake failed:', err instanceof Error ? err.message : err);
      return reply(502, { error: 'Could not store the submission' });
    }
  }

  const auth = await requireUser(event);
  if ('statusCode' in auth) return auth;
  if (!inboxEnabled() || !pipelineConfigured()) return reply(200, { configured: false });

  try {
    if (event.httpMethod === 'GET') {
      const query = event.queryStringParameters ?? {};
      const params = new URLSearchParams();
      for (const key of PASS_THROUGH) if (query[key]) params.set(key, query[key]!);
      if (query.summary) {
        params.set('summary', '1');
        // "This month" by the client's calendar, as the stored timestamps are UTC.
        params.set('since', localMidnightUtc(`${localToday().slice(0, 7)}-01`));
      }
      const data = await pipeline(`client-form-submissions${params.size ? `?${params}` : ''}`);
      return reply(200, { configured: true, ...data });
    }

    if (event.httpMethod === 'PATCH' || event.httpMethod === 'DELETE') {
      let body: { id?: unknown; status?: unknown; notes?: unknown };
      try {
        body = JSON.parse(event.body || '{}');
      } catch {
        return reply(400, { error: 'Malformed request.' });
      }
      const data = await pipeline('client-form-submissions', {
        method: event.httpMethod,
        body: event.httpMethod === 'PATCH' ? { id: body.id, status: body.status, notes: body.notes } : { id: body.id },
      });
      return reply(200, data);
    }

    return reply(405, { error: 'Method not allowed' });
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    console.error('form-submissions failed:', message);
    // The Pipeline's own 400/404 messages are written for the client; pass them on.
    const upstream = message.match(/returned (400|404): (.+)$/);
    if (upstream) return reply(Number(upstream[1]), { error: upstream[2] });
    return reply(502, { error: 'Something went wrong. Please try again.' });
  }
}
