// Deterministyczny generator liczb losowych (mulberry32) — powtarzalne testy i łatwe debugowanie.

export interface Rng {
  /** [0, 1) */
  next(): number;
  /** liczba całkowita z przedziału [min, max] (włącznie) */
  int(min: number, max: number): number;
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  weighted<T extends { weight: number }>(items: readonly T[]): T;
}

export function createRng(seed: number = Date.now() ^ (Math.random() * 0x7fffffff)): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    int: (min, max) => Math.floor(next() * (max - min + 1)) + min,
    chance: (p) => next() < p,
    pick: (items) => {
      if (items.length === 0) throw new Error('rng.pick: pusta lista');
      return items[Math.floor(next() * items.length)];
    },
    weighted: (items) => {
      if (items.length === 0) throw new Error('rng.weighted: pusta lista');
      const total = items.reduce((s, i) => s + Math.max(0, i.weight), 0);
      let roll = next() * total;
      for (const item of items) {
        roll -= Math.max(0, item.weight);
        if (roll < 0) return item;
      }
      return items[items.length - 1];
    },
  };
  return rng;
}

/** Wspólny RNG gry (poza testami). */
export const gameRng = createRng();

let uidCounter = 0;
/** Unikalny identyfikator — nie używamy crypto.randomUUID, bo nie działa po http:// w sieci LAN. */
export function newUid(prefix = 'c'): string {
  uidCounter = (uidCounter + 1) % 1_000_000;
  return `${prefix}-${Date.now().toString(36)}-${uidCounter.toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}
