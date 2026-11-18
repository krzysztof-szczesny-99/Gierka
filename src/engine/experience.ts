import { RULES } from '../config/rules';
import type { GrowthTable } from './types';

export function expForLevel(table: GrowthTable, level: number): number {
  const l = Math.max(1, Math.min(RULES.maxLevel, level));
  const v = table[l];
  if (v !== undefined) return v;
  // awaryjnie: krzywa „średnio szybka” (n^3), gdyby tabela była niepełna
  return l <= 1 ? 0 : l ** 3;
}

export function levelFromExp(table: GrowthTable, exp: number): number {
  let level = 1;
  while (level < RULES.maxLevel && exp >= expForLevel(table, level + 1)) level++;
  return level;
}

/** Postęp paska EXP w obrębie aktualnego poziomu (0..1). */
export function expProgress(table: GrowthTable, level: number, exp: number): number {
  if (level >= RULES.maxLevel) return 1;
  const lo = expForLevel(table, level);
  const hi = expForLevel(table, level + 1);
  if (hi <= lo) return 1;
  return Math.max(0, Math.min(1, (exp - lo) / (hi - lo)));
}

/** Doświadczenie za pokonanie przeciwnika, dzielone między uczestników walki. */
export function expYield(
  baseExp: number,
  defeatedLevel: number,
  opts: { trainer: boolean; participants: number },
): number {
  const raw = (baseExp * defeatedLevel) / RULES.expDivisor;
  const mult = opts.trainer ? RULES.trainerExpMultiplier : 1;
  return Math.max(1, Math.floor((raw * mult) / Math.max(1, opts.participants)));
}
