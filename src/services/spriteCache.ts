// Porządki w buforze sprite'ów service workera (Sprint 4).
// Wcześniej obrazki <img> pobierały sprite'y bez CORS, a bufor przyjmował odpowiedzi „opaque”. Taka odpowiedź
// nie nadaje się na teksturę mapy (Phaser/WebGL ładuje z CORS) — np. towarzysz po ewolucji stawał się sylwetką,
// a konsola pokazywała net::ERR_FAILED. Teraz wszystko idzie przez CORS; jednorazowo usuwamy stare wpisy
// „opaque”, zostawiając pełne odpowiedzi (tryb offline nie traci zapisanych sprite'ów).

export const SPRITE_CACHE = 'pokeapi-sprites';
const DONE_KEY = 'szlaki:sprite-cache-cors-v1';

/** Minimalny interfejs CacheStorage (testy podstawiają atrapę). */
export interface CacheLike {
  keys(): Promise<readonly { url: string }[]>;
  match(request: { url: string }): Promise<{ type: string } | undefined>;
  delete(request: { url: string }): Promise<boolean>;
}
export interface CacheStorageLike {
  has(name: string): Promise<boolean>;
  open(name: string): Promise<CacheLike>;
}

/** Usuwa z bufora sprite'ów odpowiedzi „opaque”. Zwraca liczbę usuniętych wpisów. */
export async function purgeOpaqueSprites(storage: CacheStorageLike): Promise<number> {
  if (!(await storage.has(SPRITE_CACHE))) return 0;
  const cache = await storage.open(SPRITE_CACHE);
  let removed = 0;
  for (const req of await cache.keys()) {
    const res = await cache.match(req);
    if (res && res.type === 'opaque' && (await cache.delete(req))) removed += 1;
  }
  return removed;
}

/** Jednorazowe sprzątanie na urządzeniu gracza (w tle; brak CacheStorage — np. http w sieci LAN — pomijamy). */
export function cleanupSpriteCacheOnce(): void {
  try {
    if (typeof caches === 'undefined' || typeof localStorage === 'undefined') return;
    if (localStorage.getItem(DONE_KEY)) return;
    purgeOpaqueSprites(caches as unknown as CacheStorageLike)
      .then(() => localStorage.setItem(DONE_KEY, '1'))
      .catch(() => undefined);
  } catch {
    /* tryb prywatny / brak dostępu do magazynu — spróbujemy przy kolejnym uruchomieniu */
  }
}
