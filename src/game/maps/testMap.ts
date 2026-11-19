// Oryginalna mapa testowa „Polana Startowa” (40×32 kafelki).
// Legenda: T drzewo · . trawa · , wysoka trawa · = ścieżka · ~ woda · s piasek · r skalisty grunt · R głaz
//          f kwiaty · F płot · S tabliczka · C/c Stacja Opieki · M/m Kram · w ściana · D/E drzwi

import { ENCOUNTER_CONFIG, staticDoneFlag, type EncounterConditions, type TerrainType } from '../../config/encounters';
import type { Dir } from '../../engine/types';

/**
 * Strefa spotkań: prostokąt na mapie + teren, w którym losowane są spotkania. Losowanie dotyczy wyłącznie kafelków
 * o terenie równym terrainType (np. wysoka trawa w obrębie Łąki); pozostałe pola strefy są bezpieczne.
 */
export interface ZoneDef {
  id: string;
  name: string;
  rect: { x: number; y: number; w: number; h: number };
  locationId: string;
  terrainType: TerrainType;
  encounterTableId: string;
  /** Szansa na spotkanie na jeden poprawny krok (0–1). */
  baseEncounterRate: number;
  /** Co ile poprawnych kroków następuje losowanie (1 = po każdym). */
  stepDistance: number;
  conditions?: EncounterConditions;
}

/** Spotkanie specjalne: jedyny rodzaj stworzenia widocznego na mapie — stoi w miejscu, nie wędruje i nie goni. */
export interface StaticEncounterDef {
  id: string;
  name: string;
  x: number;
  y: number;
  locationId: string;
  /** Strefa, do której należy (nazwa w Atlasie/„spotkano w”, flagi strefy). */
  zoneId: string;
  terrainType: 'SPECIAL';
  encounterTableId: string;
  conditions?: EncounterConditions;
}

export interface MapDef {
  id: string;
  name: string;
  layout: string[];
  spawn: { x: number; y: number; facing: Dir };
  healReturn: { x: number; y: number; facing: Dir };
  zones: ZoneDef[];
  staticEncounters: StaticEncounterDef[];
  signs: Record<string, string[]>;
  doors: Record<string, 'care' | 'shop'>;
}

export const TEST_MAP: MapDef = {
  id: 'polana',
  name: 'Polana Startowa',
  layout: [
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'T...............T.,,,,,,,,,,,,,,,,,,,,.T',
    'T.fCCcCC..MmMM.fT.,,,,,,,,,..,,,,,,T,,.T',
    'T.fCCCCC..MMMMf.T.,,,,TT,,,,,,,,,,,T,,.T',
    'T..wwDww..wEww..T.,,,,T,,,,,,,,,,,,,,,.T',
    'T..===========.fT.,,,,,,,,,,,,TT,,,,,,.T',
    'T.f.....=S..ff...S,,,,,,,.,,,,T,,,,,,,.T',
    'T..ff...==========,,..,,,,,,,,,,,,,,,,.T',
    'T.......=.........,,,,,,,,,,,,,,,..,,,.T',
    'T.FFFFFF=FFFFFFFT.,,,,,,,,T,,,,,,,,,,,.T',
    'T.......=.......T.,,,,,,,,,,,,,,,,,,,,.T',
    'T.......=.......T.,,,,,,,,,,,,,,,,,,,,.T',
    'T.......=.......T......................T',
    'T.......=..............................T',
    'T.......=..............................T',
    'T.......========================.......T',
    'T..............S..............S=.......T',
    'T.,,..............f...f.rrrrRrrrrrrrrr.T',
    'T...sssssssss.,.........rRrrrrrrrrRrrr.T',
    'T..sss~~~~~sss.,...TT...rrrrrrrrrrrrrr.T',
    'T.ss~~~~~~~~~ss,...T....rrrrrrrrrrrrRr.T',
    'T.ss~~~~~~~~~ss........frrrrrRrrrrrrrr.T',
    'T.s~~~~~~~~~~~s.....f...rrRrrrrrSrrrrr.T',
    'T.ss~~~~~~~~~ss..f......rrrrrrrTTT.TTTTT',
    'T.ss~~~~~~~~~ss......T..rrrrrrrT,,,,,,TT',
    'T..sss~~~~~sss.......T..rrrrrrrT,,,,,,TT',
    'T...sssssssss.,,........rRrrrrrT,,,T,,TT',
    'T.,,..............TT....rrrrrrrT,,,,,,TT',
    'T...,........,,.......f.rrrrRrrT,f,,,,TT',
    'T.......................RrrrrrrT,,,,,,TT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
  ],
  spawn: { x: 8, y: 7, facing: 'down' },
  healReturn: { x: 5, y: 6, facing: 'down' },
  // Bezpieczna strefa bez spotkań: osada (Stacja Opieki, Kram), ścieżki, piasek i zwykła trawa.
  // Spotkania: wysoka trawa (,) na Łące, przy Stawie i w Cichym Gaju oraz skalisty grunt (r) Skalnego Zakątka.
  zones: [
    {
      id: 'meadow',
      name: 'Łąka',
      rect: { x: 18, y: 2, w: 20, h: 11 },
      locationId: 'polana:laka',
      terrainType: 'TALL_GRASS',
      encounterTableId: 'meadow',
      baseEncounterRate: ENCOUNTER_CONFIG.baseRates.TALL_GRASS,
      stepDistance: ENCOUNTER_CONFIG.defaultStepDistance,
    },
    {
      id: 'pond',
      name: 'Brzeg Stawu',
      rect: { x: 1, y: 17, w: 16, h: 14 },
      locationId: 'polana:staw',
      terrainType: 'TALL_GRASS',
      encounterTableId: 'pond',
      baseEncounterRate: ENCOUNTER_CONFIG.baseRates.TALL_GRASS,
      stepDistance: ENCOUNTER_CONFIG.defaultStepDistance,
    },
    {
      id: 'rocks',
      name: 'Skalny Zakątek',
      rect: { x: 24, y: 18, w: 14, h: 6 },
      locationId: 'polana:skaly',
      terrainType: 'CAVE',
      encounterTableId: 'rocks',
      baseEncounterRate: ENCOUNTER_CONFIG.baseRates.CAVE,
      stepDistance: ENCOUNTER_CONFIG.defaultStepDistance,
    },
    {
      id: 'grove',
      name: 'Cichy Gaj',
      rect: { x: 32, y: 25, w: 6, h: 6 },
      locationId: 'polana:gaj',
      terrainType: 'TALL_GRASS',
      encounterTableId: 'grove',
      baseEncounterRate: ENCOUNTER_CONFIG.baseRates.TALL_GRASS,
      stepDistance: ENCOUNTER_CONFIG.defaultStepDistance,
    },
  ],
  staticEncounters: [
    {
      id: 'gaj-straznik',
      name: 'Strażnik Cichego Gaju',
      x: 36,
      y: 28,
      locationId: 'polana:gaj',
      zoneId: 'grove',
      terrainType: 'SPECIAL',
      encounterTableId: 'grove-guardian',
      conditions: { flagsNone: [staticDoneFlag('gaj-straznik')] },
    },
  ],
  signs: {
    '9,7': [
      'Polana Startowa.',
      'Na północy: Stacja Opieki (leczenie) i Kram (zakupy). Na wschodzie Łąka, na południu Staw i Skalny Zakątek.',
    ],
    '17,7': ['Łąka.', 'Stworzenia kryją się w wysokiej trawie. Wejdź w nią, a któreś może wyskoczyć!'],
    '15,17': ['Staw.', 'W trawie przy brzegu spotkasz stworzenia, które lubią wodę.'],
    '30,17': ['Skalny Zakątek.', 'Twarde skały, twarde stworzenia. Przygotuj drużynę.'],
    '32,23': ['Cichy Gaj.', 'Rzadkie i silniejsze stworzenia. W głębi czuwa Strażnik Gaju.'],
  },
  doors: {
    '5,5': 'care',
    '11,5': 'shop',
  },
};

export const MAPS: Record<string, MapDef> = { [TEST_MAP.id]: TEST_MAP };
