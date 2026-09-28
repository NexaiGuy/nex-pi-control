import { ApiError, authHeaders, buildUrl, mapHttpError, request } from '@/api/client';
import { DEFAULT_CONNECTION, type Connection } from '@/state/settings';

const conn: Connection = { ...DEFAULT_CONNECTION, apiUrl: 'https://pi.example.com', shellUrl: 'https://pi.example.com:8443', cfId: 'id.access', cfSecret: 'geheim', agentToken: 'a'.repeat(48), shellToken: 's'.repeat(48) };

describe('mapHttpError', () => {
  const json = 'application/json';
  test.each([
    [401, { code: 'unauthorized' }, json, 'unauthorized'],
    [403, { code: 'access_denied' }, json, 'access_denied'],
    [403, { code: 'forbidden', message: 'Deze dienst staat niet in allowed-actions.yml' }, json, 'forbidden'],
    [404, null, json, 'not_found'],
    [409, { message: 'gewijzigd' }, json, 'conflict'],
    [422, { code: 'invalid_input' }, json, 'invalid'],
    [500, null, json, 'server'],
    [502, null, 'text/html', 'server'],
    [503, { code: 'access_not_configured' }, json, 'access_not_configured'],
    [200, null, 'text/html', 'access_denied'],
    [403, null, 'text/html; charset=utf-8', 'access_denied'],
  ])('%i %j %s -> %s', (status, body, ct, kind) => {
    expect(mapHttpError(status, body as never, ct, null).kind).toBe(kind);
  });

  test('429 geeft retryAfter door', () => {
    const e = mapHttpError(429, { code: 'rate_limited' }, json, '17');
    expect(e.kind).toBe('rate_limited');
    expect(e.retryAfter).toBe(17);
    expect(e.message).toContain('17');
  });

  test('servermelding wordt getoond bij forbidden', () => {
    expect(mapHttpError(403, { code: 'forbidden', message: 'Niet toegelaten' }, json, null).message).toBe('Niet toegelaten');
  });
});

describe('headers en url', () => {
  test('stuurt de drie sloten mee', () => {
    const h = authHeaders(conn, 'api');
    expect(h.Authorization).toBe(`Bearer ${'a'.repeat(48)}`);
    expect(h['CF-Access-Client-Id']).toBe('id.access');
    expect(h['CF-Access-Client-Secret']).toBe('geheim');
    expect(authHeaders(conn, 'shell').Authorization).toBe(`Bearer ${'s'.repeat(48)}`);
  });

  test('buildUrl encodeert en laat lege waarden weg', () => {
    expect(buildUrl('https://x', '/v1/files/list', { path: '/home/pi/a b', empty: '', n: null })).toBe('https://x/v1/files/list?path=%2Fhome%2Fpi%2Fa%20b');
  });
});

describe('request', () => {
  const g = globalThis as unknown as { fetch: jest.Mock };
  afterEach(() => jest.restoreAllMocks());

  test('weigert http:// naar het internet', async () => {
    await expect(request('/v1/info', { conn: { ...conn, apiUrl: 'http://pi.example.com' } })).rejects.toMatchObject({ kind: 'insecure_url' });
  });

  test('laat http:// toe in het thuisnetwerk', async () => {
    g.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ version: '1.1.0' }) });
    await expect(request('/v1/info', { conn: { ...conn, apiUrl: 'http://192.168.1.50:8120' } })).resolves.toEqual({ version: '1.1.0' });
  });

  test('demo-modus gebruikt geen netwerk', async () => {
    g.fetch = jest.fn();
    const info = await request<{ hostname: string }>('/v1/info', { conn: { ...DEFAULT_CONNECTION, demo: true } });
    expect(info.hostname).toBe('homelab-pi');
    expect(g.fetch).not.toHaveBeenCalled();
    await expect(request('/v1/bestaat-niet', { conn: { ...DEFAULT_CONNECTION, demo: true } })).rejects.toMatchObject({ kind: 'not_found' });
  });

  test('zonder token: not_configured', async () => {
    await expect(request('/v1/info', { conn: { ...conn, agentToken: '' } })).rejects.toMatchObject({ kind: 'not_configured' });
  });

  test('netwerkfout wordt offline', async () => {
    g.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
    await expect(request('/v1/info', { conn })).rejects.toMatchObject({ kind: 'offline' });
  });

  test('json-antwoord wordt teruggegeven', async () => {
    g.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ version: '1.0.0' }) });
    await expect(request<{ version: string }>('/v1/info', { conn })).resolves.toEqual({ version: '1.0.0' });
    const [url, init] = g.fetch.mock.calls[0];
    expect(url).toBe('https://pi.example.com/v1/info');
    expect(init.headers['Accept-Language']).toBe('nl');
    expect(init.headers['CF-Access-Client-Id']).toBe('id.access');
    expect(init.credentials).toBe('omit');
  });

  test('Access-loginpagina (html) wordt access_denied', async () => {
    g.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, headers: { get: () => 'text/html' }, text: async () => '<html>login</html>' });
    const err = await request('/v1/info', { conn }).catch((e: ApiError) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).kind).toBe('access_denied');
  });
});
