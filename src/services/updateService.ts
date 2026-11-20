// Aktualizacje aplikacji (service worker, tryb autoUpdate z vite-plugin-pwa).
// Problem: aplikacja z ekranu głównego iPhone'a jest zwykle wznawiana z tła, a nie uruchamiana od nowa,
// więc sama nie sprawdza, czy na serwerze jest nowa wersja. Dlatego sprawdzamy to jawnie: przy starcie,
// przy powrocie do aplikacji, po odzyskaniu sieci i co kwadrans. Nowa wersja instaluje się w tle, a po jej
// aktywacji vite-plugin-pwa przeładowuje stronę — dlatego sprawdzamy tylko wtedy, gdy nie trwa walka.
//
// Druga linia obrony (iOS potrafi trzymać stare pliki mimo nowego service workera — błąd WebKit):
// porównanie wersji gry z plikiem version.json na serwerze (z pominięciem buforów). Gdy serwer ma nowszą
// wersję, a service worker jej nie pobrał, gra proponuje (a na ekranie tytułowym sama wykonuje) wymuszoną
// aktualizację: zapis gry, wyrejestrowanie service workera, usunięcie bufora plików gry (sprite'y zostają)
// i przeładowanie strony prosto z serwera. Zapis gry w IndexedDB nie jest ruszany.

import { useUi } from '../state/uiStore';
import { SPRITE_CACHE } from './spriteCache';

/** Minimalny interfejs rejestracji service workera (testy podstawiają atrapę). */
export interface UpdatableRegistration {
  update(): Promise<unknown>;
  installing: unknown | null;
  waiting: unknown | null;
}

let registration: UpdatableRegistration | null = null;

export function setUpdateRegistration(r: UpdatableRegistration | null): void {
  registration = r;
}

/** Czy przeładowanie po aktualizacji niczego nie przerwie (brak walki, przejścia i trwającego spotkania). */
export function isSafeToUpdate(): boolean {
  const u = useUi.getState();
  if (u.mode === 'battle' || u.transition) return false;
  if (u.mode === 'overworld' && (u.gameMode !== 'EXPLORATION' || u.inputLocked || u.activeEncounterId !== null)) return false;
  return true;
}

export type UpdateCheckResult = 'no-registration' | 'offline' | 'unsafe' | 'up-to-date' | 'downloading' | 'outdated' | 'error';

/** Źródło wersji: bieżąca wersja gry i odczyt wersji z serwera (null — nie udało się odczytać). */
export interface VersionSource {
  current: string;
  fetchServerVersion(): Promise<string | null>;
}

let versionSource: VersionSource | null = null;

export function setVersionSource(src: VersionSource | null): void {
  versionSource = src;
}

/** Odczyt version.json z serwera z pominięciem buforów (unikalny parametr + cache: no-store). */
export function httpVersionSource(current: string, url: string, fetchFn: typeof fetch = fetch): VersionSource {
  return {
    current,
    async fetchServerVersion() {
      const res = await fetchFn(`${url}?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return null;
      const data = (await res.json()) as { version?: unknown };
      return typeof data.version === 'string' && data.version ? data.version : null;
    },
  };
}

/** Porównanie z serwerem: nowsza wersja → flaga w UI (baner). „dev” (build lokalny) nie jest porównywany. */
async function compareWithServer(): Promise<boolean> {
  const src = versionSource;
  if (!src || src.current === 'dev') return false;
  const server = await src.fetchServerVersion().catch(() => null);
  if (!server) return false;
  const outdated = server !== src.current;
  useUi.getState().setUpdateAvailable(outdated ? server : null);
  return outdated;
}

let inflight: Promise<UpdateCheckResult> | null = null;

/** Sprawdza, czy na serwerze jest nowa wersja. „downloading” = nowa wersja się instaluje (potem przeładowanie). */
export function checkForUpdate(): Promise<UpdateCheckResult> {
  if (inflight) return inflight;
  const r = registration;
  if (!r) return Promise.resolve('no-registration');
  if (!useUi.getState().online) return Promise.resolve('offline');
  if (!isSafeToUpdate()) return Promise.resolve('unsafe');
  inflight = r
    .update()
    .then(async (): Promise<UpdateCheckResult> => {
      if (r.installing || r.waiting) return 'downloading';
      // Service worker nie widzi nowej wersji — sprawdzamy serwer bezpośrednio.
      if (await compareWithServer()) {
        const target = useUi.getState().updateAvailable;
        // Na ekranie tytułowym (gra nie trwa) aktualizujemy od razu — najwyżej raz na wersję w sesji.
        const mode = useUi.getState().mode;
        if ((mode === 'title' || mode === 'boot') && target && !forceAttempted(target)) void forceUpdate(target);
        return 'outdated';
      }
      return 'up-to-date';
    })
    .catch((): UpdateCheckResult => 'error')
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

// ───────────────────────────── wymuszona aktualizacja ─────────────────────────────

const FORCE_KEY = 'szlaki:force-update';

/** Zależności wymuszonej aktualizacji (testy podstawiają atrapy). */
export interface ForceUpdateEnv {
  saveNow(): Promise<void>;
  unregisterAll(): Promise<number>;
  cacheNames(): Promise<string[]>;
  deleteCache(name: string): Promise<boolean>;
  reload(target: string): void;
  session: { getItem(k: string): string | null; setItem(k: string, v: string): void } | null;
}

let forceEnv: ForceUpdateEnv | null = null;

export function setForceUpdateEnv(env: ForceUpdateEnv | null): void {
  forceEnv = env;
}

/** Czy w tej sesji próbowaliśmy już wymusić aktualizację do tej wersji (ochrona przed pętlą przeładowań). */
export function forceAttempted(target: string): boolean {
  try {
    return forceEnv?.session?.getItem(FORCE_KEY) === target;
  } catch {
    return false;
  }
}

export type ForceUpdateResult = 'reloading' | 'unsafe' | 'unavailable';

/**
 * Wymuszona aktualizacja: zapis gry, wyrejestrowanie service workera, usunięcie bufora plików gry
 * (bez bufora sprite'ów) i przeładowanie strony z serwera. Nie w trakcie walki ani przejścia.
 */
export async function forceUpdate(target: string): Promise<ForceUpdateResult> {
  const env = forceEnv;
  if (!env) return 'unavailable';
  if (!isSafeToUpdate()) return 'unsafe';
  try {
    env.session?.setItem(FORCE_KEY, target);
  } catch {
    /* brak sessionStorage — bez ochrony przed ponowieniem, ale aktualizacja i tak przebiega */
  }
  useUi.getState().setTransition(true);
  await env.saveNow().catch(() => undefined);
  await env.unregisterAll().catch(() => 0);
  const names = await env.cacheNames().catch(() => [] as string[]);
  for (const name of names) if (name !== SPRITE_CACHE) await env.deleteCache(name).catch(() => false);
  env.reload(target);
  return 'reloading';
}

/** Środowisko przeglądarki dla wymuszonej aktualizacji. */
export function browserForceUpdateEnv(saveNow: () => Promise<void>): ForceUpdateEnv {
  return {
    saveNow,
    async unregisterAll() {
      const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
      const done = await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
      return done.filter(Boolean).length;
    },
    cacheNames: async () => (typeof caches === 'undefined' ? [] : caches.keys()),
    deleteCache: async (name) => (typeof caches === 'undefined' ? false : caches.delete(name)),
    reload(target) {
      // Unikalny parametr omija bufor HTTP dla strony startowej; po starcie usuwamy go z adresu.
      const url = new URL(window.location.href);
      url.searchParams.set('u', target);
      window.location.replace(url.toString());
    },
    session: typeof sessionStorage === 'undefined' ? null : sessionStorage,
  };
}

interface Target {
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
}

/** Automatyczne sprawdzanie: powrót do aplikacji, odzyskanie sieci i co `intervalMs`. Zwraca funkcję wyłączającą. */
export function installUpdateChecks(
  win: Target,
  doc: Target & { visibilityState: string },
  intervalMs = 15 * 60 * 1000,
  timers: { set: (fn: () => void, ms: number) => unknown; clear: (id: unknown) => void } = {
    set: (fn, ms) => setInterval(fn, ms),
    clear: (id) => clearInterval(id as ReturnType<typeof setInterval>),
  },
): () => void {
  const check = () => void checkForUpdate();
  const onVisible = () => {
    if (doc.visibilityState === 'visible') check();
  };
  doc.addEventListener('visibilitychange', onVisible);
  win.addEventListener('online', check);
  const id = timers.set(check, intervalMs);
  return () => {
    doc.removeEventListener('visibilitychange', onVisible);
    win.removeEventListener('online', check);
    timers.clear(id);
  };
}
