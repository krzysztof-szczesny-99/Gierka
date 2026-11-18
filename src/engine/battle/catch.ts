import { RULES } from '../../config/rules';
import type { Rng } from '../rng';
import type { MajorStatus } from '../types';

export interface CatchInput {
  maxHp: number;
  hp: number;
  captureRate: number;
  catchBonus: number;
  status: MajorStatus | null;
}

export interface CatchResult {
  /** Liczba „drgnięć” kapsuły (0–3) do animacji. */
  shakes: number;
  caught: boolean;
}

/** Wartość „a” — im wyższa, tym łatwiej złapać (≥255 = pewne złapanie). */
export function catchValue(input: CatchInput): number {
  const statusBonus = input.status ? (RULES.catchStatusBonus[input.status] ?? 1) : 1;
  const hpFactor = 3 * input.maxHp - 2 * Math.max(1, input.hp);
  const a = Math.floor((hpFactor * input.captureRate * input.catchBonus) / (3 * input.maxHp)) * statusBonus;
  return Math.max(1, Math.floor(a));
}

/**
 * Próba złapania: 4 niezależne testy drgnięć (ogólny schemat znany z gatunku).
 * Złapanie następuje, gdy wszystkie 4 testy się powiodą; animacja pokazuje maks. 3 drgnięcia.
 */
export function attemptCatch(input: CatchInput, rng: Rng): CatchResult {
  const a = catchValue(input);
  if (a >= 255) return { shakes: 3, caught: true };
  const b = Math.floor(1048560 / Math.sqrt(Math.sqrt(16711680 / a)));
  for (let i = 0; i < 4; i++) {
    if (rng.int(0, 65535) >= b) return { shakes: Math.min(3, i), caught: false };
  }
  return { shakes: 3, caught: true };
}

/** Przybliżona szansa złapania (0..1) — do podpowiedzi w UI. */
export function catchProbability(input: CatchInput): number {
  const a = catchValue(input);
  if (a >= 255) return 1;
  const b = Math.floor(1048560 / Math.sqrt(Math.sqrt(16711680 / a)));
  return Math.pow(Math.min(1, b / 65536), 4);
}
