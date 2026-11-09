import { createRemoteJWKSet, jwtVerify } from 'jose';

/**
 * Shared auth gate for every dashboard function.
 *
 * Replaces the old "an Authorization header exists" check, which any caller
 * could satisfy with a made-up value. We verify the Auth0 ID token (a JWT the
 * SPA already holds) against the tenant's public keys: signature, issuer,
 * audience (= the SPA client id) and expiry.
 *
 * Optional AUTH0_ALLOWED_EMAILS (comma separated) restricts access to named
 * accounts, so a stray signup in the tenant can't reach client data.
 *
 * Env: AUTH0_DOMAIN, AUTH0_CLIENT_ID, optional AUTH0_ALLOWED_EMAILS.
 */

export interface AuthedUser {
  sub: string;
  email?: string;
}

export interface AuthFailure {
  statusCode: number;
  body: string;
}

const domain = () => (process.env.AUTH0_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/$/, '');

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function keyStore() {
  if (!jwks) jwks = createRemoteJWKSet(new URL(`https://${domain()}/.well-known/jwks.json`));
  return jwks;
}

const deny = (message: string, statusCode = 401): AuthFailure => ({
  statusCode,
  body: JSON.stringify({ error: message }),
});

/**
 * Returns the verified user, or an AuthFailure to return from the handler.
 * Call as: const auth = await requireUser(event); if ('statusCode' in auth) return auth;
 */
export async function requireUser(event: {
  headers: Record<string, string | undefined>;
}): Promise<AuthedUser | AuthFailure> {
  const clientId = process.env.AUTH0_CLIENT_ID;
  if (!domain() || !clientId) {
    console.error('Auth not configured: AUTH0_DOMAIN and AUTH0_CLIENT_ID are required.');
    return deny('Auth not configured', 500);
  }

  const header = event.headers?.['authorization'] || event.headers?.['Authorization'];
  const token = header?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return deny('Unauthorized');

  try {
    const { payload } = await jwtVerify(token, keyStore(), {
      issuer: `https://${domain()}/`,
      audience: clientId,
    });

    const allowed = (process.env.AUTH0_ALLOWED_EMAILS || '')
      .split(',')
      .map(entry => entry.trim().toLowerCase())
      .filter(Boolean);
    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : undefined;

    if (allowed.length && (!email || !allowed.includes(email))) {
      return deny('Forbidden', 403);
    }

    return { sub: String(payload.sub), email };
  } catch (err) {
    console.warn('Token rejected:', err instanceof Error ? err.message : err);
    return deny('Unauthorized');
  }
}
