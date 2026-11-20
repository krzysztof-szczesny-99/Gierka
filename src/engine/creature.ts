import { NATURE_IDS, type NatureId } from '../config/natures';
import { RULES } from '../config/rules';
import { expForLevel } from './experience';
import { newUid, type Rng } from './rng';
import { calcStats, randomIvs, ZERO_STATS } from './stats';
import { EMPTY_EVOLUTION_STATE, type Creature, type Gender, type GrowthTable, type MoveData, type MoveSlot, type PokemonData, type SpeciesData } from './types';

export interface CreateCreatureParams {
  pokemon: PokemonData;
  species: SpeciesData;
  growth: GrowthTable;
  level: number;
  moves: MoveData[];
  rng: Rng;
  metAt: string;
  shiny?: boolean;
  mighty?: boolean;
  /** Wymuszona natura (testy); domyślnie losowana. */
  nature?: NatureId;
}

/** Nazwa wyświetlana formy, np. „Rattata (Alola)”. */
export function formDisplayName(pokemon: PokemonData, species: SpeciesData): string {
  if (pokemon.name === species.name || pokemon.isDefault) return species.displayName;
  const suffix = pokemon.name.startsWith(species.name + '-') ? pokemon.name.slice(species.name.length + 1) : pokemon.name;
  const pretty = suffix
    .split('-')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
  return `${species.displayName} (${pretty})`;
}

function rollGender(species: SpeciesData, rng: Rng): Gender {
  if (species.genderRate < 0) return 'N';
  return rng.chance(species.genderRate / 8) ? 'F' : 'M';
}

export function toMoveSlot(move: MoveData): MoveSlot {
  const pp = Math.max(1, move.pp || 10);
  return { name: move.name, pp, maxPp: pp };
}

export function createCreature(p: CreateCreatureParams): Creature {
  const mighty = p.mighty ?? false;
  const level = Math.max(1, Math.min(RULES.maxLevel, p.level));
  const ivs = randomIvs(p.rng, mighty ? RULES.mightyMinIv : 0);
  const evs = { ...ZERO_STATS };
  const normalAbilities = p.pokemon.abilities.filter((a) => !a.hidden);
  const abilityId = (normalAbilities.length ? p.rng.pick(normalAbilities) : p.pokemon.abilities[0])?.name ?? 'brak';
  const gender = rollGender(p.species, p.rng);
  const shiny = p.shiny ?? p.rng.chance(RULES.shinyChance);
  // Natura losowana na końcu (ta sama, kontrolowana losowość co reszta — ziarno w trybie ?debug&seed).
  const nature = p.nature ?? p.rng.pick(NATURE_IDS);
  const stats = calcStats(p.pokemon.baseStats, ivs, evs, level, nature);
  return {
    uid: newUid(),
    pokemon: p.pokemon.name,
    speciesId: p.species.id,
    name: formDisplayName(p.pokemon, p.species),
    types: [...p.pokemon.types],
    level,
    exp: expForLevel(p.growth, level),
    growthRate: p.species.growthRate,
    ivs,
    evs,
    stats,
    hp: stats.hp,
    status: null,
    sleepTurns: 0,
    moves: p.moves.slice(0, RULES.maxMoves).map(toMoveSlot),
    nature,
    abilityId,
    gender,
    shiny,
    mighty,
    heldItemId: null,
    evolutionState: { ...EMPTY_EVOLUTION_STATE },
    friendship: p.species.baseHappiness,
    metLevel: level,
    metAt: p.metAt,
    caughtAt: 0,
  };
}

/** Przelicza statystyki po zmianie poziomu/EV/gatunku (z naturą), zachowując utracone PŻ. */
export function recalcStats(c: Creature, pokemon: PokemonData): Creature {
  const stats = calcStats(pokemon.baseStats, c.ivs, c.evs, c.level, c.nature);
  const lost = c.stats.hp - c.hp;
  const hp = c.hp <= 0 ? 0 : Math.max(1, stats.hp - lost);
  return { ...c, stats, hp };
}

export function displayName(c: Pick<Creature, 'name' | 'nickname'>): string {
  return c.nickname?.trim() || c.name;
}

export function healCreature(c: Creature): Creature {
  return {
    ...c,
    hp: c.stats.hp,
    status: null,
    sleepTurns: 0,
    moves: c.moves.map((m) => ({ ...m, pp: m.maxPp })),
  };
}

export function isFainted(c: Creature): boolean {
  return c.hp <= 0;
}
