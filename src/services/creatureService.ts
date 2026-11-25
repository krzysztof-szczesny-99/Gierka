// Budowanie stworzeń z danych PokéAPI (dzikie, startery) i pomocnicze ładowanie ruchów.

import type { EncounterEntry, EncounterTable } from '../config/encounters';
import type { SpecialEncounterDef } from '../config/specialEncounters';
import type { TrainerMemberDef } from '../config/trainers';
import { assertAllowedSpecies, rollLevel } from '../game/encounterZones';
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

/** Dzikie stworzenie z wpisu tabeli: poziom z zakresu wpisu, szansa na „Potężny okaz”, ruchy na poziom. */
export async function buildWild(
  entry: EncounterEntry,
  table: EncounterTable,
  zone: { id: string; name: string },
  rng: Rng,
): Promise<WildSpawn> {
  const mighty = rng.chance(table.mightyChance ?? RULES.mightyChance);
  const level = Math.min(RULES.maxLevel, rollLevel(entry, rng) + (mighty ? RULES.mightyLevelBonus : 0));
  const b = await loadBundle(entry.pokemonId);
  assertAllowedSpecies(b.species, entry.encounterMethod);
  const moves = await movesFor(b.pokemon, level);
  const creature = createCreature({ ...b, level, moves, rng, metAt: zone.name, mighty });
  return {
    creature,
    pokemon: b.pokemon,
    species: b.species,
    zoneId: zone.id,
    zoneName: zone.name,
  };
}

/**
 * Stworzenie spotkania specjalnego (Sprint 7): gatunek i poziom z danych spotkania (bez losowania z tabeli);
 * „potężny okaz” — premia poziomu jak w zwykłych spotkaniach. Legendarne i mityczne są tu dozwolone.
 */
export async function buildSpecial(def: SpecialEncounterDef, zone: { id: string; name: string }, rng: Rng): Promise<WildSpawn> {
  const mighty = !!def.mighty;
  const level = Math.min(RULES.maxLevel, def.level + (mighty ? RULES.mightyLevelBonus : 0));
  const b = await loadBundle(def.pokemonId);
  assertAllowedSpecies(b.species, 'static');
  const moves = await movesFor(b.pokemon, level);
  const creature = createCreature({ ...b, level, moves, rng, metAt: zone.name, mighty });
  return { creature, pokemon: b.pokemon, species: b.species, zoneId: zone.id, zoneName: zone.name };
}

export async function buildStarter(name: string, level: number, rng: Rng): Promise<{ creature: Creature; bundle: CreatureBundle }> {
  const bundle = await loadBundle(name);
  const moves = await movesFor(bundle.pokemon, level);
  const creature = createCreature({ ...bundle, level, moves, rng, metAt: 'Polana Startowa', shiny: false });
  return { creature, bundle };
}

/**
 * Stworzenie trenera (Sprint 5): gatunek, poziom, ruchy, natura, zdolność i przedmiot z danych trenera;
 * czego dane nie podają — jak u dzikiego stworzenia (ruchy z listy nauki, natura i IV z ziarna gry).
 */
export async function buildTrainerCreature(member: TrainerMemberDef, trainerName: string, rng: Rng): Promise<{ creature: Creature; bundle: CreatureBundle }> {
  const bundle = await loadBundle(member.pokemonId);
  const moves = member.moves?.length ? await Promise.all(member.moves.slice(0, RULES.maxMoves).map((n) => getMove(n))) : await movesFor(bundle.pokemon, member.level);
  const creature = createCreature({ ...bundle, level: member.level, moves, rng, metAt: trainerName, shiny: false, mighty: false, nature: member.nature });
  if (member.abilityId) creature.abilityId = member.abilityId;
  creature.heldItemId = member.heldItemId ?? null;
  return { creature, bundle };
}

export function dexInfo(pokemon: PokemonData, species: SpeciesData): Omit<DexEntry, 'seen' | 'caught'> {
  return { id: species.id, name: species.displayName, sprite: pokemon.sprites.front, types: pokemon.types };
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return 'Wystąpił nieoczekiwany błąd.';
}
