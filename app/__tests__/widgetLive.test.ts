// Live widgets: de JS-kant mag nooit crashen zonder native module, zet zichzelf één keer aan zodra er een widget staat,
// en een volle startpagina vraagt elk antwoord maar één keer op bij de Pi.
type Fn = 'isSupported' | 'isEnabled' | 'isRunning' | 'start' | 'resume' | 'stop' | 'getInterval' | 'setInterval' | 'hasUsageAccess' | 'status';
type Native = Record<Fn, jest.Mock>;

function load(native: Native | null, os: 'android' | 'ios' = 'android') {
  let mod: typeof import('@/lib/widgetLive') | undefined;
  let settings: typeof import('@/state/settings') | undefined;
  jest.isolateModules(() => {
    jest.doMock('expo', () => ({ requireOptionalNativeModule: () => native }));
    const rn = jest.requireActual('react-native') as typeof import('react-native');
    rn.Platform.OS = os;
    settings = require('@/state/settings') as typeof import('@/state/settings');
    mod = require('@/lib/widgetLive') as typeof import('@/lib/widgetLive');
  });
  return { ...mod!, settings: settings! };
}

function fakeNative(over: Partial<Record<string, unknown>> = {}): Native {
  const v: Record<string, unknown> = { isSupported: true, isEnabled: false, widgets: 2, interval: 60, ...over };
  return {
    isSupported: jest.fn(() => v.isSupported),
    isEnabled: jest.fn(() => v.isEnabled),
    isRunning: jest.fn(() => false),
    start: jest.fn(() => {
      v.isEnabled = true;
      return true;
    }),
    resume: jest.fn(() => true),
    stop: jest.fn(() => {
      v.isEnabled = false;
    }),
    getInterval: jest.fn(() => v.interval),
    setInterval: jest.fn((s: number) => {
      v.interval = s;
    }),
    hasUsageAccess: jest.fn(() => true),
    status: jest.fn(() => ({ running: false, enabled: v.isEnabled, intervalS: v.interval, usageAccess: true, widgets: v.widgets, looking: false, onHome: null, lastRefresh: null })),
  };
}

afterEach(() => {
  (jest.requireActual('react-native') as typeof import('react-native')).Platform.OS = 'ios';
});

test('zonder native module (iOS of build zonder plugin): alles is een veilige no-op', () => {
  const { widgetLive, syncWidgetLive } = load(null);
  expect(widgetLive.supported()).toBe(false);
  expect(widgetLive.start()).toBe(false);
  expect(widgetLive.status()).toBeNull();
  expect(() => {
    widgetLive.setInterval(30);
    widgetLive.stop();
    syncWidgetLive();
  }).not.toThrow();
});

test('een fout in de native kant breekt de app niet', () => {
  const n = fakeNative();
  n.isSupported.mockImplementation(() => {
    throw new Error('weg');
  });
  const { widgetLive, syncWidgetLive } = load(n);
  expect(widgetLive.supported()).toBe(false);
  expect(() => syncWidgetLive()).not.toThrow();
});

test('de melding krijgt de tekst in de taal van de app, met het interval', () => {
  const n = fakeNative({ interval: 120 });
  const { widgetLive } = load(n);
  widgetLive.start();
  const labels = n.start.mock.calls[0][0] as Record<string, string>;
  expect(Object.keys(labels).sort()).toEqual(['channel', 'stop', 'text', 'title']);
  expect(labels.text).toMatch(/2 min/);
  expect(labels.text).not.toMatch(/[\u2013\u2014]/);
});

test('ander interval: opgeslagen en, als het aan staat, meteen in de melding', () => {
  const n = fakeNative({ isEnabled: true });
  const { widgetLive } = load(n);
  widgetLive.setInterval(30);
  expect(n.setInterval).toHaveBeenCalledWith(30);
  expect((n.start.mock.calls.at(-1)![0] as Record<string, string>).text).toMatch(/30 s/);
});

test('eerste keer: gaat vanzelf aan zodra er een widget staat, en daarna nooit meer vanzelf', () => {
  const n = fakeNative({ widgets: 1 });
  const { syncWidgetLive, settings } = load(n);
  settings.hydratedStore.set(true);
  syncWidgetLive();
  expect(n.start).toHaveBeenCalledTimes(1);
  expect(settings.prefsStore.get().widgetLiveAsked).toBe(true);
  // De gebruiker zet het uit: bij het volgende openen blijft het uit.
  n.stop();
  syncWidgetLive();
  expect(n.start).toHaveBeenCalledTimes(1);
});

test('zonder widget op het startscherm gaat het niet aan (geen melding voor niets)', () => {
  const n = fakeNative({ widgets: 0 });
  const { syncWidgetLive, settings } = load(n);
  settings.hydratedStore.set(true);
  syncWidgetLive();
  expect(n.start).not.toHaveBeenCalled();
  expect(settings.prefsStore.get().widgetLiveAsked).toBe(false);
});

test('voorkeuren nog niet geladen: niets beslissen', () => {
  const n = fakeNative({ widgets: 3 });
  const { syncWidgetLive, settings } = load(n);
  settings.hydratedStore.set(false);
  syncWidgetLive();
  expect(n.start).not.toHaveBeenCalled();
});

test('staat het aan, dan start het bij het openen van de app opnieuw', () => {
  const n = fakeNative({ isEnabled: true });
  const { syncWidgetLive } = load(n);
  syncWidgetLive();
  expect(n.start).toHaveBeenCalledTimes(1);
});

describe('fetchShared', () => {
  test('gelijktijdige widgets delen één verzoek', async () => {
    const { fetchShared } = require('@/widget/data') as typeof import('@/widget/data');
    let calls = 0;
    const fn = () =>
      new Promise<number>((resolve) => {
        calls += 1;
        setTimeout(() => resolve(42), 5);
      });
    const all = await Promise.all([1, 2, 3, 4].map(() => fetchShared('test.shared', 15_000, fn)));
    expect(calls).toBe(1);
    expect(all.map((r) => r.data)).toEqual([42, 42, 42, 42]);
  });

  test('binnen maxAge uit de cache, daarna opnieuw', async () => {
    const { fetchShared } = require('@/widget/data') as typeof import('@/widget/data');
    let n = 0;
    const fn = async () => ++n;
    const a = await fetchShared('test.ttl', 15_000, fn);
    const b = await fetchShared('test.ttl', 15_000, fn);
    expect(a.data).toBe(1);
    expect(b.data).toBe(1);
    const now = Date.now();
    const spy = jest.spyOn(Date, 'now').mockReturnValue(now + 16_000);
    const c = await fetchShared('test.ttl', 15_000, fn);
    spy.mockRestore();
    expect(c.data).toBe(2);
  });

  test('een fout wordt doorgegeven en blokkeert de volgende poging niet', async () => {
    const { fetchShared } = require('@/widget/data') as typeof import('@/widget/data');
    await expect(fetchShared('test.err', 15_000, () => Promise.reject(new Error('offline')))).rejects.toThrow('offline');
    const ok = await fetchShared('test.err', 15_000, async () => 'terug');
    expect(ok.data).toBe('terug');
  });
});
