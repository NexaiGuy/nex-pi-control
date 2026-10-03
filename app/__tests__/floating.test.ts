// Zwevend icoon: de JS-kant mag nooit crashen zonder native module, en volgt de keuze en de toestemming.
type Native = { [k in "isSupported" | "canDrawOverlays" | "isEnabled" | "isRunning" | "start" | "stop" | "setStatus" | "setAppVisible" | "openPermissionSettings" | "isHomeOnly" | "setHomeOnly" | "hasUsageAccess"]: jest.Mock };

function load(native: Native | null, os: 'android' | 'ios' = 'android') {
  let mod: typeof import('@/lib/floatingPi') | undefined;
  jest.isolateModules(() => {
    jest.doMock('expo', () => ({ requireOptionalNativeModule: () => native }));
    const rn = jest.requireActual('react-native') as typeof import('react-native');
    rn.Platform.OS = os;
    mod = require('@/lib/floatingPi') as typeof import('@/lib/floatingPi');
  });
  return mod!;
}

function fakeNative(over: Partial<Record<string, unknown>> = {}): Native {
  const v = { isSupported: true, canDrawOverlays: true, isEnabled: true, isRunning: false, start: true, ...over };
  return {
    isSupported: jest.fn(() => v.isSupported),
    canDrawOverlays: jest.fn(() => v.canDrawOverlays),
    isEnabled: jest.fn(() => v.isEnabled),
    isRunning: jest.fn(() => v.isRunning),
    start: jest.fn(() => v.start),
    stop: jest.fn(),
    setStatus: jest.fn(),
    setAppVisible: jest.fn(),
    openPermissionSettings: jest.fn(),
    isHomeOnly: jest.fn(() => true),
    setHomeOnly: jest.fn(),
    hasUsageAccess: jest.fn(() => true),
  };
}

afterEach(() => {
  (jest.requireActual('react-native') as typeof import('react-native')).Platform.OS = 'ios';
});

test('zonder native module (iOS of Play Store-build): alles is een veilige no-op', () => {
  const { floatingPi, syncFloatingPi } = load(null);
  expect(floatingPi.supported()).toBe(false);
  expect(floatingPi.start()).toBe(false);
  expect(() => {
    floatingPi.setStatus('critical');
    floatingPi.stop();
    syncFloatingPi();
  }).not.toThrow();
});

test('een fout in de native kant breekt de app niet', () => {
  const n = fakeNative();
  n.isSupported.mockImplementation(() => {
    throw new Error('boom');
  });
  const { floatingPi } = load(n);
  expect(floatingPi.supported()).toBe(false);
});

test('start geeft de meldingsteksten mee in de taal van de app', () => {
  const n = fakeNative();
  const { floatingPi } = load(n);
  expect(floatingPi.start()).toBe(true);
  expect(n.start).toHaveBeenCalledWith(expect.objectContaining({ title: 'Nex Pi Control', hide: expect.any(String), text: expect.any(String) }));
});

test('bij het openen: aanzetten als je het koos, uitzetten als de toestemming weg is', () => {
  const a = fakeNative();
  load(a).syncFloatingPi();
  expect(a.start).toHaveBeenCalledTimes(1);

  const b = fakeNative({ canDrawOverlays: false });
  load(b).syncFloatingPi();
  expect(b.start).not.toHaveBeenCalled();
  expect(b.stop).toHaveBeenCalledTimes(1);

  const c = fakeNative({ isEnabled: false });
  load(c).syncFloatingPi();
  expect(c.start).not.toHaveBeenCalled();
  expect(c.stop).not.toHaveBeenCalled();
});

test('status gaat ongewijzigd naar de bubbel', () => {
  const n = fakeNative();
  load(n).floatingPi.setStatus('offline');
  expect(n.setStatus).toHaveBeenCalledWith('offline');
});

test('eerste start: met toestemming meteen aan, zonder toestemming één keer vragen, daarna nooit meer', () => {
  const a = fakeNative({ isEnabled: false });
  expect(load(a).firstRunFloatingPi(false)).toBe('started');
  expect(a.start).toHaveBeenCalledTimes(1);

  const b = fakeNative({ isEnabled: false, canDrawOverlays: false });
  expect(load(b).firstRunFloatingPi(false)).toBe('ask');
  expect(b.start).not.toHaveBeenCalled();

  const c = fakeNative({ isEnabled: false });
  expect(load(c).firstRunFloatingPi(true)).toBe('done');
  expect(c.start).not.toHaveBeenCalled();

  expect(load(null).firstRunFloatingPi(false)).toBe('done');
});

test('weer in de app na het kruis: het icoon komt terug zolang het in Instellingen aan staat', () => {
  // Het kruis stopt enkel de bubbel; de keuze (isEnabled) blijft true.
  const n = fakeNative({ isEnabled: true, isRunning: false });
  load(n).syncFloatingPi();
  expect(n.start).toHaveBeenCalledTimes(1);
});

test('enkel op het startscherm: standaard aan, en zonder native module een veilige standaard', () => {
  const none = load(null).floatingPi;
  expect(none.homeOnly()).toBe(true);
  expect(none.hasUsageAccess()).toBe(false);
  const n = fakeNative();
  load(n).floatingPi.setHomeOnly(false);
  expect(n.setHomeOnly).toHaveBeenCalledWith(false);
});
