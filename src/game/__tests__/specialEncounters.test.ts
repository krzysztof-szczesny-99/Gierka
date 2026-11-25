// Specjalne spotkania (Sprint 7): model, stany po złapaniu/pokonaniu/ucieczce, polityka powtórzeń, zapis wyniku
// i wydarzenia ukończenia, wymagania pojawienia się, spójność zapisu, walidacja (także zakaz legendarnych
// i mitycznych w zwykłych tabelach spotkań).

import { describe, expect, it } from 'vitest';
import { ENCOUNTER_TABLES } from '../../config/encounters';
import { isLegendaryOrMythicalId, SPECIAL_ENCOUNTERS, type SpecialEncounterDef } from '../../config/specialEncounters';
import { GROTA_ID, POLANA_ID } from '../../config/world';
import {
  activeSpecialEncounters,
  getSpecialEncounter,
  normalizeSpecialRecords,
  specialOutcome,
  specialResultOf,
  stateAfter,
  validateSpecialEncounters,
} from '../specialEncounters';

const ABSOL = getSpecialEncounter('grota-absol')!;
const GUARD = getSpecialEncounter('gaj-straznik')!;
const prog = (flags: Record<string, boolean> = {}, extra: Record<string, unknown> = {}) => ({ flags, bag: {}, earnedBadges: [] as string[], ...extra });
const codes = (list: readonly SpecialEncounterDef[], tables = ENCOUNTER_TABLES) => validateSpecialEncounters(list, undefined, undefined, tables).map((i) => i.code);

describe('spotkanie specjalne: dane', () => {
  it('dane przechodzą walidację; zwykłe tabele bez legendarnych/mitycznych i bez wpisów „static”', () => {
    expect(validateSpecialEncounters()).toEqual([]);
  });

  it('model ma wszystkie pola; Absol w Grocie Echa i Strażnik Cichego Gaju (przeniesiony ze Sprintu 2)', () => {
    for (const key of ['id', 'pokemonId', 'level', 'locationId', 'position', 'requiredBadges', 'requiredItems', 'requiredEvents', 'oneTime', 'repeatPolicy', 'completionEventId', 'stateAfterCapture', 'stateAfterDefeat', 'stateAfterEscape']) {
      expect(key in ABSOL).toBe(true);
    }
    expect(SPECIAL_ENCOUNTERS.map((s) => s.id)).toEqual(['gaj-straznik', 'grota-absol']);
    expect(ABSOL).toMatchObject({ pokemonId: 'absol', level: 16, locationId: GROTA_ID, position: { x: 7, y: 2 }, oneTime: true, repeatPolicy: 'UNTIL_RESOLVED', stateAfterCapture: 'GONE', stateAfterDefeat: 'GONE', stateAfterEscape: 'HIDDEN_UNTIL_REENTRY' });
    expect(GUARD).toMatchObject({ locationId: POLANA_ID, stateAfterEscape: 'REMAINS', completionEventId: 'static-done:gaj-straznik' });
    expect(isLegendaryOrMythicalId(ABSOL.pokemonId)).toBe(false); // rzadkie, ale zwykłe stworzenie
  });

  it('lista legendarnych i mitycznych rozpoznaje formy z PokéAPI i nie myli zwykłych stworzeń', () => {
    for (const n of ['mewtwo', 'mew', 'giratina-altered', 'tapu-koko', 'kyogre-primal', 'zacian-crowned', 'pecharunt']) expect(isLegendaryOrMythicalId(n)).toBe(true);
    for (const n of ['absol', 'growlithe', 'iron-hands', 'dratini', 'larvitar', 'eevee']) expect(isLegendaryOrMythicalId(n)).toBe(false);
  });
});

describe('wynik walki i stan spotkania', () => {
  it('wynik silnika → wynik spotkania; przegrana gracza działa jak ucieczka', () => {
    expect(['caught', 'win', 'fled', 'lose', 'cancel'].map(specialResultOf)).toEqual(['CAUGHT', 'DEFEATED', 'ESCAPED', 'LOST', null]);
    expect(stateAfter(ABSOL, 'CAUGHT')).toBe('GONE');
    expect(stateAfter(ABSOL, 'DEFEATED')).toBe('GONE');
    expect(stateAfter(ABSOL, 'ESCAPED')).toBe('HIDDEN_UNTIL_REENTRY');
    expect(stateAfter(ABSOL, 'LOST')).toBe('HIDDEN_UNTIL_REENTRY');
    expect(stateAfter(GUARD, 'ESCAPED')).toBe('REMAINS');
  });

  it('złapanie i pokonanie: wpis w zapisie, ukończenie (wydarzenie) — spotkanie jednorazowe znika na stałe', () => {
    expect(specialOutcome(ABSOL, 'caught', undefined, {}, 50)).toEqual({ record: { result: 'CAUGHT', attempts: 1, completedAt: 50 }, state: 'GONE', completes: true });
    expect(specialOutcome(ABSOL, 'win', { result: 'ESCAPED', attempts: 2, completedAt: null }, {}, 60)).toEqual({ record: { result: 'DEFEATED', attempts: 3, completedAt: 60 }, state: 'GONE', completes: true });
  });

  it('ucieczka zgodnie z polityką powtórzeń: UNTIL_RESOLVED nie kończy spotkania, ONE_ATTEMPT kończy, REPEATABLE nigdy', () => {
    expect(specialOutcome(ABSOL, 'fled', undefined, {}, 1)).toEqual({ record: { result: 'ESCAPED', attempts: 1, completedAt: null }, state: 'HIDDEN_UNTIL_REENTRY', completes: false });
    const oneAttempt: SpecialEncounterDef = { ...ABSOL, repeatPolicy: 'ONE_ATTEMPT', stateAfterEscape: 'GONE' };
    expect(specialOutcome(oneAttempt, 'fled', undefined, {}, 1)).toMatchObject({ state: 'GONE', completes: true });
    const repeat: SpecialEncounterDef = { ...ABSOL, oneTime: false, repeatPolicy: 'REPEATABLE', stateAfterCapture: 'HIDDEN_UNTIL_REENTRY', stateAfterDefeat: 'HIDDEN_UNTIL_REENTRY', stateAfterEscape: 'REMAINS' };
    for (const o of ['caught', 'win', 'fled']) expect(specialOutcome(repeat, o, undefined, {}, 1)?.completes).toBe(false);
    expect(validateSpecialEncounters([oneAttempt])).toEqual([]);
    expect(validateSpecialEncounters([repeat])).toEqual([]);
  });

  it('po ukończeniu kolejne wyniki nic nie zmieniają (brak podwójnego zapisu); przerwanie bez wyniku — też nic', () => {
    expect(specialOutcome(ABSOL, 'caught', undefined, { [ABSOL.completionEventId]: true }, 1)).toBeNull();
    expect(specialOutcome(ABSOL, 'cancel', undefined, {}, 1)).toBeNull();
  });
});

describe('obecność na mapie', () => {
  it('ukończone nie wraca; HIDDEN_UNTIL_REENTRY — tylko do ponownego wejścia; wymagania pojawienia się', () => {
    expect(activeSpecialEncounters(GROTA_ID, prog()).map((s) => s.id)).toEqual(['grota-absol']);
    expect(activeSpecialEncounters(GROTA_ID, prog({ [ABSOL.completionEventId]: true }))).toEqual([]);
    expect(activeSpecialEncounters(GROTA_ID, prog(), new Set(['grota-absol']))).toEqual([]);
    const gated: SpecialEncounterDef = { ...ABSOL, requiredBadges: ['odznaka-wiatru'], requiredItems: ['balm'], requiredEvents: ['grove-done'] };
    expect(activeSpecialEncounters(GROTA_ID, prog(), new Set(), [gated])).toEqual([]);
    expect(activeSpecialEncounters(GROTA_ID, prog({ 'grove-done': true }, { earnedBadges: ['odznaka-wiatru'], bag: { balm: 1 } }), new Set(), [gated])).toHaveLength(1);
  });

  it('spójność zapisu: tylko poprawne wpisy wyników', () => {
    expect(normalizeSpecialRecords({ a: { result: 'CAUGHT', attempts: 2, completedAt: 5 }, b: { result: 'zły' }, c: 7, d: { result: 'ESCAPED' } })).toEqual({
      a: { result: 'CAUGHT', attempts: 2, completedAt: 5 },
      d: { result: 'ESCAPED', attempts: 1, completedAt: null },
    });
    expect(normalizeSpecialRecords(null)).toEqual({});
    expect(normalizeSpecialRecords([1, 2])).toEqual({});
  });
});

describe('walidacja błędnych danych', () => {
  it('niezgodna polityka: złapany zostaje, jednorazowe nie znika, wielokrotne znika, sprzeczne polityki', () => {
    expect(codes([{ ...ABSOL, stateAfterCapture: 'REMAINS' }])).toContain('INVALID_POLICY');
    expect(codes([{ ...ABSOL, stateAfterDefeat: 'REMAINS' }])).toContain('INVALID_POLICY');
    expect(codes([{ ...ABSOL, oneTime: false }])).toContain('INVALID_POLICY');
    expect(codes([{ ...ABSOL, repeatPolicy: 'ONE_ATTEMPT' }])).toContain('INVALID_POLICY'); // ucieczka nie kończy
    expect(codes([{ ...ABSOL, stateAfterEscape: 'GONE' }])).toContain('INVALID_POLICY'); // UNTIL_RESOLVED
    expect(codes([{ ...ABSOL, repeatPolicy: 'REPEATABLE' }])).toContain('INVALID_POLICY');
  });

  it('pozycja i dane: przeszkoda, wyjście, punkt pojawienia się, zajęte pole, poziom, wymagania, powtórzenia', () => {
    expect(codes([{ ...ABSOL, position: { x: 0, y: 0 } }])).toContain('INVALID_POSITION');
    expect(codes([{ ...ABSOL, position: { x: 7, y: 11 } }])).toContain('INVALID_POSITION'); // wyjście z groty
    expect(codes([{ ...ABSOL, position: { x: 7, y: 10 } }])).toContain('INVALID_POSITION'); // punkt pojawienia się
    expect(codes([ABSOL, { ...ABSOL, id: 'drugi', completionEventId: 'inne' }])).toContain('INVALID_POSITION');
    expect(codes([{ ...ABSOL, level: 0 }])).toContain('INVALID_VALUE');
    expect(codes([{ ...ABSOL, locationId: 'wietrzna-straznica', position: { x: 5, y: 12 } }])).toContain('INVALID_VALUE'); // lokacja bez „static”
    expect(codes([{ ...ABSOL, requiredEvents: ['nieznane'] }])).toContain('INVALID_REQUIREMENT');
    expect(codes([{ ...ABSOL, requiredBadges: ['nie-ma'] }])).toContain('INVALID_REQUIREMENT');
    expect(codes([ABSOL, { ...ABSOL }])).toContain('DUPLICATE_ID');
    expect(codes([{ ...ABSOL, completionEventId: 'trainer:polana-bartek:defeated' }])).toContain('DUPLICATE_EVENT');
  });

  it('legendarne lub mityczne stworzenie w zwykłej tabeli trawy → błąd danych', () => {
    const tables = { ...ENCOUNTER_TABLES, meadow: { ...ENCOUNTER_TABLES.meadow, entries: [...ENCOUNTER_TABLES.meadow.entries, { pokemonId: 'mewtwo', weight: 1, minLevel: 5, maxLevel: 5, encounterMethod: 'grass' as const, rarity: 'rare' as const }] } };
    expect(codes(SPECIAL_ENCOUNTERS, tables)).toContain('LEGENDARY_IN_TABLE');
    // …natomiast w spotkaniu specjalnym jest dozwolone.
    expect(codes([{ ...ABSOL, pokemonId: 'mewtwo' }])).not.toContain('LEGENDARY_IN_TABLE');
  });
});
