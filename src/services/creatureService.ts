// Budowanie stworzeń z danych PokéAPI (dzikie, startery) i pomocnicze ładowanie ruchów.

import type { EncounterEntry, EncounterTable } from '../config/encounters';
import { FALLBACK_DAMAGE_MOVE } from '../config/moveOverrides';
import { RULES } from '../config/rules';
import { getGrowth, getMove, getPokemon, getSpecies } from '../data/repository';
import { createCreature } from '../engine/creature';
import { isDamaging, movesForLevel } from '../engine/moves';
import type { Rng } from '../engine/rng';
import type { Creature, GrowthTable, MoveData, PokemonData, SpeciesData } from '../engine/types';
import type { DexEntry } from '../state/gameStore';

export interface CreatureBundle {
  pokemon: PokemonData;
  species: SpeciesData;
  growth: GrowthTable;
}

export interface WildSpawn {
  creature: Creature;
  pokemon: PokemonData;
  species: SpeciesData;
  zoneId: string;
  zoneName: string;
  aggressive: boolean;
}

export async function loadBundle(name: string): Promise<CreatureBundle> {
  const pokemon = await getPokemon(name);
  const species = await getSpecies(pokemon.speciesId);
  const growth = await getGrowth(species.growthRate);
  return { pokemon, species, growth };
}

/** Pobiera ruchy; pojedyncze błędy nie przerywają całości. */
export async function loadMovesSafe(names: string[]): Promise<Record<string, MoveData>> {
  const unique = [...new Set(names)];
  const results = await Promise.allSettled(unique.map((n) => getMove(n)));
  const out: Record<string, MoveData> = {};
  results.forEach((r) => {
    if (r.status === 'fulfilled') out[r.value.name] = r.value;
  });
  return out;
}

/** Zestaw ruchów na dany poziom; gwarantuje co najmniej jeden ruch zadający obrażenia. */
export async function movesFor(pokemon: PokemonData, level: number): Promise<MoveData[]> {
  const names = movesForLevel(pokemon.levelMoves, level);
  const map = await loadMovesSafe(names);
  let list = names.map((n) => map[n]).filter((m): m is MoveData => !!m);
  if (!list.some(isDamaging)) {
    try {
      const fallback = await getMove(FALLBACK_DAMAGE_MOVE);
      list = [...list.slice(0, RULES.maxMoves - 1), fallback];
    } catch {
      /* offline i brak w buforze — walka i tak zadziała (ruch awaryjny) */
    }
  }
  return list;
}

export async function buildWild(
  entry: EncounterEntry,
  table: EncounterTable,
  zone: { id: string; name: string },
  rng: Rng,
): Promise<WildSpawn> {
  const mighty = rng.chance(table.mightyChance ?? RULES.mightyChance);
  const level = Math.min(RULES.maxLevel, rng.int(entry.min, entry.max) + (mighty ? RULES.mightyLevelBonus : 0));
  const b = await loadBundle(entry.pokemon);
  const moves = await movesFor(b.pokemon, level);
  const creature = createCreature({ ...b, level, moves, rng, metAt: zone.name, mighty });
  return {
    creature,
    pokemon: b.pokemon,
    species: b.species,
    zoneId: zone.id,
    zoneName: zone.name,
    aggressive: mighty || rng.chance(table.aggressiveChance),
  };
}

export async function buildStarter(name: string, level: number, rng: Rng): Promise<{ creature: Creature; bundle: CreatureBundle }> {
  const bundle = await loadBundle(name);
  const moves = await movesFor(bundle.pokemon, level);
  const creature = createCreature({ ...bundle, level, moves, rng, metAt: 'Polana Startowa', shiny: false });
  return { creature, bundle };
}

export function dexInfo(pokemon: PokemonData, species: SpeciesData): Omit<DexEntry, 'seen' | 'caught'> {
  return { id: species.id, name: species.displayName, sprite: pokemon.sprites.front, types: pokemon.types };
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return 'Wystąpił nieoczekiwany błąd.';
}
