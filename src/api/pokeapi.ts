// Klient PokéAPI z poszanowaniem zasad fair use:
// kolejka (maks. 4 równoległe zapytania), ponowienia z backoffem, timeout, wykrywanie braku sieci.
// Buforowanie trwałe realizuje warstwa data/repository.ts (IndexedDB).

const BASE_URL = 'https://pokeapi.co/api/v2/';
const MAX_CONCURRENT = 4;
const TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2;

export class OfflineError extends Error {
  constructor() {
    super('Brak połączenia z internetem.');
    this.name = 'OfflineError';
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public path: string,
  ) {
    super(`PokéAPI zwróciło błąd ${status} dla „${path}”.`);
    this.name = 'ApiError';
  }
}

export class NetworkError extends Error {
  constructor(path: string) {
    super(`Nie udało się pobrać danych („${path}”). Sprawdź połączenie.`);
    this.name = 'NetworkError';
  }
}

let active = 0;
const waiters: (() => void)[] = [];
let requestCount = 0;

async function acquire(): Promise<void> {
  while (active >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  active += 1;
}

function release(): void {
  active -= 1;
  const next = waiters.shift();
  if (next) next();
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/** Liczba wysłanych zapytań sieciowych w tej sesji (do panelu diagnostycznego). */
export function getRequestCount(): number {
  return requestCount;
}

// PokéAPI blokuje m.in. znaki . , * % ; : ' ! @ + [ oraz parametry inne niż limit/offset.
const SAFE_PATH = /^[a-z0-9-]+(\/[a-z0-9-]+)*\/?(\?limit=\d+(&offset=\d+)?)?$/;

export async function fetchJson<T>(path: string): Promise<T> {
  if (!SAFE_PATH.test(path)) throw new Error(`Niedozwolona ścieżka API: ${path}`);
  await acquire();
  try {
    for (let attempt = 0; ; attempt++) {
      if (!isOnline()) throw new OfflineError();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        requestCount += 1;
        const res = await fetch(BASE_URL + path, { signal: ctrl.signal });
        if (res.status === 404) throw new ApiError(404, path);
        if (!res.ok) throw new ApiError(res.status, path);
        return (await res.json()) as T;
      } catch (err) {
        const retryable = !(err instanceof ApiError) || err.status >= 500 || err.status === 429;
        if (!retryable) throw err;
        if (!isOnline()) throw new OfflineError();
        if (attempt >= MAX_RETRIES) throw err instanceof ApiError ? err : new NetworkError(path);
        await sleep(600 * 2 ** attempt);
      } finally {
        clearTimeout(timer);
      }
    }
  } finally {
    release();
  }
}

export function idFromUrl(url: string): number {
  const m = /\/(\d+)\/?$/.exec(url);
  return m ? Number(m[1]) : 0;
}
