// Pomocnicze dane do testów zdolności, przedmiotów i natur (Sprint 4) — bez sieci.

import { createWildBattle } from '../battle/battleEngine';
import type { BattleState } from '../battle/types';
import type { Rng } from '../rng';
import type { Creature, MoveData, PokemonData } from '../types';
import { chart, growthMedium, makeCreature, moves as baseMoves } from './fixtures';

const meta = (o: Partial<NonNullable<MoveData['meta']>> = {}): NonNullable<MoveData['meta']> => ({
  ailment: 'none',
  ailmentChance: 0,
  category: 'damage',
  minHits: null,
  maxHits: null,
  minTurns: null,
  maxTurns: null,
  drain: 0,
  healing: 0,
  critRate: 0,
  flinchChance: 0,
  statChance: 0,
  ...o,
});

const dmg = (name: string, type: string, power: number, damageClass: 'physical' | 'special', m: Partial<NonNullable<MoveData['meta']>> = {}, statChanges: MoveData['statChanges'] = []): MoveData => ({
  name,
  displayName: name,
  type,
  power,
  accuracy: 100,
  pp: 30,
  priority: 0,
  damageClass,
  target: 'selected-pokemon',
  effectChance: null,
  meta: meta(m),
  statChanges,
});

const status = (name: string, type: string, m: Partial<NonNullable<MoveData['meta']>>, statChanges: MoveData['statChanges'] = [], target = 'selected-pokemon'): MoveData => ({
  name,
  displayName: name,
  type,
  power: null,
  accuracy: null,
  pp: 30,
  priority: 0,
  damageClass: 'status',
  target,
  effectChance: null,
  meta: meta(m),
  statChanges,
});

export const MOVES: Record<string, MoveData> = {
  ...baseMoves,
  'vine-whip': dmg('vine-whip', 'grass', 45, 'physical'),
  'water-gun': dmg('water-gun', 'water', 40, 'special'),
  'bug-bite': dmg('bug-bite', 'bug', 60, 'physical'),
  'ice-shard': dmg('ice-shard', 'ice', 40, 'physical'),
  'thunder-shock': dmg('thunder-shock', 'electric', 40, 'special'),
  'burn-strike': dmg('burn-strike', 'fire', 40, 'special', { ailment: 'burn', ailmentChance: 100, category: 'damage+ailment' }),
  'freeze-strike': dmg('freeze-strike', 'ice', 40, 'special', { ailment: 'freeze', ailmentChance: 100, category: 'damage+ailment' }),
  'flinch-strike': dmg('flinch-strike', 'normal', 40, 'physical', { flinchChance: 100 }),
  'acid-strike': dmg('acid-strike', 'normal', 40, 'special', { category: 'damage+lower', statChance: 100 }, [{ stat: 'spd', change: -1 }]),
  'sleep-powder': status('sleep-powder', 'grass', { ailment: 'sleep', category: 'ailment' }),
  'poison-powder': status('poison-powder', 'normal', { ailment: 'poison', category: 'ailment' }),
  'will-o-wisp': status('will-o-wisp', 'normal', { ailment: 'burn', category: 'ailment' }),
  'confuse-ray': status('confuse-ray', 'normal', { ailment: 'confusion', category: 'ailment' }),
  'sand-attack': status('sand-attack', 'normal', { category: 'net-good-stats' }, [{ stat: 'acc', change: -1 }]),
  leer: status('leer', 'normal', { category: 'net-good-stats' }, [{ stat: 'def', change: -1 }]),
  rest: status('rest', 'normal', { category: 'heal', healing: 100 }, [], 'user'),
  splash: status('splash', 'normal', { category: 'unique' }, [], 'user'),
};

export interface Fighter {
  types?: PokemonData['types'];
  level?: number;
  base?: number;
  moves: string[];
  patch?: Partial<Creature>;
}

/** Walka 1 na 1 z kontrolowanymi zdolnościami/przedmiotami (patch) i wspólnymi ruchami testowymi. */
export function duel(rng: Rng, player: Fighter, enemy: Fighter): { state: BattleState; events: ReturnType<typeof createWildBattle>['events']; pokemon: Record<string, PokemonData> } {
  const p = makeCreature(rng, 'hero', player.types ?? ['normal'], player.level ?? 20, [], player.base ?? 60);
  const e = makeCreature(rng, 'wildy', enemy.types ?? ['normal'], enemy.level ?? 20, [], enemy.base ?? 60);
  const toSlots = (names: string[]) => names.map((n) => ({ name: n, pp: 30, maxPp: 30 }));
  const pc: Creature = { ...p.creature, moves: toSlots(player.moves), ...player.patch };
  const ec: Creature = { ...e.creature, moves: toSlots(enemy.moves), ...enemy.patch };
  const pokemon = { hero: p.pokemon, wildy: e.pokemon };
  const { state, events } = createWildBattle({
    playerName: 'Test',
    party: [pc],
    enemy: ec,
    pokemon,
    moves: MOVES,
    growth: { medium: growthMedium },
    typeChart: chart,
    captureRate: 255,
  });
  return { state, events, pokemon };
}

export const texts = (events: { t: string }[]) => events.filter((e): e is { t: 'msg'; text: string } => e.t === 'msg').map((e) => e.text);
