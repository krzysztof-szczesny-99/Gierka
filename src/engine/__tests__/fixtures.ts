// Dane testowe (wymyślone stworzenia i ruchy) — testy nie wymagają sieci.

import { createCreature } from '../creature';
import type { Rng } from '../rng';
import { buildTypeChart } from '../typeChart';
import type { GrowthTable, MoveData, PokemonData, SpeciesData } from '../types';

export const chart = buildTypeChart([
  { name: 'normal', double: [], half: ['rock', 'steel'], none: ['ghost'] },
  { name: 'fire', double: ['grass', 'ice', 'bug', 'steel'], half: ['fire', 'water', 'rock', 'dragon'], none: [] },
  { name: 'water', double: ['fire', 'ground', 'rock'], half: ['water', 'grass', 'dragon'], none: [] },
  { name: 'grass', double: ['water', 'ground', 'rock'], half: ['fire', 'grass', 'poison', 'flying', 'bug', 'dragon', 'steel'], none: [] },
  { name: 'electric', double: ['water', 'flying'], half: ['electric', 'grass', 'dragon'], none: ['ground'] },
]);

export const growthMedium: GrowthTable = Array.from({ length: 101 }, (_, l) => (l <= 1 ? 0 : l ** 3));

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

export const moves: Record<string, MoveData> = {
  tackle: {
    name: 'tackle',
    displayName: 'Tackle',
    type: 'normal',
    power: 40,
    accuracy: 100,
    pp: 35,
    priority: 0,
    damageClass: 'physical',
    target: 'selected-pokemon',
    effectChance: null,
    meta: meta(),
    statChanges: [],
  },
  ember: {
    name: 'ember',
    displayName: 'Ember',
    type: 'fire',
    power: 40,
    accuracy: 100,
    pp: 25,
    priority: 0,
    damageClass: 'special',
    target: 'selected-pokemon',
    effectChance: 10,
    meta: meta({ ailment: 'burn', ailmentChance: 10, category: 'damage+ailment' }),
    statChanges: [],
  },
  growl: {
    name: 'growl',
    displayName: 'Growl',
    type: 'normal',
    power: null,
    accuracy: 100,
    pp: 40,
    priority: 0,
    damageClass: 'status',
    target: 'all-opponents',
    effectChance: null,
    meta: meta({ category: 'net-good-stats' }),
    statChanges: [{ stat: 'atk', change: -1 }],
  },
  'thunder-wave': {
    name: 'thunder-wave',
    displayName: 'Thunder Wave',
    type: 'electric',
    power: null,
    accuracy: 90,
    pp: 20,
    priority: 0,
    damageClass: 'status',
    target: 'selected-pokemon',
    effectChance: null,
    meta: meta({ ailment: 'paralysis', category: 'ailment' }),
    statChanges: [],
  },
  'swords-dance': {
    name: 'swords-dance',
    displayName: 'Swords Dance',
    type: 'normal',
    power: null,
    accuracy: null,
    pp: 20,
    priority: 0,
    damageClass: 'status',
    target: 'user',
    effectChance: null,
    meta: meta({ category: 'net-good-stats' }),
    statChanges: [{ stat: 'atk', change: 2 }],
  },
};

const sprites = {
  front: null,
  back: null,
  frontShiny: null,
  backShiny: null,
  animFront: null,
  animBack: null,
  animFrontShiny: null,
  animBackShiny: null,
};

export function makePokemon(name: string, types: PokemonData['types'], base: number): PokemonData {
  return {
    id: 1,
    name,
    speciesId: 1,
    speciesName: name,
    isDefault: true,
    types,
    baseStats: { hp: base, atk: base, def: base, spa: base, spd: base, spe: base },
    evYield: { hp: 0, atk: 1, def: 0, spa: 0, spd: 0, spe: 0 },
    baseExp: 64,
    abilities: [{ name: 'test-ability', hidden: false }],
    levelMoves: [
      { name: 'tackle', level: 1 },
      { name: 'growl', level: 1 },
      { name: 'ember', level: 7 },
      { name: 'swords-dance', level: 9 },
    ],
    learnsetVersion: 'test',
    sprites,
    height: 5,
    weight: 50,
  };
}

export function makeSpecies(name: string, captureRate = 255): SpeciesData {
  return {
    id: 1,
    name,
    displayName: name.charAt(0).toUpperCase() + name.slice(1),
    captureRate,
    baseHappiness: 50,
    growthRate: 'medium',
    genderRate: 4,
    isLegendary: false,
    isMythical: false,
    isBaby: false,
    generation: 1,
    evolutionChainId: null,
    varieties: [{ name, isDefault: true }],
  };
}

export function makeCreature(
  rng: Rng,
  name: string,
  types: PokemonData['types'],
  level: number,
  moveNames: string[],
  base = 50,
) {
  const pokemon = makePokemon(name, types, base);
  return {
    pokemon,
    creature: createCreature({
      pokemon,
      species: makeSpecies(name),
      growth: growthMedium,
      level,
      moves: moveNames.map((m) => moves[m]),
      rng,
      metAt: 'test',
      shiny: false,
    }),
  };
}
