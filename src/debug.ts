// Tryb diagnostyczny (adres z ?debug): udostępnia wybrane obiekty w window.__szlaki dla testów E2E.
// Zwykli gracze go nie używają; bez parametru nic nie jest udostępniane.

export const DEBUG = typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug');

export function expose(name: string, value: unknown): void {
  if (!DEBUG) return;
  const w = window as unknown as { __szlaki?: Record<string, unknown> };
  w.__szlaki = { ...(w.__szlaki ?? {}), [name]: value };
}

/** Ziarno losowości z adresu (?debug&seed=N) — tylko w trybie diagnostycznym; inaczej null. */
export function debugSeed(): number | null {
  if (!DEBUG) return null;
  const raw = new URLSearchParams(location.search).get('seed');
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.floor(n) : null;
}
