// HTTP client for the Garment Studio API (ADR-0010/0011).
// - The access token lives in memory only; the refresh token is an HttpOnly cookie the browser sends to
//   /v1/auth/refresh together with the CSRF header (double submit).
// - Refreshes are serialised across tabs with the Web Locks API: two tabs refreshing with the same
//   cookie would look like token theft to the server and sign both out (ADR-0019 §3).

/** API base: absolute (separate API host) or a path on this origin (e.g. "/v1" behind one proxy). */
export const API_URL = new URL(
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:4000/v1',
  typeof location === 'undefined' ? 'http://localhost' : location.origin,
).href.replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** The API could not be reached (offline, DNS, server down). Local work continues. */
export class OfflineError extends Error {
  constructor() {
    super('The cloud service could not be reached');
  }
}

let accessToken: string | null = null;
let onTokenChange: ((token: string | null) => void) | null = null;

export function setAccessToken(t: string | null): void {
  accessToken = t;
  onTokenChange?.(t);
}
export const getAccessToken = () => accessToken;
export function watchToken(fn: (token: string | null) => void): void {
  onTokenChange = fn;
}

function csrfToken(): string | null {
  const m = /(?:^|;\s*)gs_csrf=([^;]+)/.exec(document.cookie);
  return m?.[1] ? decodeURIComponent(m[1]) : (sessionStorage.getItem('gs:csrf') ?? null);
}

export function rememberCsrf(token: string | undefined): void {
  if (token) sessionStorage.setItem('gs:csrf', token);
}

async function raw(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json');
  if (init.auth !== false && accessToken) headers.set('authorization', `Bearer ${accessToken}`);
  try {
    return await fetch(`${API_URL}${path}`, { ...init, headers, credentials: 'include' });
  } catch {
    throw new OfflineError();
  }
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204 || res.status === 202 && res.headers.get('content-length') === '0') return undefined as T;
  const text = await res.text();
  const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) {
    throw new ApiError(res.status, String(body.code ?? `http_${res.status}`), String(body.title ?? res.statusText), body);
  }
  return body as T;
}

let refreshing: Promise<boolean> | null = null;

/** Exchange the refresh cookie for a new access token. Resolves false when there is no valid session. */
export function refresh(): Promise<boolean> {
  refreshing ??= (async () => {
    const run = async () => {
      const csrf = csrfToken();
      if (!csrf) return false;
      const res = await raw('/auth/refresh', { method: 'POST', auth: false, headers: { 'x-csrf-token': csrf } });
      if (res.status === 401 || res.status === 403) {
        setAccessToken(null);
        return false;
      }
      const body = await parse<{ accessToken: string; csrfToken?: string }>(res);
      rememberCsrf(body.csrfToken);
      setAccessToken(body.accessToken);
      return true;
    };
    try {
      return navigator.locks ? await navigator.locks.request('gs-auth-refresh', run) : await run();
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** JSON request with the access token; a 401 triggers one refresh and a retry. */
export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string>; auth?: boolean } = {},
): Promise<T> {
  const req = () =>
    raw(path, {
      method: init.method ?? 'GET',
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      ...(init.headers ? { headers: init.headers } : {}),
      ...(init.auth === false ? { auth: false } : {}),
    });
  let res = await req();
  if (res.status === 401 && init.auth !== false && (await refresh())) res = await req();
  return parse<T>(res);
}

/** Like `api`, but returns the response for conditional requests (304) and headers. */
export async function apiResponse(path: string, headers: Record<string, string> = {}): Promise<Response> {
  let res = await raw(path, { headers });
  if (res.status === 401 && (await refresh())) res = await raw(path, { headers });
  return res;
}

export { parse as parseResponse };
