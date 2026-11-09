import { useAuth0 } from '@auth0/auth0-vue';

/**
 * The token the dashboard sends to its Netlify functions.
 *
 * We send the Auth0 **ID token**, a JWT signed by the tenant and audienced to
 * this SPA, which the functions verify against the tenant JWKS (see netlify/lib/auth.ts).
 * getAccessTokenSilently() needs a registered Auth0 API (audience); none exists
 * for this tenant, so it fails at runtime — that was the error on Billing,
 * Blog Assist and Support.
 */
export function useAuthToken() {
  const { idTokenClaims, checkSession } = useAuth0();

  return async function authToken(): Promise<string> {
    if (!idTokenClaims.value?.__raw) {
      // Claims are populated after the redirect callback; refresh if a page was
      // opened directly (or the token expired while the tab sat open).
      await checkSession();
    }

    const token = idTokenClaims.value?.__raw;
    if (!token) throw new Error('Your session has expired. Please sign in again.');
    return token;
  };
}
