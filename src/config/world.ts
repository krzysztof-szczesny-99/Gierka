// Model świata — wyłącznie dane: regiony, lokacje, punkty pojawienia się, połączenia i wymagania.
// Logika (wyszukiwanie, wymagania, bezpieczne wejście, walidacja) jest w src/game/world.ts.
// Region i lokacje są oryginalne (nie odwzorowują oficjalnych map ani fabuły).

import type { EncounterMethod } from './encounters';
import type { Dir } from '../engine/types';

/** Stan realizacji: tylko IMPLEMENTED ma grywalną mapę; pozostałe to dane na przyszłość. */
export type LocationStatus = 'IMPLEMENTED' | 'DATA_ONLY' | 'PLANNED' | 'BLOCKED_BY_MISSING_ASSET';

export type LocationType = 'TOWN' | 'CITY' | 'ROUTE' | 'FOREST' | 'CAVE' | 'WATER' | 'BUILDING' | 'CHALLENGE' | 'SPECIAL';

export const LOCATION_STATUSES: readonly LocationStatus[] = ['IMPLEMENTED', 'DATA_ONLY', 'PLANNED', 'BLOCKED_BY_MISSING_ASSET'];
export const LOCATION_TYPES: readonly LocationType[] = ['TOWN', 'CITY', 'ROUTE', 'FOREST', 'CAVE', 'WATER', 'BUILDING', 'CHALLENGE', 'SPECIAL'];

/**
 * Wymagania (połączenia, lokacji, regionu). Sprawdzane na zapisie gry:
 * odznaki — flagi `badge:<id>`, przedmioty — torba, wydarzenia — flagi o podanej nazwie.
 */
export interface Requirements {
  badges?: string[];
  items?: string[];
  events?: string[];
}

export interface SpawnPoint {
  id: string;
  x: number;
  y: number;
  facing: Dir;
}

/** Pole (lub prostokąt pól) na mapie źródłowej, którego wejście uruchamia przejście. */
export interface ConnectionTrigger {
  kind: 'tile';
  x: number;
  y: number;
  w?: number;
  h?: number;
}

export interface LocationConnection {
  id: string;
  sourceLocationId: string;
  destinationLocationId: string;
  sourceTrigger: ConnectionTrigger;
  destinationSpawnPoint: string;
  requirements?: Requirements;
  /** Komunikat, gdy przejście jest zablokowane (wymagania lub lokacja jeszcze niegotowa). */
  blockedMessage: string[];
}

export interface HealingPoint {
  locationId: string;
  spawnPointId: string;
}

export interface LocationDef {
  id: string;
  name: string;
  regionId: string;
  type: LocationType;
  status: LocationStatus;
  /** Identyfikator mapy w rejestrze MAPS (null — lokacja bez mapy, np. PLANNED). */
  mapReference: string | null;
  connections: LocationConnection[];
  spawnPoints: SpawnPoint[];
  encounterTableIds: string[];
  availableEncounterMethods: EncounterMethod[];
  requiredBadges: string[];
  requiredItems: string[];
  requiredEvents: string[];
  /** Lokacja ukryta (nie pokazywać w przyszłych listach i na mapie świata, dopóki nie zostanie odkryta). */
  hidden: boolean;
  /** Dokąd wraca gracz po przegranej (Stacja Opieki). */
  healingPoint: HealingPoint | null;
}

export interface RegionDef {
  id: string;
  name: string;
  /** Generacja, którą region się inspiruje; „mixed” — region oryginalny ze stworzeniami z wielu generacji. */
  generationReference: number | 'mixed';
  startLocationId: string;
  locationIds: string[];
  unlockRequirements: Requirements;
  status: LocationStatus;
}

export interface WorldDef {
  startRegionId: string;
  regions: RegionDef[];
  locations: LocationDef[];
}

/** Domyślny punkt pojawienia się każdej grywalnej lokacji (start gry, awaryjny powrót). */
export const DEFAULT_SPAWN_POINT_ID = 'start';

export const POLANA_ID = 'polana-startowa';
export const ZAGAJNIK_ID = 'szepczacy-zagajnik';
export const WZGORZA_ID = 'wzgorza-wiatru';
export const REGION_ID = 'kraina-szlakow';

const HEAL_AT_POLANA: HealingPoint = { locationId: POLANA_ID, spawnPointId: 'stacja-opieki' };

export const WORLD: WorldDef = {
  startRegionId: REGION_ID,
  regions: [
    {
      id: REGION_ID,
      name: 'Kraina Szlaków',
      generationReference: 'mixed',
      startLocationId: POLANA_ID,
      locationIds: [POLANA_ID, ZAGAJNIK_ID, WZGORZA_ID],
      unlockRequirements: {},
      status: 'IMPLEMENTED',
    },
  ],
  locations: [
    {
      id: POLANA_ID,
      name: 'Polana Startowa',
      regionId: REGION_ID,
      type: 'TOWN',
      status: 'IMPLEMENTED',
      mapReference: 'polana',
      spawnPoints: [
        { id: DEFAULT_SPAWN_POINT_ID, x: 8, y: 7, facing: 'down' },
        { id: 'stacja-opieki', x: 5, y: 6, facing: 'down' },
        { id: 'z-zagajnika', x: 38, y: 14, facing: 'left' },
      ],
      connections: [
        {
          id: 'polana-do-zagajnika',
          sourceLocationId: POLANA_ID,
          destinationLocationId: ZAGAJNIK_ID,
          sourceTrigger: { kind: 'tile', x: 39, y: 14 },
          destinationSpawnPoint: 'z-polany',
          blockedMessage: ['Ścieżka do Szepczącego Zagajnika jest na razie zamknięta.'],
        },
      ],
      encounterTableIds: ['meadow', 'pond', 'rocks', 'grove', 'grove-guardian'],
      availableEncounterMethods: ['grass', 'cave', 'static'],
      requiredBadges: [],
      requiredItems: [],
      requiredEvents: [],
      hidden: false,
      healingPoint: HEAL_AT_POLANA,
    },
    {
      id: ZAGAJNIK_ID,
      name: 'Szepczący Zagajnik',
      regionId: REGION_ID,
      type: 'FOREST',
      status: 'IMPLEMENTED',
      mapReference: 'zagajnik',
      spawnPoints: [
        { id: DEFAULT_SPAWN_POINT_ID, x: 3, y: 9, facing: 'right' },
        { id: 'z-polany', x: 2, y: 9, facing: 'right' },
      ],
      connections: [
        {
          id: 'zagajnik-do-polany',
          sourceLocationId: ZAGAJNIK_ID,
          destinationLocationId: POLANA_ID,
          sourceTrigger: { kind: 'tile', x: 0, y: 9 },
          destinationSpawnPoint: 'z-zagajnika',
          blockedMessage: ['Ścieżka na Polanę jest na razie zamknięta.'],
        },
        {
          id: 'zagajnik-do-wzgorz',
          sourceLocationId: ZAGAJNIK_ID,
          destinationLocationId: WZGORZA_ID,
          sourceTrigger: { kind: 'tile', x: 13, y: 0 },
          destinationSpawnPoint: 'z-zagajnika',
          requirements: { events: ['droga-na-wzgorza'] },
          blockedMessage: ['Ścieżkę na Wzgórza Wiatru zagradza zwalone drzewo.', 'Ta okolica jest jeszcze w przygotowaniu.'],
        },
      ],
      encounterTableIds: ['zagajnik'],
      availableEncounterMethods: ['grass'],
      requiredBadges: [],
      requiredItems: [],
      requiredEvents: [],
      hidden: false,
      healingPoint: HEAL_AT_POLANA,
    },
    {
      // Tylko dane — mapa powstanie w kolejnych sprintach.
      id: WZGORZA_ID,
      name: 'Wzgórza Wiatru',
      regionId: REGION_ID,
      type: 'ROUTE',
      status: 'PLANNED',
      mapReference: null,
      spawnPoints: [{ id: 'z-zagajnika', x: 0, y: 0, facing: 'up' }],
      connections: [],
      encounterTableIds: [],
      availableEncounterMethods: [],
      requiredBadges: [],
      requiredItems: [],
      requiredEvents: ['droga-na-wzgorza'],
      hidden: true,
      healingPoint: HEAL_AT_POLANA,
    },
  ],
};
