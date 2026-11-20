// Jednorazowe sprzątanie bufora sprite'ów: usuwane są tylko odpowiedzi „opaque” (bez CORS).

import { describe, expect, it } from 'vitest';
import { purgeOpaqueSprites, SPRITE_CACHE, type CacheStorageLike } from '../spriteCache';

function fakeStorage(entries: Record<string, string>, name = SPRITE_CACHE): { storage: CacheStorageLike; left: () => string[] } {
  const map = new Map(Object.entries(entries));
  const cache = {
    keys: async () => [...map.keys()].map((url) => ({ url })),
    match: async (r: { url: string }) => (map.has(r.url) ? { type: map.get(r.url)! } : undefined),
    delete: async (r: { url: string }) => map.delete(r.url),
  };
  return {
    storage: { has: async (n) => n === name, open: async () => cache },
    left: () => [...map.keys()],
  };
}

describe('bufor sprite’ów', () => {
  it('usuwa wpisy „opaque”, zostawia pełne odpowiedzi CORS (offline nadal działa)', async () => {
    const f = fakeStorage({ 'https://x/1.png': 'cors', 'https://x/2.png': 'opaque', 'https://x/3.png': 'opaque', 'https://x/4.png': 'basic' });
    expect(await purgeOpaqueSprites(f.storage)).toBe(2);
    expect(f.left()).toEqual(['https://x/1.png', 'https://x/4.png']);
  });

  it('brak bufora — nic nie robi', async () => {
    const f = fakeStorage({ 'https://x/2.png': 'opaque' }, 'inny-bufor');
    expect(await purgeOpaqueSprites(f.storage)).toBe(0);
    expect(f.left()).toEqual(['https://x/2.png']);
  });
});
