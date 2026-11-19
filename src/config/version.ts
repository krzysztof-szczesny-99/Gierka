// Wersja gry widoczna dla gracza (ekran tytułowy, Menu) — pozwala sprawdzić, czy telefon ma najnowszą wersję.
// Wartości wstrzykuje build w GitHub Actions (VITE_APP_VERSION = commit, VITE_BUILD_TIME = czas buildu).

const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};

/** Skrócony identyfikator commita (7 znaków) albo „dev” przy buildzie lokalnym. */
export const APP_VERSION: string = (env.VITE_APP_VERSION ?? '').trim().slice(0, 7) || 'dev';

/** Czas buildu (ISO) albo pusty napis. */
export const BUILD_TIME: string = (env.VITE_BUILD_TIME ?? '').trim();

/** Np. „691b973 · 19.11.2026, 15:28” (czas lokalny telefonu). */
export function versionLabel(): string {
  if (!BUILD_TIME) return APP_VERSION;
  const d = new Date(BUILD_TIME);
  if (Number.isNaN(d.getTime())) return APP_VERSION;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${APP_VERSION} · ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
