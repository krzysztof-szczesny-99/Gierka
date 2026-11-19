// Aktualizacje aplikacji (service worker, tryb autoUpdate z vite-plugin-pwa).
// Problem: aplikacja z ekranu głównego iPhone'a jest zwykle wznawiana z tła, a nie uruchamiana od nowa,
// więc sama nie sprawdza, czy na serwerze jest nowa wersja. Dlatego sprawdzamy to jawnie: przy starcie,
// przy powrocie do aplikacji, po odzyskaniu sieci i co kwadrans. Nowa wersja instaluje się w tle, a po jej
// aktywacji vite-plugin-pwa przeładowuje stronę — dlatego sprawdzamy tylko wtedy, gdy nie trwa walka.

import { useUi } from '../state/uiStore';

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

export type UpdateCheckResult = 'no-registration' | 'offline' | 'unsafe' | 'up-to-date' | 'downloading' | 'error';

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
    .then((): UpdateCheckResult => (r.installing || r.waiting ? 'downloading' : 'up-to-date'))
    .catch((): UpdateCheckResult => 'error')
    .finally(() => {
      inflight = null;
    });
  return inflight;
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
