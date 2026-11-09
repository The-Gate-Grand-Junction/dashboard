/**
 * Calls the agency Pipeline Dashboard as this client.
 *
 * Reports, site checks and invoices live in the agency database. This
 * dashboard holds no credential for that database: it sends its own
 * dashboard key, and the Pipeline resolves which client is calling from the
 * key, so nothing here can reach another client's rows.
 *
 * Env: PIPELINE_FUNCTIONS_URL (https://…/.netlify/functions), PIPELINE_DASHBOARD_KEY
 */
export const pipelineConfigured = () => Boolean(process.env.PIPELINE_FUNCTIONS_URL && process.env.PIPELINE_DASHBOARD_KEY);

export async function pipeline<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const base = process.env.PIPELINE_FUNCTIONS_URL;
  const key = process.env.PIPELINE_DASHBOARD_KEY;
  if (!base || !key) throw new Error('The Pipeline connection is not configured');

  const res = await fetch(`${base.replace(/\/$/, '')}/${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${key}`,
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const data = await res.json().catch(() => null);
  const name = path.split('?')[0];
  if (!res.ok) throw new Error(`Pipeline ${name} returned ${res.status}${data?.error ? `: ${data.error}` : ''}`);
  // An undeployed function falls through to the Pipeline's app shell: HTML with a 200.
  if (!data || typeof data !== 'object') throw new Error(`Pipeline ${name} gave an unexpected response (is it deployed?)`);
  return data as T;
}
