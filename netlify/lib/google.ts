import { createSign } from 'node:crypto';

/**
 * Signs in to Google as the dashboard's service account.
 *
 * One account serves Google Analytics and PageSpeed (lighthouse.ts); each asks
 * for its own scope, and tokens are cached per scope for the life of the
 * function instance. Ported from the RMWS dashboard.
 *
 * Env:
 *   GA4_CLIENT_EMAIL   the service account's address
 *   GA4_PRIVATE_KEY    its private key, with newlines as \n
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const cache = new Map<string, { value: string; expires: number }>();

export function googleCredentials(): { clientEmail: string; privateKey: string } | null {
  const clientEmail = process.env.GA4_CLIENT_EMAIL;
  const privateKey = process.env.GA4_PRIVATE_KEY?.replace(/\\n/g, '\n');
  return clientEmail && privateKey ? { clientEmail, privateKey } : null;
}

export async function googleAccessToken(
  { clientEmail, privateKey }: { clientEmail: string; privateKey: string },
  scope: string
): Promise<string> {
  const hit = cache.get(scope);
  if (hit && hit.expires > Date.now() + 60_000) return hit.value;

  const now = Math.floor(Date.now() / 1000);
  const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${part({ alg: 'RS256', typ: 'JWT' })}.${part({
    iss: clientEmail,
    scope,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(privateKey, 'base64url');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
  });
  if (!res.ok) throw new Error(`Google sign-in failed (${res.status})`);

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cache.set(scope, { value: data.access_token, expires: Date.now() + data.expires_in * 1000 });
  return data.access_token;
}
