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

/** Startery: ukłon w stronę inspiracji (HGSS, Emerald, Platinum). */
export const STARTERS = ['chikorita', 'torchic', 'piplup'];
export const STARTER_LEVEL = 5;
