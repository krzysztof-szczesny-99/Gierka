// Działanie zdolności (src/config/abilities.ts) i przedmiotów trzymanych (src/config/items.ts) w walce —
// czyste funkcje pomocnicze używane przez silnik walki i wzór na obrażenia.

import { abilityDef, type AbilityEffect } from '../../config/abilities';
import { ITEMS, isHeldItemId, type HeldEffect } from '../../config/items';
import type { BoostKey, Creature, MajorStatus, MoveData } from '../types';

type AbilityOf<K extends AbilityEffect['kind']> = Extract<AbilityEffect, { kind: K }>;
type HeldOf<K extends HeldEffect['kind']> = Extract<HeldEffect, { kind: K }>;

/** Działanie zdolności stworzenia danego rodzaju (albo null). */
export function abilityEffect<K extends AbilityEffect['kind']>(c: Pick<Creature, 'abilityId'>, kind: K): AbilityOf<K> | null {
  const e = abilityDef(c.abilityId)?.effect;
  return e && e.kind === kind ? (e as AbilityOf<K>) : null;
}

export function abilityName(c: Pick<Creature, 'abilityId'>): string {
  return abilityDef(c.abilityId)?.name ?? c.abilityId;
}

/** Działanie przedmiotu trzymanego danego rodzaju (albo null). */
export function heldEffect<K extends HeldEffect['kind']>(c: Pick<Creature, 'heldItemId'>, kind: K): HeldOf<K> | null {
  if (!isHeldItemId(c.heldItemId)) return null;
  const e = ITEMS[c.heldItemId].held;
  return e && e.kind === kind ? (e as HeldOf<K>) : null;
}

export function heldName(c: Pick<Creature, 'heldItemId'>): string {
  return isHeldItemId(c.heldItemId) ? ITEMS[c.heldItemId].name : '';
}

/** Zdolność chroniąca przed statusem głównym. */
export function abilityBlocksStatus(c: Pick<Creature, 'abilityId'>, status: MajorStatus): boolean {
  return abilityEffect(c, 'status-immunity')?.status === status;
}

/** Zdolność chroniąca przed obniżeniem statystyki przez przeciwnika. */
export function abilityBlocksFoeDrop(c: Pick<Creature, 'abilityId'>, stat: BoostKey): boolean {
  const e = abilityEffect(c, 'block-foe-drop');
  return !!e && (e.stats === 'all' || e.stats.includes(stat));
}

/** Mnożnik obrażeń po stronie atakującego: zdolność „w opałach” i przedmioty wzmacniające. */
export function attackerDamageMultiplier(attacker: Creature, move: MoveData): number {
  let m = 1;
  const pinch = abilityEffect(attacker, 'pinch-boost');
  if (pinch && move.type === pinch.type && attacker.hp > 0 && attacker.hp <= Math.floor(attacker.stats.hp * pinch.hpFraction)) {
    m *= pinch.multiplier;
  }
  const typeBoost = heldEffect(attacker, 'type-boost');
  if (typeBoost && move.type === typeBoost.type) m *= typeBoost.multiplier;
  const classBoost = heldEffect(attacker, 'class-boost');
  if (classBoost && move.damageClass === classBoost.damageClass) m *= classBoost.multiplier;
  return m;
}

/** Mnożnik obrażeń po stronie broniącego się (zdolność osłabiająca wybrane typy). */
export function defenderDamageMultiplier(defender: Creature, move: MoveData): number {
  const resist = abilityEffect(defender, 'resist-types');
  return resist && (resist.types as string[]).includes(move.type) ? resist.multiplier : 1;
}

/** Mnożnik szybkości z przedmiotu trzymanego. */
export function heldSpeedMultiplier(c: Creature): number {
  return heldEffect(c, 'training-weight')?.speedMultiplier ?? 1;
}

/** Mnożnik zdobywanych punktów wysiłku z przedmiotu trzymanego. */
export function heldEvMultiplier(c: Creature): number {
  return heldEffect(c, 'training-weight')?.evMultiplier ?? 1;
}
