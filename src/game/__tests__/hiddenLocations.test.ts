// Ukryte lokacje (Sprint 7): dane i model, wymagania wejścia (odznaka, przedmiot, wydarzenie, Próba, odkrycie,
// kilka naraz), zablokowane i odblokowane wejście, odkrycie (wydarzenie i nagroda dokładnie raz), widoczność wejścia,
// osiągalność w modelu świata i walidacja błędnych danych.

import { afterEach, describe, expect, it } from 'vitest';
import { HIDDEN_LOCATIONS, type HiddenLocationDef } from '../../config/hiddenLocations';
import { GROTA_ID, WORLD, WZGORZA_ID, type WorldDef } from '../../config/world';
import { ENCOUNTER_TABLES } from '../../config/encounters';
import { useGame } from '../../state/gameStore';
import { getHiddenLocation, hiddenEntranceAt, hiddenEntryCheck, missingEntryRequirements, validateHiddenLocations, visibleEntrances } from '../hiddenLocations';
import { MAPS } from '../maps';
import { getLocation, isDiscoveredLocation, requirementsMet, validateWorld, type ProgressState } from '../world';

const GROTA = getHiddenLocation(GROTA_ID)!;
const STRAZNIK = 'static-done:gaj-straznik';
const BADGE = 'odznaka-wiatru';
const none = (p: Partial<ProgressState> = {}): ProgressState => ({ flags: {}, bag: {}, earnedBadges: [], completedChallenges: [], ...p });
const ready = (p: Partial<ProgressState> = {}) => none({ earnedBadges: [BADGE], flags: { [STRAZNIK]: true }, ...p });
const codes = (list: readonly HiddenLocationDef[], world: WorldDef = WORLD) => validateHiddenLocations(list, world).map((i) => i.code);
const cloneWorld = (): WorldDef => structuredClone(WORLD);

afterEach(() => useGame.getState().resetGame());

describe('ukryta lokacja: dane', () => {
  it('dane ukrytych lokacji i świata przechodzą walidację (osiągalność przez ukryte wejście)', () => {
    expect(validateHiddenLocations()).toEqual([]);
    expect(validateWorld()).toEqual([]);
  });

  it('model ma wszystkie pola; Grota Echa jest ukrytą lokacją świata za głazem na Wzgórzach Wiatru', () => {
    for (const key of ['id', 'regionId', 'parentLocationId', 'mapReference', 'entranceTrigger', 'entryRequirements', 'discoveryEventId', 'visibleAfterDiscovery', 'specialEncounterIds', 'rewards', 'status']) {
      expect(key in GROTA).toBe(true);
    }
    expect(HIDDEN_LOCATIONS).toHaveLength(1);
    expect(GROTA).toMatchObject({ parentLocationId: WZGORZA_ID, mapReference: 'grota', entranceTrigger: { kind: 'interact', x: 7, y: 8 }, visibleAfterDiscovery: true, specialEncounterIds: ['grota-absol'], status: 'IMPLEMENTED' });
    expect(getLocation(GROTA_ID)).toMatchObject({ hidden: true, type: 'CAVE', mapReference: 'grota' });
    expect(MAPS.wzgorza.layout[8][7]).toBe('R'); // wejście to głaz badany z sąsiedniego pola
  });

  it('bez ukrytego wejścia Grota byłaby nieosiągalna i bez drogi powrotnej (walidacja świata)', () => {
    const c = validateWorld(WORLD, MAPS, ENCOUNTER_TABLES, undefined, []).map((i) => i.code);
    expect(c).toContain('UNREACHABLE');
    expect(c).toContain('INVALID_CONNECTION');
  });
});

describe('wymagania wejścia', () => {
  it('każdy rodzaj wymagania: odznaka, przedmiot, wydarzenie, ukończona Próba, odkryte ukryte przejście', () => {
    expect(requirementsMet({ badges: [BADGE] }, none())).toBe(false);
    expect(requirementsMet({ badges: [BADGE] }, none({ earnedBadges: [BADGE] }))).toBe(true);
    expect(requirementsMet({ items: ['balm'] }, none())).toBe(false);
    expect(requirementsMet({ items: ['balm'] }, none({ bag: { balm: 1 } }))).toBe(true);
    expect(requirementsMet({ events: [STRAZNIK] }, none())).toBe(false);
    expect(requirementsMet({ events: [STRAZNIK] }, none({ flags: { [STRAZNIK]: true } }))).toBe(true);
    expect(requirementsMet({ challenges: ['proba-wiatru'] }, none())).toBe(false);
    expect(requirementsMet({ challenges: ['proba-wiatru'] }, none({ completedChallenges: ['proba-wiatru'] }))).toBe(true);
    expect(requirementsMet({ discoveries: [GROTA_ID] }, none())).toBe(false);
    expect(requirementsMet({ discoveries: [GROTA_ID] }, none({ flags: { [GROTA.discoveryEventId]: true } }))).toBe(true);
    expect(isDiscoveredLocation('nie-ma-takiej', { 'nie-ma-takiej': true })).toBe(false);
  });

  it('kilka warunków jednocześnie: wszystkie muszą być spełnione; lista braków jest czytelna', () => {
    const req = { badges: [BADGE], items: ['balm'], events: [STRAZNIK], challenges: ['proba-wiatru'], discoveries: [GROTA_ID] };
    const all = none({ earnedBadges: [BADGE], bag: { balm: 1 }, flags: { [STRAZNIK]: true, [GROTA.discoveryEventId]: true }, completedChallenges: ['proba-wiatru'] });
    expect(requirementsMet(req, all)).toBe(true);
    expect(requirementsMet(req, { ...all, bag: {} })).toBe(false);
    expect(missingEntryRequirements(req, none())).toEqual([
      'odznaka: Odznaka Wiatru',
      'przedmiot: Balsam',
      'Strażnik Cichego Gaju (złapany lub pokonany)',
      'ukończ: Próba Wiatru',
      'odkryj: Grota Echa',
    ]);
  });
});

describe('wejście do ukrytej lokacji', () => {
  it('zablokowane wejście: brak odznaki lub Strażnika → komunikat z listą braków, bez przejścia', () => {
    const c = hiddenEntryCheck(GROTA, none());
    expect(c.ok).toBe(false);
    if (!c.ok) {
      expect(c.reason).toBe('requirements');
      expect(c.missing).toEqual(['odznaka: Odznaka Wiatru', 'Strażnik Cichego Gaju (złapany lub pokonany)']);
      expect(c.message.join(' ')).toContain('Szczelina jest jednak zbyt wąska');
    }
    expect(hiddenEntryCheck(GROTA, none({ earnedBadges: [BADGE] })).ok).toBe(false); // jeden z dwóch warunków to za mało
  });

  it('odblokowane wejście: pierwsze wejście to odkrycie; po odkryciu — zwykłe wejście', () => {
    const c = hiddenEntryCheck(GROTA, ready());
    expect(c).toMatchObject({ ok: true, firstDiscovery: true, position: { locationId: GROTA_ID, spawnPointId: 'z-wzgorz', x: 7, y: 10, facing: 'up' } });
    expect(hiddenEntryCheck(GROTA, ready({ flags: { [STRAZNIK]: true, [GROTA.discoveryEventId]: true } }))).toMatchObject({ ok: true, firstDiscovery: false });
  });

  it('odkrycie: wydarzenie zapisane i nagroda przyznana dokładnie raz', () => {
    const g = useGame.getState();
    expect(g.bag['capsule-plus'] ?? 0).toBe(0);
    expect(g.discoverHiddenLocation(GROTA_ID)).toEqual({ first: true, money: 0, items: [['capsule-plus', 3]] });
    expect(useGame.getState().flags[GROTA.discoveryEventId]).toBe(true);
    expect(useGame.getState().bag['capsule-plus']).toBe(3);
    expect(useGame.getState().discoverHiddenLocation(GROTA_ID)).toEqual({ first: false, money: 0, items: [] });
    expect(useGame.getState().bag['capsule-plus']).toBe(3);
    expect(useGame.getState().discoverHiddenLocation('nie-ma-takiej')).toBeNull();
  });

  it('ukryte wejście: tylko badanie głazu (rodzaj „interact”) w lokacji nadrzędnej; widoczne dopiero po odkryciu', () => {
    expect(hiddenEntranceAt(WZGORZA_ID, 7, 8, 'interact')?.id).toBe(GROTA_ID);
    expect(hiddenEntranceAt(WZGORZA_ID, 7, 8, 'tile')).toBeNull();
    expect(hiddenEntranceAt(WZGORZA_ID, 15, 8, 'interact')).toBeNull();
    expect(hiddenEntranceAt('polana-startowa', 7, 8, 'interact')).toBeNull();
    expect(visibleEntrances(WZGORZA_ID, {})).toEqual([]);
    expect(visibleEntrances(WZGORZA_ID, { [GROTA.discoveryEventId]: true }).map((h) => h.id)).toEqual([GROTA_ID]);
    expect(visibleEntrances(WZGORZA_ID, { [GROTA.discoveryEventId]: true }, [{ ...GROTA, visibleAfterDiscovery: false }])).toEqual([]);
  });

  it('wejście przez pole (rodzaj „tile”) — ogólny system obsługuje także ten rodzaj', () => {
    const onPath: HiddenLocationDef = { ...GROTA, entranceTrigger: { kind: 'tile', x: 11, y: 7, destinationSpawnPoint: 'z-wzgorz' } };
    expect(hiddenEntranceAt(WZGORZA_ID, 11, 7, 'tile', [onPath])?.id).toBe(GROTA_ID);
    expect(validateHiddenLocations([onPath])).toEqual([]);
  });
});

describe('walidacja błędnych danych', () => {
  it('lokacja nieukryta lub nieznana, zła mapa, brak punktu wejścia i wyjścia', () => {
    const w = cloneWorld();
    w.locations.find((l) => l.id === GROTA_ID)!.hidden = false;
    expect(codes([GROTA], w)).toContain('NOT_HIDDEN');
    expect(codes([{ ...GROTA, id: 'nie-ma' }])).toContain('MISSING_LOCATION');
    expect(codes([{ ...GROTA, mapReference: 'polana' }])).toContain('INVALID_VALUE');
    expect(codes([{ ...GROTA, entranceTrigger: { ...GROTA.entranceTrigger, destinationSpawnPoint: 'nie-ma' } }])).toContain('INVALID_ENTRANCE');
    const w2 = cloneWorld();
    w2.locations.find((l) => l.id === GROTA_ID)!.connections = [];
    expect(codes([GROTA], w2)).toContain('MISSING_EXIT');
  });

  it('wejście: poza mapą, pole „tile” na przeszkodzie, badane pole bez dojścia, tabliczka', () => {
    expect(codes([{ ...GROTA, entranceTrigger: { ...GROTA.entranceTrigger, x: 99 } }])).toContain('INVALID_ENTRANCE');
    expect(codes([{ ...GROTA, entranceTrigger: { ...GROTA.entranceTrigger, kind: 'tile' } }])).toContain('INVALID_ENTRANCE'); // głaz
    expect(codes([{ ...GROTA, entranceTrigger: { ...GROTA.entranceTrigger, x: 0, y: 0 } }])).toContain('INVALID_ENTRANCE'); // drzewo w rogu
    expect(codes([{ ...GROTA, entranceTrigger: { ...GROTA.entranceTrigger, x: 10, y: 1 } }])).toContain('INVALID_ENTRANCE'); // tabliczka
  });

  it('wymagania i spotkania: nieznane odznaki/przedmioty/wydarzenia/Próby/odkrycia, własne odkrycie, cudze spotkanie, powtórzone wydarzenie', () => {
    expect(codes([{ ...GROTA, entryRequirements: { badges: ['nie-ma'] } }])).toContain('INVALID_REQUIREMENT');
    expect(codes([{ ...GROTA, entryRequirements: { items: ['nie-ma'] } }])).toContain('INVALID_REQUIREMENT');
    expect(codes([{ ...GROTA, entryRequirements: { events: ['nieznane'] } }])).toContain('INVALID_REQUIREMENT');
    expect(codes([{ ...GROTA, entryRequirements: { challenges: ['nie-ma'] } }])).toContain('INVALID_REQUIREMENT');
    expect(codes([{ ...GROTA, entryRequirements: { discoveries: [GROTA_ID] } }])).toContain('INVALID_REQUIREMENT');
    expect(codes([{ ...GROTA, specialEncounterIds: ['gaj-straznik'] }])).toContain('INVALID_VALUE');
    expect(codes([GROTA, { ...GROTA }])).toContain('DUPLICATE_ID');
    expect(codes([GROTA, { ...GROTA, id: 'inna' }])).toContain('DUPLICATE_EVENT');
  });
});
