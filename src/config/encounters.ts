// Lokalne tabele spotkań dla oryginalnych map. Gatunki i formy (np. regionalne) pobieramy z PokéAPI po nazwie.
// Celowo mieszamy generacje, żeby od początku testować dane z różnych gier.

export interface EncounterEntry {
  pokemon: string;
  min: number;
  max: number;
  weight: number;
}

export interface EncounterTable {
  id: string;
  /** Szansa, że stworzenie samo ruszy w stronę gracza. */
  aggressiveChance: number;
  /** Nadpisanie szansy na „Potężny okaz”. */
  mightyChance?: number;
  entries: EncounterEntry[];
}

export const ENCOUNTER_TABLES: Record<string, EncounterTable> = {
  meadow: {
    id: 'meadow',
    aggressiveChance: 0.25,
    entries: [
      { pokemon: 'pidgey', min: 2, max: 4, weight: 16 },
      { pokemon: 'sentret', min: 2, max: 4, weight: 14 },
      { pokemon: 'zigzagoon', min: 3, max: 5, weight: 12 },
      { pokemon: 'starly', min: 3, max: 5, weight: 12 },
      { pokemon: 'patrat', min: 2, max: 4, weight: 10 },
      { pokemon: 'bunnelby', min: 3, max: 5, weight: 8 },
      { pokemon: 'pikipek', min: 3, max: 5, weight: 8 },
      { pokemon: 'skwovet', min: 3, max: 5, weight: 8 },
      { pokemon: 'lechonk', min: 3, max: 5, weight: 6 },
      { pokemon: 'rattata-alola', min: 3, max: 5, weight: 6 },
    ],
  },
  pond: {
    id: 'pond',
    aggressiveChance: 0.15,
    entries: [
      { pokemon: 'psyduck', min: 4, max: 6, weight: 14 },
      { pokemon: 'marill', min: 4, max: 6, weight: 14 },
      { pokemon: 'lotad', min: 3, max: 5, weight: 14 },
      { pokemon: 'wooper', min: 4, max: 6, weight: 12 },
      { pokemon: 'wooper-paldea', min: 4, max: 6, weight: 6 },
      { pokemon: 'buizel', min: 4, max: 6, weight: 10 },
      { pokemon: 'tympole', min: 4, max: 6, weight: 10 },
      { pokemon: 'wingull', min: 4, max: 6, weight: 10 },
    ],
  },
  rocks: {
    id: 'rocks',
    aggressiveChance: 0.35,
    entries: [
      { pokemon: 'geodude', min: 5, max: 7, weight: 16 },
      { pokemon: 'geodude-alola', min: 5, max: 7, weight: 6 },
      { pokemon: 'aron', min: 5, max: 7, weight: 12 },
      { pokemon: 'roggenrola', min: 5, max: 7, weight: 12 },
      { pokemon: 'zubat', min: 4, max: 6, weight: 12 },
      { pokemon: 'rolycoly', min: 5, max: 7, weight: 10 },
      { pokemon: 'nacli', min: 5, max: 7, weight: 10 },
    ],
  },
  grove: {
    id: 'grove',
    aggressiveChance: 0.5,
    mightyChance: 0.2,
    entries: [
      { pokemon: 'eevee', min: 6, max: 8, weight: 18 },
      { pokemon: 'ralts', min: 6, max: 8, weight: 16 },
      { pokemon: 'riolu', min: 7, max: 9, weight: 14 },
      { pokemon: 'vulpix-alola', min: 6, max: 8, weight: 14 },
      { pokemon: 'larvitar', min: 7, max: 9, weight: 10 },
      { pokemon: 'dratini', min: 7, max: 9, weight: 10 },
    ],
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
