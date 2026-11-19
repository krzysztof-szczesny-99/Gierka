// Czyste reguły losowych spotkań (bez Phasera i bez sieci): teren pod graczem, strefa spotkań, warunki,
// decyzja o losowaniu po kroku, ważony wybór stworzenia i zakres poziomów. Testowane jednostkowo.

import {
  ENCOUNTER_TABLES,
  TERRAIN_METHOD,
  type EncounterConditions,
  type EncounterEntry,
  type EncounterMethod,
  type EncounterTable,
  type TerrainType,
} from '../config/encounters';
import type { Rng } from '../engine/rng';
import type { MapDef, StaticEncounterDef, ZoneDef } from './maps/testMap';
import { charAt, inBounds } from './movement';
import { tileDef } from './tiles';

/** Teren kafelka (poza mapą i na zwykłych polach: NONE). */
export function terrainAt(grid: string[][], x: number, y: number): TerrainType {
  if (!inBounds(grid, x, y)) return 'NONE';
  return tileDef(charAt(grid, x, y)).terrain ?? 'NONE';
}

export function conditionsMet(c: EncounterConditions | undefined, flags: Readonly<Record<string, boolean>>): boolean {
  if (!c) return true;
  if (c.flagsAll?.some((f) => !flags[f])) return false;
  if (c.flagsNone?.some((f) => flags[f])) return false;
  return true;
}

function inRect(zone: { rect: ZoneDef['rect'] }, x: number, y: number): boolean {
  const r = zone.rect;
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

/** Strefa spotkań pod graczem: prostokąt strefy + zgodny teren kafelka + spełnione warunki. Inaczej null. */
export function encounterZoneAt(
  map: Pick<MapDef, 'zones'>,
  grid: string[][],
  x: number,
  y: number,
  flags: Readonly<Record<string, boolean>>,
): ZoneDef | null {
  const terrain = terrainAt(grid, x, y);
  if (terrain === 'NONE' || terrain === 'SPECIAL') return null;
  return map.zones.find((z) => z.terrainType === terrain && inRect(z, x, y) && conditionsMet(z.conditions, flags)) ?? null;
}

/** Spotkania specjalne, które powinny być widoczne na mapie (warunki spełnione, np. jeszcze nie pokonane). */
export function activeStaticEncounters(map: Pick<MapDef, 'staticEncounters'>, flags: Readonly<Record<string, boolean>>): StaticEncounterDef[] {
  return map.staticEncounters.filter((s) => conditionsMet(s.conditions, flags));
}

// ───────────────────────────── losowanie po kroku ─────────────────────────────

export interface StepEncounterState {
  gameMode: string;
  activeEncounterId: string | null;
  /** Pozostałe kroki odnowienia (0 = można losować). */
  cooldown: number;
  /** Kroki zebrane w terenie od ostatniego losowania (dla stepDistance > 1). */
  progress: number;
}

export type StepDecisionReason = 'not-moved' | 'blocked' | 'cooldown' | 'no-terrain' | 'distance' | 'miss' | 'hit';

export interface StepDecision {
  reason: StepDecisionReason;
  /** Czy wykonano rzut (najwyżej jeden na krok). */
  rolled: boolean;
  hit: boolean;
  roll: number | null;
  cooldown: number;
  progress: number;
}

/**
 * Decyzja po kroku gracza. Rzut (dokładnie jedno rng.next()) następuje wyłącznie, gdy:
 * gracz wszedł na nowe pole, stan to EXPLORATION, brak aktywnego spotkania, odnowienie wynosi 0,
 * teren obsługuje spotkania i zebrano wymagany dystans. Krok w czasie odnowienia zmniejsza odnowienie o 1.
 */
export function evaluateEncounterStep(
  state: StepEncounterState,
  input: { movedToNewTile: boolean; zone: Pick<ZoneDef, 'baseEncounterRate' | 'stepDistance'> | null },
  rng: Rng,
): StepDecision {
  const keep = { cooldown: state.cooldown, progress: state.progress };
  if (!input.movedToNewTile) return { reason: 'not-moved', rolled: false, hit: false, roll: null, ...keep };
  if (state.gameMode !== 'EXPLORATION' || state.activeEncounterId !== null) {
    return { reason: 'blocked', rolled: false, hit: false, roll: null, ...keep };
  }
  if (state.cooldown > 0) {
    return { reason: 'cooldown', rolled: false, hit: false, roll: null, cooldown: state.cooldown - 1, progress: 0 };
  }
  const zone = input.zone;
  if (!zone || !(zone.baseEncounterRate > 0)) {
    return { reason: 'no-terrain', rolled: false, hit: false, roll: null, cooldown: 0, progress: 0 };
  }
  const progress = state.progress + 1;
  if (progress < Math.max(1, zone.stepDistance)) {
    return { reason: 'distance', rolled: false, hit: false, roll: null, cooldown: 0, progress };
  }
  const roll = rng.next();
  const hit = roll < zone.baseEncounterRate;
  return { reason: hit ? 'hit' : 'miss', rolled: true, hit, roll, cooldown: 0, progress: 0 };
}

// ───────────────────────────── tabele ─────────────────────────────

export function encounterTable(id: string): EncounterTable {
  const t = ENCOUNTER_TABLES[id];
  if (!t) throw new Error(`Brak tabeli spotkań „${id}”.`);
  return t;
}

/** Wpisy tabeli dla danej metody spotkania, ze spełnionymi warunkami i dodatnią wagą. */
export function eligibleEntries(table: EncounterTable, method: EncounterMethod, flags: Readonly<Record<string, boolean>>): EncounterEntry[] {
  return table.entries.filter((e) => e.encounterMethod === method && e.weight > 0 && conditionsMet(e.conditions, flags));
}

export function methodForTerrain(terrain: TerrainType): EncounterMethod | null {
  return TERRAIN_METHOD[terrain];
}

/** Ważony wybór wpisu — działa dla dowolnej dodatniej sumy wag (nie musi wynosić 100). */
export function pickEncounterEntry(entries: readonly EncounterEntry[], rng: Rng): EncounterEntry {
  if (!entries.length) throw new Error('Brak stworzeń do wylosowania w tym miejscu.');
  return rng.weighted(entries);
}

/** Poziom z zakresu wpisu (włącznie z oboma końcami). */
export function rollLevel(entry: Pick<EncounterEntry, 'minLevel' | 'maxLevel'>, rng: Rng): number {
  const lo = Math.min(entry.minLevel, entry.maxLevel);
  const hi = Math.max(entry.minLevel, entry.maxLevel);
  return rng.int(lo, hi);
}

/** Stworzenia legendarne i mityczne nie mogą pochodzić ze zwykłych losowych spotkań. */
export function assertAllowedSpecies(species: { isLegendary: boolean; isMythical: boolean; name: string }, method: EncounterMethod): void {
  if (method !== 'static' && (species.isLegendary || species.isMythical)) {
    throw new Error(`Stworzenie „${species.name}” jest legendarne lub mityczne — nie może pojawić się w zwykłej tabeli.`);
  }
}
