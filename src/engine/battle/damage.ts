import { FIXED_DAMAGE } from '../../config/moveOverrides';
import { RULES } from '../../config/rules';
import type { Rng } from '../rng';
import { stageMultiplier } from '../stats';
import { effectiveness } from '../typeChart';
import type { Creature, MoveData, TypeChart } from '../types';
import { attackerDamageMultiplier, defenderDamageMultiplier } from './effects';
import type { Boosts } from './types';

export interface DamageInput {
  attacker: Creature;
  defender: Creature;
  attackerBoosts: Boosts;
  defenderBoosts: Boosts;
  move: MoveData;
  chart: TypeChart;
  rng: Rng;
  /** Wymuszenie krytyka/braku (testy). */
  forceCrit?: boolean;
  /** Stały czynnik losowy 85..100 (testy). */
  forceRandom?: number;
  typeless?: boolean;
}

export interface DamageResult {
  damage: number;
  effectiveness: number;
  crit: boolean;
}

export function critChance(stage: number): number {
  const table = RULES.critStageChance;
  return table[Math.max(0, Math.min(table.length - 1, stage))];
}

/**
 * Obrażenia wg ogólnie znanego wzoru gatunku:
 * ((2·L/5+2)·Moc·A/D)/50+2, potem: oparzenie, krytyk, losowość, STAB, skuteczność typów.
 */
export function calcDamage(input: DamageInput): DamageResult {
  const { attacker, defender, move, chart, rng } = input;
  const eff = input.typeless ? 1 : effectiveness(chart, move.type, defender.types);
  if (eff === 0) return { damage: 0, effectiveness: 0, crit: false };

  const fixed = FIXED_DAMAGE[move.name];
  if (fixed) {
    const dmg = fixed({ attackerLevel: attacker.level, targetHp: defender.hp, targetMaxHp: defender.stats.hp });
    return { damage: Math.max(1, Math.floor(dmg)), effectiveness: 1, crit: false };
  }

  const power = move.power ?? RULES.fallbackPower;
  if (power <= 0) return { damage: 0, effectiveness: eff, crit: false };

  const crit = input.forceCrit ?? rng.chance(critChance(move.meta?.critRate ?? 0));
  const physical = move.damageClass === 'physical';
  let atkStage = physical ? input.attackerBoosts.atk : input.attackerBoosts.spa;
  let defStage = physical ? input.defenderBoosts.def : input.defenderBoosts.spd;
  if (crit) {
    // krytyk ignoruje niekorzystne modyfikatory
    atkStage = Math.max(0, atkStage);
    defStage = Math.min(0, defStage);
  }
  const A = Math.max(1, Math.floor((physical ? attacker.stats.atk : attacker.stats.spa) * stageMultiplier(atkStage)));
  const D = Math.max(1, Math.floor((physical ? defender.stats.def : defender.stats.spd) * stageMultiplier(defStage)));

  let base = Math.floor(Math.floor((Math.floor((2 * attacker.level) / 5 + 2) * power * A) / D) / 50) + 2;
  if (physical && attacker.status === 'brn') base = Math.floor(base / 2);
  if (crit) base = Math.floor(base * RULES.critMultiplier);
  const rand = input.forceRandom ?? rng.int(RULES.randomMin, 100);
  base = Math.floor((base * rand) / 100);
  if (!input.typeless && attacker.types.includes(move.type as never)) base = Math.floor(base * RULES.stabMultiplier);
  base = Math.floor(base * eff);
  // Zdolności i przedmioty trzymane (Sprint 4): np. „Płomień” w opałach, „Węgielek”, „Gruby tłuszcz”.
  if (!input.typeless) {
    const mod = attackerDamageMultiplier(attacker, move) * defenderDamageMultiplier(defender, move);
    if (mod !== 1) base = Math.floor(base * mod);
  }
  return { damage: Math.max(1, base), effectiveness: eff, crit };
}
