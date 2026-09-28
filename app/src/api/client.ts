// HTTP-client voor hal-agent en hal-shell. Stuurt altijd de drie headers mee en vertaalt fouten.
import { demoRequest } from '@/demo';
import { lang, t } from '@/i18n';
import { connectionStore, serverName, type Connection, normalizeBase, validateUrl } from '@/state/settings';

export type ErrorKind =
  | 'offline'
  | 'timeout'
  | 'unauthorized'
  | 'access_denied'
  | 'access_not_configured'
  | 'rate_limited'
  | 'not_found'
  | 'invalid'
  | 'conflict'
  | 'forbidden'
  | 'server'
  | 'insecure_url'
  | 'not_configured';

export class ApiError extends Error {
  constructor(
    public readonly kind: ErrorKind,
    message: string,
    public readonly status?: number,
    public readonly retryAfter?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type Target = 'api' | 'shell';

interface BodyLike {
  code?: string;
  message?: string;
}

/** Zet een HTTP-antwoord om naar een ApiError. Los geëxporteerd zodat het getest kan worden. */
export function mapHttpError(status: number, body: BodyLike | null, contentType: string | null, retryAfterHeader: string | null): ApiError {
  const isJson = (contentType ?? '').includes('application/json');
  const code = body?.code;
  const msg = body?.message;
  if (!isJson && (status === 200 || status === 302 || status === 401 || status === 403)) {
    // Cloudflare Access antwoordt met een HTML-loginpagina of redirect als het service token niet klopt.
    return new ApiError('access_denied', t.errors.accessDenied, status);
  }
  switch (status) {
    case 401:
      return new ApiError('unauthorized', t.errors.unauthorized, status);
    case 403:
      if (code === 'access_denied') return new ApiError('access_denied', t.errors.accessDenied, status);
      return new ApiError('forbidden', msg ?? t.errors.generic, status);
    case 404:
      return new ApiError('not_found', msg ?? t.errors.notFound, status);
    case 409:
      return new ApiError('conflict', msg ?? t.errors.generic, status);
    case 413:
    case 400:
    case 422:
      return new ApiError('invalid', msg ?? t.errors.invalid, status);
    case 429: {
      const s = Math.max(1, parseInt(retryAfterHeader ?? '5', 10) || 5);
      return new ApiError('rate_limited', t.errors.rateLimited(s), status, s);
    }
    case 503:
      if (code === 'access_not_configured') return new ApiError('access_not_configured', t.errors.accessNotConfigured, status);
      return new ApiError('server', msg ?? t.errors.server, status);
    default:
      if (status >= 500) return new ApiError('server', msg ?? t.errors.server, status);
      return new ApiError('server', msg ?? t.errors.generic, status);
  }
}

export function baseUrl(conn: Connection, target: Target): string {
  return normalizeBase(target === 'api' ? conn.apiUrl : conn.shellUrl);
}

export function authHeaders(conn: Connection, target: Target): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${target === 'api' ? conn.agentToken : conn.shellToken}`,
    Accept: 'application/json',
    'Accept-Language': lang,
  };
  if (conn.cfId) h['CF-Access-Client-Id'] = conn.cfId;
  if (conn.cfSecret) h['CF-Access-Client-Secret'] = conn.cfSecret;
  return h;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
  target?: Target;
  raw?: boolean;
  conn?: Connection;
}

export function buildUrl(base: string, path: string, query?: RequestOptions['query']): string {
  const qs = Object.entries(query ?? {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return `${base}${path}${qs ? `?${qs}` : ''}`;
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const conn = opts.conn ?? connectionStore.get();
  const target = opts.target ?? 'api';
  if (conn.demo) {
    // Demo-modus: geen netwerk, voorbeeldgegevens uit de app zelf.
    const out = await demoRequest(target, path, opts.method ?? 'GET', opts.query ?? {}, opts.body);
    if (out === undefined) throw new ApiError('not_found', t.errors.notFound, 404);
    return out as T;
  }
  const token = target === 'api' ? conn.agentToken : conn.shellToken;
  const base = baseUrl(conn, target);
  if (!base || !token) throw new ApiError('not_configured', t.errors.notConfigured);
  const urlProblem = validateUrl(base);
  if (urlProblem) throw new ApiError('insecure_url', t.errors.insecureUrl);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15000);
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onAbort);
  const headers = authHeaders(conn, target);
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(buildUrl(base, path, opts.query), {
      method: opts.method ?? 'GET',
      headers,
      body,
      signal: controller.signal,
      credentials: 'omit',
    });
  } catch (e) {
    const aborted = controller.signal.aborted && !opts.signal?.aborted;
    if (opts.signal?.aborted) throw e;
    throw aborted ? new ApiError('timeout', t.errors.timeout) : new ApiError('offline', t.errors.offline(serverName(conn)));
  } finally {
    clearTimeout(timeout);
    opts.signal?.removeEventListener('abort', onAbort);
  }
  const contentType = res.headers.get('content-type');
  if (res.ok && (contentType ?? '').includes('application/json')) {
    return (await res.json()) as T;
  }
  if (res.ok && opts.raw) {
    return (await res.text()) as unknown as T;
  }
  let parsed: BodyLike | null = null;
  if ((contentType ?? '').includes('application/json')) {
    try {
      parsed = (await res.json()) as BodyLike;
    } catch {
      parsed = null;
    }
  }
  throw mapHttpError(res.status, parsed, contentType, res.headers.get('retry-after'));
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query'], opts?: RequestOptions) => request<T>(path, { ...opts, query }),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>(path, { ...opts, method: 'POST', body: body ?? {} }),
  shellGet: <T>(path: string, query?: RequestOptions['query']) => request<T>(path, { target: 'shell', query }),
  shellSend: <T>(method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, query?: RequestOptions['query']) =>
    request<T>(path, { target: 'shell', method, body, query, timeoutMs: 30000 }),
};

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return t.errors.generic;
}
