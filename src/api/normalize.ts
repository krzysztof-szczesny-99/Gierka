// Zamiana surowych odpowiedzi PokéAPI na zwięzłe rekordy domenowe (mniej danych w IndexedDB).

import type { TypeRelations } from '../engine/typeChart';
import {
  isTypeName,
  type BoostKey,
  type DamageClass,
  type GrowthTable,
  type LevelMove,
  type MoveData,
  type PokemonData,
  type SpeciesData,
  type SpriteSet,
  type StatKey,
  type Stats,
  type TypeName,
} from '../engine/types';
import { idFromUrl } from './pokeapi';
import type { RawGrowthRate, RawMove, RawName, RawPokemon, RawSpecies, RawSprites, RawType } from './raw';

const STAT_MAP: Record<string, StatKey> = {
  hp: 'hp',
  attack: 'atk',
  defense: 'def',
  'special-attack': 'spa',
  'special-defense': 'spd',
  speed: 'spe',
};

const BOOST_MAP: Record<string, BoostKey> = {
  attack: 'atk',
  defense: 'def',
  'special-attack': 'spa',
  'special-defense': 'spd',
  speed: 'spe',
  accuracy: 'acc',
  evasion: 'eva',
};

/**
 * Kolejność preferowanych wersji gier dla zestawów ruchów (najnowsze najpierw).
 * Jeżeli gatunku nie ma w żadnej z nich, wybieramy wersję z największą liczbą ruchów.
 */
export const LEARNSET_PRIORITY = [
  'scarlet-violet',
  'sword-shield',
  'brilliant-diamond-shining-pearl',
  'ultra-sun-ultra-moon',
  'sun-moon',
  'omega-ruby-alpha-sapphire',
  'x-y',
  'black-2-white-2',
  'black-white',
  'heartgold-soulsilver',
  'platinum',
  'diamond-pearl',
  'emerald',
  'firered-leafgreen',
  'ruby-sapphire',
  'crystal',
  'gold-silver',
  'yellow',
  'red-blue',
];

export function englishName(names: RawName[] | undefined, fallback: string): string {
  const en = names?.find((n) => n.language.name === 'en')?.name;
  if (en) return en;
  return fallback
    .split('-')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

function emptyStats(): Stats {
  return { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
}

export function pickLearnset(raw: RawPokemon['moves']): { version: string | null; moves: LevelMove[] } {
  const byVersion = new Map<string, Map<string, number>>();
  for (const m of raw) {
    for (const d of m.version_group_details) {
      if (d.move_learn_method.name !== 'level-up') continue;
      const vg = d.version_group.name;
      let map = byVersion.get(vg);
      if (!map) {
        map = new Map();
        byVersion.set(vg, map);
      }
      const level = Math.max(1, d.level_learned_at);
      const prev = map.get(m.move.name);
      if (prev === undefined || level < prev) map.set(m.move.name, level);
    }
  }
  let version: string | null = LEARNSET_PRIORITY.find((v) => (byVersion.get(v)?.size ?? 0) > 0) ?? null;
  if (!version) {
    let best = 0;
    for (const [vg, map] of byVersion) {
      if (map.size > best) {
        best = map.size;
        version = vg;
      }
    }
  }
  const chosen = version ? byVersion.get(version)! : new Map<string, number>();
  const moves = [...chosen.entries()]
    .map(([name, level]) => ({ name, level }))
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  return { version, moves };
}

function normalizeSprites(s: RawSprites): SpriteSet {
  const sd = s.other?.showdown;
  const bw = s.versions?.['generation-v']?.['black-white']?.animated;
  return {
    front: s.front_default,
    back: s.back_default,
    frontShiny: s.front_shiny,
    backShiny: s.back_shiny,
    animFront: sd?.front_default ?? bw?.front_default ?? null,
    animBack: sd?.back_default ?? bw?.back_default ?? null,
    animFrontShiny: sd?.front_shiny ?? bw?.front_shiny ?? null,
    animBackShiny: sd?.back_shiny ?? bw?.back_shiny ?? null,
  };
}

export function normalizePokemon(raw: RawPokemon): PokemonData {
  const baseStats = emptyStats();
  const evYield = emptyStats();
  for (const s of raw.stats) {
    const k = STAT_MAP[s.stat.name];
    if (!k) continue;
    baseStats[k] = s.base_stat;
    evYield[k] = s.effort;
  }
  const types = [...raw.types]
    .sort((a, b) => a.slot - b.slot)
    .map((t) => t.type.name)
    .filter(isTypeName) as TypeName[];
  const learnset = pickLearnset(raw.moves);
  return {
    id: raw.id,
    name: raw.name,
    speciesId: idFromUrl(raw.species.url),
    speciesName: raw.species.name,
    isDefault: raw.is_default,
    types: types.length ? types : ['normal'],
    baseStats,
    evYield,
    baseExp: raw.base_experience ?? 60,
    abilities: [...raw.abilities]
      .sort((a, b) => a.slot - b.slot)
      .map((a) => ({ name: a.ability.name, hidden: a.is_hidden })),
    levelMoves: learnset.moves,
    learnsetVersion: learnset.version,
    sprites: normalizeSprites(raw.sprites),
    height: raw.height,
    weight: raw.weight,
  };
}

export function normalizeSpecies(raw: RawSpecies): SpeciesData {
  return {
    id: raw.id,
    name: raw.name,
    displayName: englishName(raw.names, raw.name),
    captureRate: raw.capture_rate,
    baseHappiness: raw.base_happiness ?? 50,
    growthRate: raw.growth_rate.name,
    genderRate: raw.gender_rate,
    isLegendary: raw.is_legendary,
    isMythical: raw.is_mythical,
    isBaby: raw.is_baby,
    generation: idFromUrl(raw.generation.url),
    evolutionChainId: raw.evolution_chain ? idFromUrl(raw.evolution_chain.url) : null,
    varieties: raw.varieties.map((v) => ({ name: v.pokemon.name, isDefault: v.is_default })),
  };
}

export function normalizeMove(raw: RawMove): MoveData {
  const dc = raw.damage_class?.name;
  const damageClass: DamageClass = dc === 'physical' || dc === 'special' ? dc : 'status';
  const m = raw.meta;
  return {
    name: raw.name,
    displayName: englishName(raw.names, raw.name),
    type: raw.type.name,
    power: raw.power,
    accuracy: raw.accuracy,
    pp: raw.pp ?? 10,
    priority: raw.priority ?? 0,
    damageClass,
    target: raw.target?.name ?? 'selected-pokemon',
    effectChance: raw.effect_chance,
    meta: m
      ? {
          ailment: m.ailment?.name ?? 'none',
          ailmentChance: m.ailment_chance ?? 0,
          category: m.category?.name ?? 'damage',
          minHits: m.min_hits,
          maxHits: m.max_hits,
          minTurns: m.min_turns,
          maxTurns: m.max_turns,
          drain: m.drain ?? 0,
          healing: m.healing ?? 0,
          critRate: m.crit_rate ?? 0,
          flinchChance: m.flinch_chance ?? 0,
          statChance: m.stat_chance ?? 0,
        }
      : null,
    statChanges: raw.stat_changes
      .map((s) => ({ stat: BOOST_MAP[s.stat.name], change: s.change }))
      .filter((s): s is { stat: BoostKey; change: number } => !!s.stat),
  };
}

export function normalizeType(raw: RawType): TypeRelations {
  return {
    name: raw.name,
    double: raw.damage_relations.double_damage_to.map((t) => t.name),
    half: raw.damage_relations.half_damage_to.map((t) => t.name),
    none: raw.damage_relations.no_damage_to.map((t) => t.name),
  };
}

export function normalizeGrowth(raw: RawGrowthRate): GrowthTable {
  const table: GrowthTable = [0];
  for (const l of raw.levels) table[l.level] = l.experience;
  // uzupełnij ewentualne luki
  for (let i = 1; i <= 100; i++) if (table[i] === undefined) table[i] = table[i - 1] ?? 0;
  return table;
}
