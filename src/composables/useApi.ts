import { useAuthToken } from '@/composables/useAuthToken';

/**
 * One way to call the dashboard's Netlify functions.
 *
 * Handles the case where the response isn't JSON at all. On a plain `vite` dev
 * server /.netlify/functions/* falls through to the SPA shell — HTML with a 200 —
 * so res.json() threw "JSON.parse: unexpected character at line 1 column 1",
 * which says nothing about the real problem. In production the same thing
 * happens when a function crashes and Netlify returns an HTML error page.
 */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, headers, ...rest } = options;

  const res = await fetch(path, {
    ...rest,
    headers: {
      ...(rest.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });

  const body = await res.text();
  let data: any = null;
  try {
    data = body ? JSON.parse(body) : null;
  } catch {
    if (import.meta.env.DEV) {
      throw new ApiError(
        'The dashboard functions are not running. Start the dev server with `npm run dev` (netlify dev), not `vite`.',
        res.status,
      );
    }
    throw new ApiError('The server returned an unexpected response. Please try again.', res.status);
  }

  if (!res.ok) {
    if (res.status === 401) throw new ApiError('Your session has expired. Please sign in again.', 401);
    if (res.status === 403) throw new ApiError("This account doesn't have access to the dashboard.", 403);
    throw new ApiError(data?.error || `Request failed (${res.status})`, res.status);
  }

  return data as T;
}

/**
 * Calls one of the dashboard's functions by name as the signed-in user and
 * returns the raw Response (for pages that read status and body themselves).
 * Call from `setup`, like any composable.
 */
export function useApi() {
  const authToken = useAuthToken();
  return async function api(name: string, init: RequestInit = {}): Promise<Response> {
    const token = await authToken();
    return fetch(`/.netlify/functions/${name}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
    });
  };
}
