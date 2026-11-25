import { describe, expect, it } from 'vitest';
import { NEUTRAL_NATURES } from '../../config/natures';
import { POLANA_ID, REGION_ID, ZAGAJNIK_ID } from '../../config/world';
import { resolveSafeEntry } from '../../game/world';
import { SAVE_VERSION, useGame } from '../../state/gameStore';
import { migrateSave } from '../migrations';

/** Zapis w formacie v1 (sprzed Sprintu 3) — tak, jak trzyma go IndexedDB na telefonie. */
function v1Save() {
  return {
    version: 1,
    player: { name: 'Ala', mapId: 'polana', x: 30, y: 8, facing: 'left', money: 777, steps: 1234, playTimeMs: 99, startedAt: 1 },
    party: [],
    storage: [],
    bag: { capsule: 3 },
    dex: {},
    stats: { battlesWon: 4, caught: 2, fled: 1, blackouts: 0, encounters: 7 },
    questsClaimed: { 'first-catch': true },
    flags: { 'grove-done': true },
    settings: { useApiSprites: true, vibration: false, fastText: true, showFollower: true },
  } as Record<string, unknown> & { player: Record<string, unknown> };
}

describe('migracja zapisu v1 → v2 (→ bieżąca)', () => {
  it('bieżąca wersja formatu to 5 (Sprint 7: wyniki spotkań specjalnych)', () => {
    expect(SAVE_VERSION).toBe(5);
  });

  it('mapId „polana” → region, lokacja Polana Startowa i punkt „start”; pozycja i postęp zachowane', () => {
    const out = migrateSave(v1Save());
    expect(out.version).toBe(SAVE_VERSION);
    expect(out.player).toMatchObject({ regionId: REGION_ID, locationId: POLANA_ID, spawnPointId: 'start', x: 30, y: 8, facing: 'left', name: 'Ala', money: 777, steps: 1234 });
    expect('mapId' in out.player).toBe(false);
    expect(out.flags).toEqual({ 'grove-done': true });
    expect(out.stats.battlesWon).toBe(4);
    expect(out.bag).toEqual({ capsule: 3 });
  });

  it('zapis bez numeru wersji traktowany jak v1; nieznana mapa → lokacja startowa', () => {
    const s = v1Save();
    delete (s as { version?: number }).version;
    expect(migrateSave(s).player.locationId).toBe(POLANA_ID);
    const unknown = v1Save();
    unknown.player.mapId = 'nieistniejaca';
    expect(migrateSave(unknown).player).toMatchObject({ locationId: POLANA_ID, regionId: REGION_ID });
  });

  it('zapis v2 przechodzi bez zmian; v2 z nieistniejącą lokacją wraca na start', () => {
    const v2 = { ...v1Save(), version: 2, player: { name: 'B', regionId: REGION_ID, locationId: ZAGAJNIK_ID, spawnPointId: 'z-polany', x: 10, y: 12, facing: 'up' } };
    expect(migrateSave(v2).player).toMatchObject({ locationId: ZAGAJNIK_ID, x: 10, y: 12 });
    const broken = { ...v2, player: { ...v2.player, locationId: 'zniknela' } };
    expect(migrateSave(broken).player).toMatchObject({ locationId: POLANA_ID, spawnPointId: 'start' });
  });

  it('nowsza wersja i uszkodzone dane są odrzucane', () => {
    expect(() => migrateSave({ ...v1Save(), version: 99 })).toThrow();
    expect(() => migrateSave(null)).toThrow();
    expect(() => migrateSave('tekst')).toThrow();
  });

  it('zmigrowany zapis wczytuje się do gry i daje bezpieczny punkt wejścia na Polanie', () => {
    useGame.getState().loadData(migrateSave(v1Save()));
    const p = useGame.getState().player;
    expect(p).toMatchObject({ locationId: POLANA_ID, x: 30, y: 8 });
    expect(resolveSafeEntry(p)).toMatchObject({ locationId: POLANA_ID, x: 30, y: 8 });
    // Snapshot zapisuje już bieżący format.
    const snap = useGame.getState().snapshot();
    expect(snap.version).toBe(SAVE_VERSION);
    expect(snap.player.locationId).toBe(POLANA_ID);
  });
});

describe('zapis położenia w świecie', () => {
  it('setLocation zapisuje region, lokację, punkt pojawienia się i pozycję', () => {
    useGame.getState().resetGame();
    useGame.getState().setLocation({ regionId: REGION_ID, locationId: ZAGAJNIK_ID, spawnPointId: 'z-polany', x: 2, y: 9, facing: 'right' });
    const snap = useGame.getState().snapshot();
    expect(snap.player).toMatchObject({ regionId: REGION_ID, locationId: ZAGAJNIK_ID, spawnPointId: 'z-polany', x: 2, y: 9, facing: 'right' });
    // Ponowne wczytanie zapisu z mapy B (Zagajnik) zachowuje lokację.
    useGame.getState().resetGame();
    useGame.getState().loadData(migrateSave(JSON.parse(JSON.stringify(snap))));
    expect(useGame.getState().player).toMatchObject({ locationId: ZAGAJNIK_ID, x: 2, y: 9 });
  });
});

describe('migracja zapisu v2 → v3 (Sprint 4: natura, zdolność, przedmiot, ewolucja)', () => {
  /** Stworzenie w formacie v2 (pola `ability` i `heldItem`, bez natury). */
  const oldCreature = (uid: string, extra: Record<string, unknown> = {}) => ({
    uid,
    pokemon: 'pidgey',
    speciesId: 16,
    name: 'Pidgey',
    types: ['normal', 'flying'],
    level: 9,
    exp: 600,
    growthRate: 'medium-slow',
    ivs: { hp: 1, atk: 2, def: 3, spa: 4, spd: 5, spe: 6 },
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    stats: { hp: 30, atk: 15, def: 14, spa: 13, spd: 12, spe: 17 },
    hp: 21,
    status: null,
    sleepTurns: 0,
    moves: [{ name: 'tackle', pp: 30, maxPp: 35 }],
    ability: 'keen-eye',
    gender: 'M',
    shiny: false,
    mighty: false,
    heldItem: null,
    friendship: 70,
    metLevel: 3,
    metAt: 'Łąka',
    caughtAt: 1,
    ...extra,
  });
  const v2 = () => ({
    ...v1Save(),
    version: 2,
    player: { name: 'C', regionId: REGION_ID, locationId: POLANA_ID, spawnPointId: 'start', x: 8, y: 7, facing: 'down' },
    party: [oldCreature('c-a'), oldCreature('c-b', { heldItem: 'nieznany-przedmiot' })],
    storage: [oldCreature('c-s', { heldItem: 'trail-leftovers' })],
  });

  it('ability → abilityId, heldItem → heldItemId (tylko znane przedmioty), natura neutralna, pusty stan ewolucji', () => {
    const out = migrateSave(v2());
    expect(out.version).toBe(SAVE_VERSION); // v2 → v3 → v4
    const [a, b] = out.party;
    expect(a).toMatchObject({ abilityId: 'keen-eye', heldItemId: null, evolutionState: { cancelledAtLevel: null, evolvedFrom: null } });
    expect('ability' in a).toBe(false);
    expect('heldItem' in a).toBe(false);
    expect(NEUTRAL_NATURES).toContain(a.nature);
    expect(b.heldItemId).toBeNull();
    expect(out.storage[0].heldItemId).toBe('trail-leftovers');
  });

  it('statystyki, PŻ, ruchy i doświadczenie starych stworzeń się nie zmieniają', () => {
    const before = v2().party[0];
    const after = migrateSave(v2()).party[0];
    expect(after.stats).toEqual(before.stats);
    expect([after.hp, after.exp, after.level]).toEqual([before.hp, before.exp, before.level]);
    expect(after.moves).toEqual(before.moves);
  });

  it('zapis v1 przechodzi przez v2, v3 i v4 do v5; wynik jest stabilny (ponowna migracja nic nie zmienia)', () => {
    const fromV1 = migrateSave({ ...v1Save(), party: [oldCreature('c-1')] });
    expect(fromV1.version).toBe(5);
    expect(fromV1).toMatchObject({ earnedBadges: [], completedChallenges: [], unlockedConnections: [], specialEncounters: {} });
    expect(fromV1.player.locationId).toBe(POLANA_ID);
    expect(fromV1.party[0].abilityId).toBe('keen-eye');
    const again = migrateSave(JSON.parse(JSON.stringify(fromV1)));
    expect(again).toEqual(fromV1);
  });
});

describe('migracja zapisu v3 → v4 (Sprint 6: odznaki, ukończone Próby, odblokowane przejścia)', () => {
  const v3 = (extra: Record<string, unknown> = {}) => ({
    ...v1Save(),
    version: 3,
    player: { name: 'D', regionId: REGION_ID, locationId: ZAGAJNIK_ID, spawnPointId: 'z-polany', x: 10, y: 12, facing: 'down', money: 500, steps: 9, playTimeMs: 1, startedAt: 1 },
    flags: { 'trainer:zagajnik-iga:defeated': true },
    ...extra,
  });

  it('zwykły zapis v3: puste listy postępu Prób, reszta zapisu bez zmian', () => {
    const out = migrateSave(v3());
    expect(out.version).toBe(SAVE_VERSION); // v3 → v4 → v5
    expect(out).toMatchObject({ earnedBadges: [], completedChallenges: [], unlockedConnections: [] });
    expect(out.flags).toEqual({ 'trainer:zagajnik-iga:defeated': true });
    expect(out.player).toMatchObject({ locationId: ZAGAJNIK_ID, x: 10, y: 12, money: 500 });
  });

  it('dawna flaga badge:<id> (wymagania ze Sprintu 3) → zdobyta odznaka i jej odblokowania; nieznane odznaki pomijane', () => {
    const out = migrateSave(v3({ flags: { 'badge:odznaka-wiatru': true, 'badge:nie-ma-takiej': true } }));
    expect(out.earnedBadges).toEqual(['odznaka-wiatru']);
    expect(out.unlockedConnections).toEqual(['zagajnik-do-wzgorz']);
    expect(out.completedChallenges).toEqual([]); // odznaka nie oznacza ukończenia Próby
  });

  it('wydarzenie ukończenia Próby w flagach → ukończona Próba, odznaka i odblokowanie (naprawa spójności)', () => {
    const out = migrateSave(v3({ flags: { 'challenge:proba-wiatru:completed': true } }));
    expect(out.completedChallenges).toEqual(['proba-wiatru']);
    expect(out.earnedBadges).toEqual(['odznaka-wiatru']);
    expect(out.unlockedConnections).toEqual(['zagajnik-do-wzgorz']);
  });

  it('zapis v4: listy bez powtórzeń i tylko napisy; ukończona Próba ⇒ wydarzenie, odznaka ⇒ przejście; ponowna migracja stabilna', () => {
    const raw = {
      ...v3(),
      version: 4,
      earnedBadges: ['odznaka-wiatru', 'odznaka-wiatru', 7],
      completedChallenges: ['proba-wiatru', null],
      unlockedConnections: 'zły-typ',
    };
    const out = migrateSave(raw);
    expect(out.earnedBadges).toEqual(['odznaka-wiatru']);
    expect(out.completedChallenges).toEqual(['proba-wiatru']);
    expect(out.unlockedConnections).toEqual(['zagajnik-do-wzgorz']);
    expect(out.flags['challenge:proba-wiatru:completed']).toBe(true);
    expect(migrateSave(JSON.parse(JSON.stringify(out)))).toEqual(out);
  });

  it('zapis v4 z postępem po wczytaniu do gry i ponownym zapisie (snapshot) zachowuje odznaki i odblokowania', () => {
    const out = migrateSave({ ...v3(), version: 4, earnedBadges: ['odznaka-wiatru'], completedChallenges: ['proba-wiatru'], unlockedConnections: ['zagajnik-do-wzgorz'] });
    useGame.getState().loadData(out);
    const snap = useGame.getState().snapshot();
    expect(snap).toMatchObject({ version: SAVE_VERSION, earnedBadges: ['odznaka-wiatru'], completedChallenges: ['proba-wiatru'], unlockedConnections: ['zagajnik-do-wzgorz'] });
    expect(migrateSave(snap)).toEqual(snap);
    useGame.getState().resetGame();
  });
});

describe('migracja zapisu v4 → v5 (Sprint 7: wyniki spotkań specjalnych)', () => {
  const v4 = (extra: Record<string, unknown> = {}) => ({
    ...v1Save(),
    version: 4,
    player: { name: 'E', regionId: REGION_ID, locationId: POLANA_ID, spawnPointId: 'start', x: 8, y: 7, facing: 'down', money: 900, steps: 1, playTimeMs: 1, startedAt: 1 },
    flags: { 'static-done:gaj-straznik': true, 'grove-done': true },
    earnedBadges: ['odznaka-wiatru'],
    completedChallenges: ['proba-wiatru'],
    unlockedConnections: ['zagajnik-do-wzgorz'],
    ...extra,
  });

  it('zapis v4: pusta lista wyników; ukończony Strażnik (flaga ze Sprintu 2) i postęp Prób bez zmian', () => {
    const out = migrateSave(v4());
    expect(out.version).toBe(5);
    expect(out.specialEncounters).toEqual({});
    expect(out.flags['static-done:gaj-straznik']).toBe(true);
    expect(out).toMatchObject({ earnedBadges: ['odznaka-wiatru'], completedChallenges: ['proba-wiatru'], unlockedConnections: ['zagajnik-do-wzgorz'] });
  });

  it('zapis v5: tylko poprawne wpisy wyników; ponowna migracja stabilna', () => {
    const out = migrateSave({ ...v4(), version: 5, specialEncounters: { 'grota-absol': { result: 'ESCAPED', attempts: 2, completedAt: null }, zly: { result: '?' } } });
    expect(out.specialEncounters).toEqual({ 'grota-absol': { result: 'ESCAPED', attempts: 2, completedAt: null } });
    expect(migrateSave(JSON.parse(JSON.stringify(out)))).toEqual(out);
  });
});

describe('migracja nie usuwa danych (Sprint 7)', () => {
  it('starszy zapis z polami nowszej wersji (np. zbudowany z bieżącego stanu): odznaki, Próby, przejścia i wyniki spotkań zostają', () => {
    const raw = {
      ...v1Save(),
      earnedBadges: ['odznaka-wiatru'],
      completedChallenges: ['proba-wiatru'],
      unlockedConnections: ['zagajnik-do-wzgorz'],
      specialEncounters: { 'gaj-straznik': { result: 'CAUGHT', attempts: 1, completedAt: 10 } },
      flags: { 'grove-done': true, 'static-done:gaj-straznik': true, 'badge:odznaka-wiatru': true },
    };
    const out = migrateSave(raw);
    expect(out.version).toBe(SAVE_VERSION);
    expect(out).toMatchObject({ earnedBadges: ['odznaka-wiatru'], completedChallenges: ['proba-wiatru'], unlockedConnections: ['zagajnik-do-wzgorz'] });
    expect(out.specialEncounters).toEqual({ 'gaj-straznik': { result: 'CAUGHT', attempts: 1, completedAt: 10 } });
  });
});
