import { describe, expect, it } from 'vitest';
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

describe('migracja zapisu v1 → v2', () => {
  it('bieżąca wersja formatu to 2', () => {
    expect(SAVE_VERSION).toBe(2);
  });

  it('mapId „polana” → region, lokacja Polana Startowa i punkt „start”; pozycja i postęp zachowane', () => {
    const out = migrateSave(v1Save());
    expect(out.version).toBe(2);
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
    // Snapshot zapisuje już format v2.
    const snap = useGame.getState().snapshot();
    expect(snap.version).toBe(2);
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
