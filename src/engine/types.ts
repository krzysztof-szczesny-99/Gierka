// Typy domenowe wspólne dla silnika, danych i UI. Bez zależności od React/Phaser.

import type { NatureId } from '../config/natures';

export const TYPE_NAMES = [
  'normal',
  'fighting',
  'flying',
  'poison',
  'ground',
  'rock',
  'bug',
  'ghost',
  'steel',
  'fire',
  'water',
  'grass',
  'electric',
  'psychic',
  'ice',
  'dragon',
  'dark',
  'fairy',
] as const;

export type TypeName = (typeof TYPE_NAMES)[number];

export function isTypeName(v: string): v is TypeName {
  return (TYPE_NAMES as readonly string[]).includes(v);
}

export type StatKey = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe';
export type BoostKey = 'atk' | 'def' | 'spa' | 'spd' | 'spe' | 'acc' | 'eva';
export type Stats = Record<StatKey, number>;
export type MajorStatus = 'par' | 'slp' | 'frz' | 'brn' | 'psn';
export type DamageClass = 'physical' | 'special' | 'status';
export type Dir = 'up' | 'down' | 'left' | 'right';
export type Gender = 'M' | 'F' | 'N';

export const STAT_KEYS: readonly StatKey[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

export interface SpriteSet {
  front: string | null;
  back: string | null;
  frontShiny: string | null;
  backShiny: string | null;
  animFront: string | null;
  animBack: string | null;
  animFrontShiny: string | null;
  animBackShiny: string | null;
}

export interface LevelMove {
  name: string;
  level: number;
}

/** Znormalizowane dane wariantu (formy) z /pokemon/{name}. */
export interface PokemonData {
  id: number;
  name: string;
  speciesId: number;
  speciesName: string;
  isDefault: boolean;
  types: TypeName[];
  baseStats: Stats;
  evYield: Stats;
  baseExp: number;
  abilities: { name: string; hidden: boolean }[];
  levelMoves: LevelMove[];
  learnsetVersion: string | null;
  sprites: SpriteSet;
  height: number;
  weight: number;
}

/** Znormalizowane dane gatunku z /pokemon-species/{id}. */
export interface SpeciesData {
  id: number;
  name: string;
  displayName: string;
  captureRate: number;
  baseHappiness: number;
  growthRate: string;
  genderRate: number;
  isLegendary: boolean;
  isMythical: boolean;
  isBaby: boolean;
  generation: number;
  evolutionChainId: number | null;
  varieties: { name: string; isDefault: boolean }[];
}

export interface MoveMeta {
  ailment: string;
  ailmentChance: number;
  category: string;
  minHits: number | null;
  maxHits: number | null;
  minTurns: number | null;
  maxTurns: number | null;
  drain: number;
  healing: number;
  critRate: number;
  flinchChance: number;
  statChance: number;
}

export interface MoveData {
  name: string;
  displayName: string;
  type: string;
  power: number | null;
  accuracy: number | null;
  pp: number;
  priority: number;
  damageClass: DamageClass;
  target: string;
  effectChance: number | null;
  meta: MoveMeta | null;
  statChanges: { stat: BoostKey; change: number }[];
}

/** typeChart[atakujący][broniący] = mnożnik (brak wpisu = 1). */
export type TypeChart = Record<string, Record<string, number>>;

/** growth[level] = łączne doświadczenie wymagane na dany poziom (indeks 1..100). */
export type GrowthTable = number[];

export interface MoveSlot {
  name: string;
  pp: number;
  maxPp: number;
}

/**
 * Stan ewolucji stworzenia (zapis v3). Anulowana ewolucja przez poziom nie jest proponowana ponownie,
 * dopóki stworzenie nie awansuje powyżej poziomu anulowania.
 */
export interface EvolutionState {
  cancelledAtLevel: number | null;
  /** Wariant, z którego stworzenie wyewoluowało (historia; null — nie ewoluowało). */
  evolvedFrom: string | null;
}

export const EMPTY_EVOLUTION_STATE: EvolutionState = { cancelledAtLevel: null, evolvedFrom: null };

/** Konkretne stworzenie gracza lub dzikie. */
export interface Creature {
  uid: string;
  pokemon: string;
  speciesId: number;
  name: string;
  nickname?: string;
  types: TypeName[];
  level: number;
  exp: number;
  growthRate: string;
  ivs: Stats;
  evs: Stats;
  stats: Stats;
  hp: number;
  status: MajorStatus | null;
  sleepTurns: number;
  moves: MoveSlot[];
  /** Natura (zapis v3): +10% / −10% do dwóch statystyk albo neutralna. */
  nature: NatureId;
  /** Zdolność — identyfikator z PokéAPI; działające zdolności: src/config/abilities.ts. */
  abilityId: string;
  gender: Gender;
  shiny: boolean;
  mighty: boolean;
  /** Przedmiot trzymany (ItemId rodzaju „held” z src/config/items.ts) albo brak. */
  heldItemId: string | null;
  evolutionState: EvolutionState;
  friendship: number;
  metLevel: number;
  metAt: string;
  caughtAt: number;
}
