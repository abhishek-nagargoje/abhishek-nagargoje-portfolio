/** Thin fetch wrapper: same-origin cookies, CSRF header, typed errors. No fake fallbacks. */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

let csrfToken: string | null = null;
export const setCsrfToken = (t: string | null) => {
  csrfToken = t;
};

type Listener = (code: 'UNAUTHENTICATED' | 'PASSWORD_CHANGE_REQUIRED') => void;
const listeners = new Set<Listener>();
export function onAuthProblem(l: Listener) {
  listeners.add(l);
  return () => void listeners.delete(l);
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError('The server could not be reached. Check your connection and try again.', 0, 'NETWORK');
  }
  if (res.status === 204) return undefined as T;
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON response */
  }
  if (!res.ok) {
    const err = (data as { error?: { message?: string; code?: string; details?: unknown } } | null)?.error;
    const e = new ApiError(err?.message ?? `Request failed (${res.status}).`, res.status, err?.code, err?.details);
    if (res.status === 401 && !path.startsWith('/auth/')) listeners.forEach((l) => l('UNAUTHENTICATED'));
    if (e.code === 'PASSWORD_CHANGE_REQUIRED') listeners.forEach((l) => l('PASSWORD_CHANGE_REQUIRED'));
    throw e;
  }
  return data as T;
}

export const post = <T>(path: string, body: unknown = {}, idempotencyKey?: string) =>
  api<T>(path, { method: 'POST', body, idempotencyKey });
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body });
export const put = <T>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body });

/** Build a query string, skipping empty values. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
}

export const newIdempotencyKey = () => crypto.randomUUID();
