import { RULES } from '../config/rules';
import type { Rng } from './rng';
import { STAT_KEYS, type StatKey, type Stats } from './types';

export const ZERO_STATS: Stats = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

/** Standardowy wzór na statystykę (natury neutralne w MVP). */
export function calcStat(key: StatKey, base: number, iv: number, ev: number, level: number): number {
  const core = Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100);
  if (key === 'hp') {
    // Gatunki z bazowym HP = 1 (np. specjalne przypadki) zawsze mają 1 PŻ.
    if (base === 1) return 1;
    return core + level + 10;
  }
  return core + 5;
}

export function calcStats(base: Stats, ivs: Stats, evs: Stats, level: number): Stats {
  const out = { ...ZERO_STATS };
  for (const k of STAT_KEYS) out[k] = calcStat(k, base[k], ivs[k], evs[k], level);
  return out;
}

export function randomIvs(rng: Rng, min = 0): Stats {
  const out = { ...ZERO_STATS };
  for (const k of STAT_KEYS) out[k] = rng.int(min, 31);
  return out;
}

/** Mnożnik etapu statystyki -6..+6 (atak, obrona, szybkość itd.). */
export function stageMultiplier(stage: number): number {
  const s = Math.max(-6, Math.min(6, stage));
  return s >= 0 ? (2 + s) / 2 : 2 / (2 - s);
}

/** Mnożnik etapu celności/uniku -6..+6. */
export function accuracyStageMultiplier(stage: number): number {
  const s = Math.max(-6, Math.min(6, stage));
  return s >= 0 ? (3 + s) / 3 : 3 / (3 - s);
}

/** Dodaje punkty wysiłku z limitami na statystykę i łącznie. */
export function addEvs(evs: Stats, gain: Stats): Stats {
  const out = { ...evs };
  let total = STAT_KEYS.reduce((s, k) => s + out[k], 0);
  for (const k of STAT_KEYS) {
    const room = Math.min(RULES.evMaxPerStat - out[k], RULES.evMaxTotal - total);
    const add = Math.max(0, Math.min(room, gain[k]));
    out[k] += add;
    total += add;
  }
  return out;
}
