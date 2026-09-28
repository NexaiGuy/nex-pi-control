// Offline cache: de laatste antwoorden op schijf, zodat de app zonder verbinding de laatste toestand toont.
// Bevat geen geheimen (enkel meetdata). Staat in de privé app-map.
import { File, Paths } from 'expo-file-system';

type Entry = { at: number; data: unknown };
let memory: Record<string, Entry> | null = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;

function file(): File {
  return new File(Paths.document, 'hal-cache.json');
}

function load(): Record<string, Entry> {
  if (memory) return memory;
  try {
    const f = file();
    memory = f.exists ? (JSON.parse(f.textSync()) as Record<string, Entry>) : {};
  } catch {
    memory = {};
  }
  return memory;
}

export function cacheGet<T>(key: string): { at: number; data: T } | undefined {
  const e = load()[key];
  return e ? { at: e.at, data: e.data as T } : undefined;
}

export function cacheSet(key: string, data: unknown): void {
  const m = load();
  m[key] = { at: Date.now(), data };
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    try {
      file().write(JSON.stringify(m));
    } catch {
      // cache is best effort
    }
  }, 1500);
}

export function cacheClear(): void {
  memory = {};
  try {
    const f = file();
    if (f.exists) f.delete();
  } catch {
    // negeren
  }
}
