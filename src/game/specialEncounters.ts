// Specjalne spotkania (Sprint 7): które stworzenia stoją na mapie, stan po wyniku walki (złapanie, pokonanie,
// ucieczka/przegrana), zapis wyniku i wydarzenia ukończenia, spójność zapisu i walidacja danych (także zakaz
// stworzeń legendarnych i mitycznych w zwykłych tabelach spotkań). Czyste funkcje — stan zmienia gameStore.

import { BADGES, CHALLENGES, LEADERS } from '../config/challenges';
import { ENCOUNTER_TABLES, type EncounterTable } from '../config/encounters';
import { HIDDEN_LOCATIONS } from '../config/hiddenLocations';
import { ITEMS } from '../config/items';
import {
  isLegendaryOrMythicalId,
  SPECIAL_ENCOUNTER_STATES,
  SPECIAL_ENCOUNTERS,
  SPECIAL_REPEAT_POLICIES,
  type SpecialEncounterDef,
  type SpecialEncounterState,
} from '../config/specialEncounters';
import { TRAINERS } from '../config/trainers';
import { WORLD, type WorldDef } from '../config/world';
import { MAPS } from './maps';
import type { MapDef } from './maps/testMap';
import { isWalkable } from './movement';
import { connectionAt, getLocation, mapOf, requirementsMet, type ProgressState } from './world';

/** Wynik walki ze stworzeniem specjalnym, zapisywany w grze (zapis v5). LOST — przegrana gracza. */
export type SpecialResult = 'CAUGHT' | 'DEFEATED' | 'ESCAPED' | 'LOST';
export const SPECIAL_RESULTS: readonly SpecialResult[] = ['CAUGHT', 'DEFEATED', 'ESCAPED', 'LOST'];

/** Wpis w zapisie: ostatni wynik, liczba walk i chwila zakończenia na stałe (null — spotkanie trwa). */
export interface SpecialEncounterRecord {
  result: SpecialResult;
  attempts: number;
  completedAt: number | null;
}

/** Wynik walki silnika → wynik spotkania specjalnego (null — przerwane bez wyniku). */
export function specialResultOf(outcome: string): SpecialResult | null {
  switch (outcome) {
    case 'caught':
      return 'CAUGHT';
    case 'win':
      return 'DEFEATED';
    case 'fled':
      return 'ESCAPED';
    case 'lose':
      return 'LOST';
    default:
      return null;
  }
}

/** Stan spotkania po wyniku: złapanie, pokonanie albo ucieczka (przegrana gracza — jak ucieczka). */
export function stateAfter(def: SpecialEncounterDef, result: SpecialResult): SpecialEncounterState {
  if (result === 'CAUGHT') return def.stateAfterCapture;
  if (result === 'DEFEATED') return def.stateAfterDefeat;
  return def.stateAfterEscape;
}

export function getSpecialEncounter(id: string | null | undefined, list: readonly SpecialEncounterDef[] = SPECIAL_ENCOUNTERS): SpecialEncounterDef | undefined {
  return id ? list.find((s) => s.id === id) : undefined;
}

export function specialEncountersIn(locationId: string, list: readonly SpecialEncounterDef[] = SPECIAL_ENCOUNTERS): SpecialEncounterDef[] {
  return list.filter((s) => s.locationId === locationId);
}

export function isSpecialCompleted(def: SpecialEncounterDef, flags: Readonly<Record<string, boolean>>): boolean {
  return !!flags[def.completionEventId];
}

export function specialRequirementsMet(def: SpecialEncounterDef, p: ProgressState): boolean {
  return requirementsMet({ badges: def.requiredBadges, items: def.requiredItems, events: def.requiredEvents }, p);
}

/**
 * Stworzenia specjalne stojące teraz na mapie lokacji: nieukończone, z wymaganiami spełnionymi i niewyłączone
 * do ponownego wejścia (`dormant` — stan HIDDEN_UNTIL_REENTRY, pamiętany tylko do zmiany mapy/ponownego uruchomienia).
 */
export function activeSpecialEncounters(
  locationId: string,
  p: ProgressState,
  dormant: ReadonlySet<string> = new Set(),
  list: readonly SpecialEncounterDef[] = SPECIAL_ENCOUNTERS,
): SpecialEncounterDef[] {
  return specialEncountersIn(locationId, list).filter((s) => !isSpecialCompleted(s, p.flags) && specialRequirementsMet(s, p) && !dormant.has(s.id));
}

/** Zmiana zapisu po walce: nowy wpis wyniku, stan na mapie i — dla stanu GONE — wydarzenie ukończenia. */
export interface SpecialOutcomeUpdate {
  record: SpecialEncounterRecord;
  state: SpecialEncounterState;
  /** Ustawić wydarzenie ukończenia (spotkanie znika na stałe). */
  completes: boolean;
}

/**
 * Wynik walki ze stworzeniem specjalnym. null — spotkanie było już ukończone (nic się nie zmienia: brak
 * podwójnego zapisu) albo walka nie ma wyniku.
 */
export function specialOutcome(
  def: SpecialEncounterDef,
  outcome: string,
  prev: SpecialEncounterRecord | undefined,
  flags: Readonly<Record<string, boolean>>,
  now: number,
): SpecialOutcomeUpdate | null {
  const result = specialResultOf(outcome);
  if (!result || isSpecialCompleted(def, flags)) return null;
  const state = stateAfter(def, result);
  const completes = state === 'GONE';
  return { record: { result, attempts: (prev?.attempts ?? 0) + 1, completedAt: completes ? now : null }, state, completes };
}

/** Spójność wpisów w zapisie (migracja i każde wczytanie): tylko poprawne wpisy, liczby nieujemne. */
export function normalizeSpecialRecords(raw: unknown): Record<string, SpecialEncounterRecord> {
  const out: Record<string, SpecialEncounterRecord> = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== 'object' || v === null) continue;
    const r = v as Record<string, unknown>;
    if (!(SPECIAL_RESULTS as readonly unknown[]).includes(r.result)) continue;
    out[id] = {
      result: r.result as SpecialResult,
      attempts: typeof r.attempts === 'number' && r.attempts >= 1 ? Math.floor(r.attempts) : 1,
      completedAt: typeof r.completedAt === 'number' ? r.completedAt : null,
    };
  }
  return out;
}

// ───────────────────────────── walidacja danych ─────────────────────────────

export interface SpecialIssue {
  code: 'DUPLICATE_ID' | 'DUPLICATE_EVENT' | 'MISSING_LOCATION' | 'INVALID_POSITION' | 'INVALID_VALUE' | 'INVALID_POLICY' | 'INVALID_REQUIREMENT' | 'LEGENDARY_IN_TABLE';
  ref: string;
  message: string;
}

/** Wydarzenia znane grze (flagi, które coś ustawia) — do sprawdzania wymagań w danych. */
export function knownEvents(): Set<string> {
  return new Set([
    ...TRAINERS.map((t) => t.defeatedEventId),
    ...CHALLENGES.map((c) => c.completionEventId),
    ...SPECIAL_ENCOUNTERS.map((s) => s.completionEventId),
    ...HIDDEN_LOCATIONS.map((h) => h.discoveryEventId),
    'grove-done',
  ]);
}

/**
 * Spójność spotkań specjalnych: pola, polityka powtórzeń zgodna ze stanami po wyniku, pozycja na mapie,
 * wymagania; do tego zakaz stworzeń legendarnych i mitycznych w zwykłych tabelach spotkań.
 */
export function validateSpecialEncounters(
  list: readonly SpecialEncounterDef[] = SPECIAL_ENCOUNTERS,
  world: WorldDef = WORLD,
  maps: Readonly<Record<string, MapDef>> = MAPS,
  tables: Readonly<Record<string, EncounterTable>> = ENCOUNTER_TABLES,
): SpecialIssue[] {
  const issues: SpecialIssue[] = [];
  const add = (code: SpecialIssue['code'], ref: string, message: string) => issues.push({ code, ref, message });
  const ids = new Set<string>();
  const events = new Set<string>();
  const spots = new Set<string>();
  const known = knownEvents();
  const otherEvents = new Set([...TRAINERS.map((t) => t.defeatedEventId), ...CHALLENGES.map((c) => c.completionEventId), ...HIDDEN_LOCATIONS.map((h) => h.discoveryEventId)]);

  for (const s of list) {
    if (ids.has(s.id)) add('DUPLICATE_ID', s.id, `Powtórzony identyfikator spotkania: ${s.id}`);
    ids.add(s.id);
    if (!s.completionEventId || events.has(s.completionEventId) || otherEvents.has(s.completionEventId)) add('DUPLICATE_EVENT', s.id, `Pusty lub powtórzony completionEventId: ${s.completionEventId}`);
    events.add(s.completionEventId);
    if (!s.name.trim()) add('INVALID_VALUE', s.id, 'Pusta nazwa spotkania');
    if (!/^[a-z0-9-]+$/.test(s.pokemonId)) add('INVALID_VALUE', s.id, `Nieprawidłowy pokemonId: ${s.pokemonId}`);
    if (!Number.isInteger(s.level) || s.level < 1 || s.level > 100) add('INVALID_VALUE', s.id, `Poziom poza 1–100: ${s.level}`);

    // Polityka powtórzeń i stany po wyniku muszą do siebie pasować.
    const states = [s.stateAfterCapture, s.stateAfterDefeat, s.stateAfterEscape];
    if (states.some((st) => !SPECIAL_ENCOUNTER_STATES.includes(st))) add('INVALID_POLICY', s.id, `Nieznany stan po wyniku: ${states.join(', ')}`);
    if (!SPECIAL_REPEAT_POLICIES.includes(s.repeatPolicy)) add('INVALID_POLICY', s.id, `Nieznana polityka powtórzeń: ${String(s.repeatPolicy)}`);
    if (s.stateAfterCapture === 'REMAINS') add('INVALID_POLICY', s.id, 'Złapane stworzenie nie może zostać na mapie');
    if (s.oneTime && (s.stateAfterCapture !== 'GONE' || s.stateAfterDefeat !== 'GONE')) add('INVALID_POLICY', s.id, 'Spotkanie jednorazowe musi znikać na stałe po złapaniu i pokonaniu');
    if (!s.oneTime && states.includes('GONE')) add('INVALID_POLICY', s.id, 'Spotkanie wielokrotne nie może znikać na stałe');
    if (s.repeatPolicy === 'ONE_ATTEMPT' && (!s.oneTime || s.stateAfterEscape !== 'GONE')) add('INVALID_POLICY', s.id, 'ONE_ATTEMPT: jednorazowe i znika na stałe także po ucieczce');
    if (s.repeatPolicy === 'UNTIL_RESOLVED' && (!s.oneTime || s.stateAfterEscape === 'GONE')) add('INVALID_POLICY', s.id, 'UNTIL_RESOLVED: jednorazowe, a ucieczka nie kończy spotkania');
    if (s.repeatPolicy === 'REPEATABLE' && s.oneTime) add('INVALID_POLICY', s.id, 'REPEATABLE wymaga oneTime: false');

    for (const b of s.requiredBadges) if (!BADGES.some((x) => x.id === b)) add('INVALID_REQUIREMENT', s.id, `Nieznana odznaka: ${b}`);
    for (const i of s.requiredItems) if (!(i in ITEMS)) add('INVALID_REQUIREMENT', s.id, `Nieznany przedmiot: ${i}`);
    for (const e of s.requiredEvents) {
      if (!known.has(e)) add('INVALID_REQUIREMENT', s.id, `Nieznane wydarzenie: ${e}`);
      if (e === s.completionEventId) add('INVALID_REQUIREMENT', s.id, 'Spotkanie nie może wymagać własnego ukończenia');
    }

    const loc = getLocation(s.locationId, world);
    const map = loc && loc.status === 'IMPLEMENTED' ? mapOf(loc, maps) : null;
    if (!loc || !map) {
      add('MISSING_LOCATION', s.id, `Nieznana lub niegrywalna lokacja: ${s.locationId}`);
      continue;
    }
    if (!loc.availableEncounterMethods.includes('static')) add('INVALID_VALUE', s.id, `Lokacja ${loc.id} nie dopuszcza spotkań specjalnych (metoda „static”)`);
    const grid = map.layout.map((r) => r.split(''));
    const { x, y } = s.position;
    const key = `${s.locationId}:${x},${y}`;
    if (!isWalkable(grid, x, y)) add('INVALID_POSITION', s.id, `Stworzenie stoi na przeszkodzie (${x},${y})`);
    if (connectionAt(loc, x, y)) add('INVALID_POSITION', s.id, `Stworzenie stoi na wyjściu z mapy (${x},${y})`);
    if (loc.spawnPoints.some((p) => p.x === x && p.y === y)) add('INVALID_POSITION', s.id, `Stworzenie stoi na punkcie pojawienia się (${x},${y})`);
    const occupiedByTrainer =
      TRAINERS.some((t) => t.locationId === s.locationId && t.position.x === x && t.position.y === y) ||
      LEADERS.some((l) => l.locationId === s.locationId && l.position.x === x && l.position.y === y);
    if (occupiedByTrainer || spots.has(key)) add('INVALID_POSITION', s.id, `Pole (${x},${y}) jest zajęte`);
    spots.add(key);
    if (s.zoneId && !map.zones.some((z) => z.id === s.zoneId)) add('INVALID_VALUE', s.id, `Nieznana strefa: ${s.zoneId}`);
  }

  // Zwykłe tabele (trawa, skały, woda): bez stworzeń legendarnych i mitycznych oraz bez wpisów „static”.
  for (const t of Object.values(tables)) {
    for (const e of t.entries) {
      if (isLegendaryOrMythicalId(e.pokemonId)) add('LEGENDARY_IN_TABLE', t.id, `Stworzenie legendarne/mityczne „${e.pokemonId}” w zwykłej tabeli`);
      if (e.encounterMethod === 'static') add('INVALID_VALUE', t.id, `Wpis „static” w tabeli — spotkania specjalne mają własny model (${e.pokemonId})`);
    }
  }
  return issues;
}
