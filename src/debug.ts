// Tryb diagnostyczny (adres z ?debug): udostępnia wybrane obiekty w window.__szlaki dla testów E2E.
// Zwykli gracze go nie używają; bez parametru nic nie jest udostępniane.

export const DEBUG = typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug');

export function expose(name: string, value: unknown): void {
  if (!DEBUG) return;
  const w = window as unknown as { __szlaki?: Record<string, unknown> };
  w.__szlaki = { ...(w.__szlaki ?? {}), [name]: value };
}
