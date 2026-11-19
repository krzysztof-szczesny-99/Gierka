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

/** Buduje pełny interfejs Rng na podstawie źródła liczb [0, 1). */
export function rngFromNext(next: () => number): Rng {
  return {
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
      if (!(total > 0)) throw new Error('rng.weighted: suma wag musi być dodatnia');
      let roll = next() * total;
      for (const item of items) {
        roll -= Math.max(0, item.weight);
        if (roll < 0) return item;
      }
      // Zaokrąglenia: ostatni element o dodatniej wadze.
      for (let i = items.length - 1; i >= 0; i--) if (items[i].weight > 0) return items[i];
      return items[items.length - 1];
    },
  };
}

export interface SeedableRng extends Rng {
  /** Ustawia ziarno — od tej chwili sekwencja jest powtarzalna. */
  reseed(seed: number): void;
}

export function createRng(seed: number = Date.now() ^ (Math.random() * 0x7fffffff)): SeedableRng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    ...rngFromNext(next),
    reseed: (s: number) => {
      a = s >>> 0;
    },
  };
}

/** Kontrolowane źródło losowości (testy, tryb ?debug): powtarza podane wartości [0, 1) w kółko. */
export function createSequenceRng(values: readonly number[]): Rng {
  if (!values.length) throw new Error('createSequenceRng: pusta sekwencja');
  let i = 0;
  return rngFromNext(() => {
    const v = values[i % values.length];
    i += 1;
    return Math.min(Math.max(v, 0), 0.999999999);
  });
}

/** Wspólny RNG gry (poza testami). W trybie ?debug&seed=N ustawiany na stałe ziarno (main.tsx). */
export const gameRng = createRng();

let uidCounter = 0;
/** Unikalny identyfikator — nie używamy crypto.randomUUID, bo nie działa po http:// w sieci LAN. */
export function newUid(prefix = 'c'): string {
  uidCounter = (uidCounter + 1) % 1_000_000;
  return `${prefix}-${Date.now().toString(36)}-${uidCounter.toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}
