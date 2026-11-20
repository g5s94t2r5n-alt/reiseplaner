import { get, set } from 'idb-keyval';

const memory = new Map<string, unknown>();

/**
 * Lädt einen Wert über `load` und speichert ihn im Speicher und in IndexedDB.
 * So werden die kostenlosen APIs geschont und wiederholte Planungen sind schnell.
 */
export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  if (memory.has(key)) return memory.get(key) as T;
  try {
    const hit = (await get(key)) as { t: number; v: T } | undefined;
    if (hit && Date.now() - hit.t < ttlMs) {
      memory.set(key, hit.v);
      return hit.v;
    }
  } catch {
    // IndexedDB nicht verfügbar (z. B. privates Fenster) – einfach ohne Cache weiter
  }
  const value = await load();
  memory.set(key, value);
  try {
    await set(key, { t: Date.now(), v: value });
  } catch {
    // ignorieren
  }
  return value;
}

export const DAY = 24 * 60 * 60 * 1000;

/** Begrenzt Anfragen pro Dienst (Mindestabstand + parallele Anfragen). */
export function createLimiter(minIntervalMs: number, concurrency = 1) {
  let active = 0;
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const queue: (() => void)[] = [];

  const next = () => {
    if (active >= concurrency || queue.length === 0) return;
    const wait = last + minIntervalMs - Date.now();
    if (wait > 0) {
      if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          next();
        }, wait);
      }
      return;
    }
    active++;
    last = Date.now();
    queue.shift()!();
    next();
  };

  return function run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      });
      next();
    });
  };
}

export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function fetchJson<T>(url: string, init: RequestInit = {}, timeoutMs = 20000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new HttpError(`${res.status} ${res.statusText} – ${new URL(url).host}`, res.status);
    return (await res.json()) as T;
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error(`Zeitüberschreitung – ${new URL(url).host}`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Führt `fn` für alle Elemente mit begrenzter Parallelität aus. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
