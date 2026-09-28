import { DEFAULT_CONNECTION, DEMO_CONNECTION, isConfigured, isLanHttp, isPrivateHost, parseQr, serverName, validateUrl } from '@/state/settings';

const good = { v: 1, name: 'raspberrypi', api: 'https://pi.example.com/', shell: 'https://pi.example.com:8443', cfId: 'x.access', cfSecret: 'y', agentToken: 'a'.repeat(64), shellToken: 's'.repeat(64) };

test('validateUrl: https overal, http enkel in het thuisnetwerk', () => {
  expect(validateUrl('https://pi.example.com')).toBeNull();
  expect(validateUrl('https://raspberrypi.tail1234.ts.net')).toBeNull();
  expect(validateUrl('http://pi.example.com')).toBe('insecure');
  expect(validateUrl('http://8.8.8.8:8120')).toBe('insecure');
  expect(validateUrl('http://192.168.1.50:8120')).toBeNull();
  expect(validateUrl('http://10.0.0.5:8120')).toBeNull();
  expect(validateUrl('http://172.20.1.2:8120')).toBeNull();
  expect(validateUrl('http://172.32.1.2:8120')).toBe('insecure');
  expect(validateUrl('http://raspberrypi.local:8120')).toBeNull();
  expect(validateUrl('ftp://192.168.1.50')).toBe('insecure');
  expect(validateUrl('geen url')).toBe('invalid');
});

test('isPrivateHost en isLanHttp', () => {
  expect(isPrivateHost('192.168.0.10')).toBe(true);
  expect(isPrivateHost('pi.local')).toBe(true);
  expect(isPrivateHost('example.com')).toBe(false);
  expect(isLanHttp('http://192.168.0.10:8120')).toBe(true);
  expect(isLanHttp('https://192.168.0.10')).toBe(false);
});

test('parseQr: geldige payload met naam', () => {
  const c = parseQr(JSON.stringify(good));
  expect(c).not.toBeNull();
  expect(c!.apiUrl).toBe('https://pi.example.com');
  expect(c!.name).toBe('raspberrypi');
  expect(c!.shellToken).toBe('s'.repeat(64));
  expect(c!.demo).toBe(false);
});

test('parseQr: zonder Cloudflare (Tailscale of thuisnetwerk)', () => {
  const c = parseQr(JSON.stringify({ v: 1, api: 'http://192.168.1.50:8120', agentToken: 'a'.repeat(64) }));
  expect(c).not.toBeNull();
  expect(c!.cfId).toBe('');
});

test.each([
  ['geen json', 'hallo'],
  ['verkeerde versie', JSON.stringify({ ...good, v: 2 })],
  ['http api naar internet', JSON.stringify({ ...good, api: 'http://evil.example' })],
  ['http shell naar internet', JSON.stringify({ ...good, shell: 'http://evil.example' })],
  ['kort token', JSON.stringify({ ...good, agentToken: 'kort' })],
  ['half cf-paar', JSON.stringify({ ...good, cfSecret: '' })],
])('parseQr weigert: %s', (_n, raw) => {
  expect(parseQr(raw)).toBeNull();
});

test('isConfigured en serverName', () => {
  expect(isConfigured(DEFAULT_CONNECTION)).toBe(false);
  expect(isConfigured({ ...DEFAULT_CONNECTION, apiUrl: 'https://pi.example.com', agentToken: 'x' })).toBe(true);
  expect(isConfigured({ ...DEFAULT_CONNECTION, apiUrl: 'http://pi.example.com', agentToken: 'x' })).toBe(false);
  expect(isConfigured(DEMO_CONNECTION)).toBe(true);
  expect(serverName({ ...DEFAULT_CONNECTION, apiUrl: 'https://garage-pi.example.com' })).toBe('garage-pi');
  expect(serverName({ ...DEFAULT_CONNECTION, name: 'Kelder' })).toBe('Kelder');
});
