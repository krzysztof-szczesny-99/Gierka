// Konfiguracja spotkań — JEDYNE miejsce z wartościami: tereny, szanse na krok, odnowienie, tabele stworzeń.
// Gatunki i formy (np. regionalne) pobieramy z PokéAPI po nazwie (pokemonId). Celowo mieszamy generacje.
// Zwykłe tabele nie zawierają stworzeń legendarnych ani mitycznych (dodatkowo pilnuje tego kod przy losowaniu).

/** Rodzaj terenu pod graczem (przypisany do kafelków w tiles.ts). */
export type TerrainType = 'NONE' | 'TALL_GRASS' | 'CAVE' | 'WATER' | 'SPECIAL';
export const TERRAIN_TYPES: readonly TerrainType[] = ['NONE', 'TALL_GRASS', 'CAVE', 'WATER', 'SPECIAL'];

/** Sposób spotkania zapisany we wpisie tabeli; teren wybiera wpisy o pasującej metodzie. */
export type EncounterMethod = 'grass' | 'cave' | 'water' | 'static';
export const TERRAIN_METHOD: Record<TerrainType, EncounterMethod | null> = {
  NONE: null,
  TALL_GRASS: 'grass',
  CAVE: 'cave',
  WATER: 'water',
  SPECIAL: 'static',
};

export type EncounterRarity = 'common' | 'uncommon' | 'rare' | 'very-rare';

/** Opcjonalne warunki (strefy, wpisu, spotkania specjalnego) — sprawdzane na flagach zapisu gry. */
export interface EncounterConditions {
  /** Wszystkie flagi muszą być ustawione. */
  flagsAll?: string[];
  /** Żadna z flag nie może być ustawiona. */
  flagsNone?: string[];
}

export interface EncounterEntry {
  /** Nazwa (lub numer) z PokéAPI, np. „rattata-alola”. */
  pokemonId: string;
  /** Waga względna — suma wag w tabeli nie musi wynosić 100. */
  weight: number;
  minLevel: number;
  maxLevel: number;
  encounterMethod: EncounterMethod;
  rarity: EncounterRarity;
  conditions?: EncounterConditions;
  /** Wersja danych (np. grupa wersji PokéAPI), z której pochodzi wpis — informacyjnie. */
  dataVersion?: string;
}

export interface EncounterTable {
  id: string;
  /** Nadpisanie szansy na „Potężny okaz” (domyślnie RULES.mightyChance). */
  mightyChance?: number;
  entries: EncounterEntry[];
}

export const ENCOUNTER_CONFIG = {
  /** Domyślna szansa na spotkanie na jeden poprawny krok, wg terenu. */
  baseRates: { NONE: 0, TALL_GRASS: 0.1, CAVE: 0.08, WATER: 0.08, SPECIAL: 0 } as Readonly<Record<TerrainType, number>>,
  /** Po każdym zakończonym spotkaniu tyle poprawnych kroków (na nowe pole) mija bez losowań. */
  cooldownSteps: 3,
  /** Kroki ochronne po wejściu na mapę (start gry, wczytanie, powrót do Stacji Opieki). */
  mapEnterSafeSteps: 2,
  /** Domyślny dystans (w krokach) między losowaniami w strefie. */
  defaultStepDistance: 1,
} as const;

/** Flaga zapisu oznaczająca, że spotkanie specjalne zostało zakończone (wygrana lub złapanie). */
export function staticDoneFlag(staticId: string): string {
  return `static-done:${staticId}`;
}

export const ENCOUNTER_TABLES: Record<string, EncounterTable> = {
  // Niewielka tabela testowa wysokiej trawy Polany Startowej (suma wag 36 — celowo różna od 100).
  meadow: {
    id: 'meadow',
    entries: [
      { pokemonId: 'pidgey', weight: 12, minLevel: 2, maxLevel: 4, encounterMethod: 'grass', rarity: 'common' },
      { pokemonId: 'sentret', weight: 10, minLevel: 2, maxLevel: 4, encounterMethod: 'grass', rarity: 'common' },
      { pokemonId: 'zigzagoon', weight: 6, minLevel: 3, maxLevel: 5, encounterMethod: 'grass', rarity: 'uncommon' },
      { pokemonId: 'starly', weight: 6, minLevel: 3, maxLevel: 5, encounterMethod: 'grass', rarity: 'uncommon' },
      { pokemonId: 'rattata-alola', weight: 2, minLevel: 3, maxLevel: 5, encounterMethod: 'grass', rarity: 'rare' },
    ],
  },
  pond: {
    id: 'pond',
    entries: [
      { pokemonId: 'psyduck', weight: 14, minLevel: 4, maxLevel: 6, encounterMethod: 'grass', rarity: 'common' },
      { pokemonId: 'marill', weight: 14, minLevel: 4, maxLevel: 6, encounterMethod: 'grass', rarity: 'common' },
      { pokemonId: 'lotad', weight: 14, minLevel: 3, maxLevel: 5, encounterMethod: 'grass', rarity: 'common' },
      { pokemonId: 'wooper', weight: 12, minLevel: 4, maxLevel: 6, encounterMethod: 'grass', rarity: 'common' },
      { pokemonId: 'wooper-paldea', weight: 6, minLevel: 4, maxLevel: 6, encounterMethod: 'grass', rarity: 'rare' },
      { pokemonId: 'buizel', weight: 10, minLevel: 4, maxLevel: 6, encounterMethod: 'grass', rarity: 'uncommon' },
      { pokemonId: 'tympole', weight: 10, minLevel: 4, maxLevel: 6, encounterMethod: 'grass', rarity: 'uncommon' },
      { pokemonId: 'wingull', weight: 10, minLevel: 4, maxLevel: 6, encounterMethod: 'grass', rarity: 'uncommon' },
    ],
  },
  // Skalisty grunt Skalnego Zakątka działa jak dno jaskini (teren CAVE).
  rocks: {
    id: 'rocks',
    entries: [
      { pokemonId: 'geodude', weight: 16, minLevel: 5, maxLevel: 7, encounterMethod: 'cave', rarity: 'common' },
      { pokemonId: 'geodude-alola', weight: 6, minLevel: 5, maxLevel: 7, encounterMethod: 'cave', rarity: 'rare' },
      { pokemonId: 'aron', weight: 12, minLevel: 5, maxLevel: 7, encounterMethod: 'cave', rarity: 'common' },
      { pokemonId: 'roggenrola', weight: 12, minLevel: 5, maxLevel: 7, encounterMethod: 'cave', rarity: 'common' },
      { pokemonId: 'zubat', weight: 12, minLevel: 4, maxLevel: 6, encounterMethod: 'cave', rarity: 'common' },
      { pokemonId: 'rolycoly', weight: 10, minLevel: 5, maxLevel: 7, encounterMethod: 'cave', rarity: 'uncommon' },
      { pokemonId: 'nacli', weight: 10, minLevel: 5, maxLevel: 7, encounterMethod: 'cave', rarity: 'uncommon' },
    ],
  },
  grove: {
    id: 'grove',
    mightyChance: 0.2,
    entries: [
      { pokemonId: 'eevee', weight: 18, minLevel: 6, maxLevel: 8, encounterMethod: 'grass', rarity: 'uncommon' },
      { pokemonId: 'ralts', weight: 16, minLevel: 6, maxLevel: 8, encounterMethod: 'grass', rarity: 'uncommon' },
      { pokemonId: 'riolu', weight: 14, minLevel: 7, maxLevel: 9, encounterMethod: 'grass', rarity: 'rare' },
      { pokemonId: 'vulpix-alola', weight: 14, minLevel: 6, maxLevel: 8, encounterMethod: 'grass', rarity: 'rare' },
      { pokemonId: 'larvitar', weight: 10, minLevel: 7, maxLevel: 9, encounterMethod: 'grass', rarity: 'very-rare' },
      { pokemonId: 'dratini', weight: 10, minLevel: 7, maxLevel: 9, encounterMethod: 'grass', rarity: 'very-rare' },
    ],
  },
  // Szepczący Zagajnik (druga lokacja): leśne stworzenia w paprociach — inna tabela niż na Polanie.
  zagajnik: {
    id: 'zagajnik',
    entries: [
      { pokemonId: 'caterpie', weight: 12, minLevel: 3, maxLevel: 5, encounterMethod: 'grass', rarity: 'common' },
      { pokemonId: 'weedle', weight: 12, minLevel: 3, maxLevel: 5, encounterMethod: 'grass', rarity: 'common' },
      { pokemonId: 'oddish', weight: 10, minLevel: 4, maxLevel: 6, encounterMethod: 'grass', rarity: 'common' },
      { pokemonId: 'hoothoot', weight: 8, minLevel: 4, maxLevel: 6, encounterMethod: 'grass', rarity: 'uncommon' },
      { pokemonId: 'seedot', weight: 6, minLevel: 4, maxLevel: 6, encounterMethod: 'grass', rarity: 'uncommon' },
      { pokemonId: 'skwovet', weight: 6, minLevel: 3, maxLevel: 5, encounterMethod: 'grass', rarity: 'uncommon' },
      { pokemonId: 'fomantis', weight: 3, minLevel: 5, maxLevel: 7, encounterMethod: 'grass', rarity: 'rare' },
    ],
  },
  // Wzgórza Wiatru (Sprint 6, za zamkniętym przejściem): stworzenia wietrznych zboczy, wyższe poziomy.
  wzgorza: {
    id: 'wzgorza',
    entries: [
      { pokemonId: 'spearow', weight: 14, minLevel: 9, maxLevel: 12, encounterMethod: 'grass', rarity: 'common' },
      { pokemonId: 'hoppip', weight: 12, minLevel: 9, maxLevel: 12, encounterMethod: 'grass', rarity: 'common' },
      { pokemonId: 'mareep', weight: 8, minLevel: 10, maxLevel: 12, encounterMethod: 'grass', rarity: 'uncommon' },
      { pokemonId: 'swablu', weight: 6, minLevel: 10, maxLevel: 13, encounterMethod: 'grass', rarity: 'uncommon' },
      { pokemonId: 'rookidee', weight: 3, minLevel: 11, maxLevel: 13, encounterMethod: 'grass', rarity: 'rare' },
    ],
  },
  // Jedyne widoczne stworzenie na mapie: nieruchomy „Strażnik Cichego Gaju” (spotkanie specjalne).
  'grove-guardian': {
    id: 'grove-guardian',
    mightyChance: 1,
    entries: [{ pokemonId: 'growlithe', weight: 1, minLevel: 8, maxLevel: 8, encounterMethod: 'static', rarity: 'rare' }],
  },
};

/** Startery każdej generacji (trawiasty, ognisty, wodny). Dane i grafiki pobierane z PokéAPI po nazwie. */
export interface StarterGeneration {
  gen: number;
  roman: string;
  region: string;
  starters: [string, string, string];
}

export const STARTER_GENERATIONS: StarterGeneration[] = [
  { gen: 1, roman: 'I', region: 'Kanto', starters: ['bulbasaur', 'charmander', 'squirtle'] },
  { gen: 2, roman: 'II', region: 'Johto', starters: ['chikorita', 'cyndaquil', 'totodile'] },
  { gen: 3, roman: 'III', region: 'Hoenn', starters: ['treecko', 'torchic', 'mudkip'] },
  { gen: 4, roman: 'IV', region: 'Sinnoh', starters: ['turtwig', 'chimchar', 'piplup'] },
  { gen: 5, roman: 'V', region: 'Unova', starters: ['snivy', 'tepig', 'oshawott'] },
  { gen: 6, roman: 'VI', region: 'Kalos', starters: ['chespin', 'fennekin', 'froakie'] },
  { gen: 7, roman: 'VII', region: 'Alola', starters: ['rowlet', 'litten', 'popplio'] },
  { gen: 8, roman: 'VIII', region: 'Galar', starters: ['grookey', 'scorbunny', 'sobble'] },
  { gen: 9, roman: 'IX', region: 'Paldea', starters: ['sprigatito', 'fuecoco', 'quaxly'] },
];

export const STARTER_LEVEL = 5;
