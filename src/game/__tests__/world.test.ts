import { describe, expect, it } from 'vitest';
import { ENCOUNTER_TABLES } from '../../config/encounters';
import { GROTA_ID, POLANA_ID, REGION_ID, STRAZNICA_ID, WORLD, WZGORZA_ID, ZAGAJNIK_ID, type LocationDef, type WorldDef } from '../../config/world';
import { encounterZoneAt } from '../encounterZones';
import { MAPS } from '../maps';
import { isWalkable } from '../movement';
import {
  checkTravel,
  connectionAt,
  getLocation,
  getRegion,
  healingTarget,
  mapOf,
  requirementsMet,
  resolveSafeEntry,
  spawnPointOf,
  startPosition,
  validateWorld,
} from '../world';

const POLANA = getLocation(POLANA_ID)!;
const ZAGAJNIK = getLocation(ZAGAJNIK_ID)!;
const NO_PROGRESS = { flags: {}, bag: {} };
const grid = (loc: LocationDef) => mapOf(loc)!.layout.map((r) => r.split(''));
const clone = (): WorldDef => structuredClone(WORLD);
const codes = (w: WorldDef, maps = MAPS) => validateWorld(w, maps).map((i) => i.code);

/** BFS po polach dostępnych mapy (wyzwalacze przejść traktujemy jak zwykłe pola). */
function reachable(loc: LocationDef, from: { x: number; y: number }): Set<string> {
  const g = grid(loc);
  const seen = new Set([`${from.x},${from.y}`]);
  const queue = [from];
  while (queue.length) {
    const p = queue.shift()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = p.x + dx, y = p.y + dy;
      const k = `${x},${y}`;
      if (!seen.has(k) && isWalkable(g, x, y)) {
        seen.add(k);
        queue.push({ x, y });
      }
    }
  }
  return seen;
}

describe('model świata: dane', () => {
  it('dane świata przechodzą walidację bez błędów', () => {
    expect(validateWorld()).toEqual([]);
  });

  it('region i lokacje mają wymagane pola; Polana Startowa ma stabilny identyfikator', () => {
    const region = getRegion(REGION_ID)!;
    expect(region).toMatchObject({ startLocationId: POLANA_ID, status: 'IMPLEMENTED', generationReference: 'mixed' });
    expect(region.locationIds).toEqual([POLANA_ID, ZAGAJNIK_ID, WZGORZA_ID, STRAZNICA_ID, GROTA_ID]);
    expect(POLANA_ID).toBe('polana-startowa');
    for (const l of WORLD.locations) {
      for (const key of ['id', 'name', 'regionId', 'type', 'status', 'mapReference', 'connections', 'spawnPoints', 'encounterTableIds', 'availableEncounterMethods', 'requiredBadges', 'requiredItems', 'requiredEvents', 'hidden', 'healingPoint']) {
        expect(key in l).toBe(true);
      }
    }
    // Sprint 6: Wzgórza Wiatru (za zamkniętym przejściem) i Wietrzna Strażnica (lokacja Próby) są grywalne.
    // Sprint 7: Grota Echa — ukryta lokacja (hidden: true, wejście przez ukryte wejście na Wzgórzach).
    expect(WORLD.locations.filter((l) => l.status === 'IMPLEMENTED').map((l) => l.id)).toEqual([POLANA_ID, ZAGAJNIK_ID, WZGORZA_ID, STRAZNICA_ID, GROTA_ID]);
    expect(WORLD.locations.filter((l) => l.hidden).map((l) => l.id)).toEqual([GROTA_ID]);
    expect(getLocation(STRAZNICA_ID)).toMatchObject({ type: 'CHALLENGE', encounterTableIds: [], mapReference: 'straznica' });
    expect(startPosition()).toMatchObject({ regionId: REGION_ID, locationId: POLANA_ID, spawnPointId: 'start', x: 8, y: 7 });
  });

  it('każda lokacja ma własną tabelę spotkań — tabele Polany i Zagajnika są rozłączne', () => {
    const a = new Set(POLANA.encounterTableIds);
    expect(ZAGAJNIK.encounterTableIds.some((t) => a.has(t))).toBe(false);
    const polanaSpecies = new Set(POLANA.encounterTableIds.flatMap((t) => ENCOUNTER_TABLES[t].entries.map((e) => e.pokemonId)));
    for (const e of ENCOUNTER_TABLES.zagajnik.entries) expect(polanaSpecies.has(e.pokemonId)).toBe(false);
  });

  it('druga mapa: kolizje na brzegach (poza wyjściami), obszar bezpieczny, teren spotkań z tabelą „zagajnik”', () => {
    const g = grid(ZAGAJNIK);
    const h = g.length, w = g[0].length;
    const edgeWalkable: string[] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((x === 0 || y === 0 || x === w - 1 || y === h - 1) && isWalkable(g, x, y)) edgeWalkable.push(`${x},${y}`);
    expect(edgeWalkable.sort()).toEqual(['0,9', '13,0', '25,16']); // Polana, Wzgórza (zamknięte), Strażnica
    for (const k of edgeWalkable) {
      const [x, y] = k.split(',').map(Number);
      expect(connectionAt(ZAGAJNIK, x, y)).not.toBeNull();
    }
    const map = mapOf(ZAGAJNIK)!;
    const entry = spawnPointOf(ZAGAJNIK, 'z-polany')!;
    expect(encounterZoneAt(map, g, entry.x, entry.y, {})).toBeNull(); // bezpieczne wejście
    let grass = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const z = encounterZoneAt(map, g, x, y, {});
      if (z) {
        grass++;
        expect(z.encounterTableId).toBe('zagajnik');
      }
    }
    expect(grass).toBeGreaterThan(50);
  });
});

describe('połączenia i przejścia', () => {
  it('przejście z Polany (A) do Zagajnika (B) — poprawny punkt pojawienia się', () => {
    const conn = connectionAt(POLANA, 39, 14)!;
    expect(conn.destinationLocationId).toBe(ZAGAJNIK_ID);
    const t = checkTravel(conn, NO_PROGRESS);
    expect(t.ok).toBe(true);
    if (t.ok) expect(t.position).toEqual({ regionId: REGION_ID, locationId: ZAGAJNIK_ID, spawnPointId: 'z-polany', x: 2, y: 9, facing: 'right' });
  });

  it('powrót z Zagajnika (B) na Polanę (A) — przy wschodnim wyjściu, twarzą od wyjścia', () => {
    const t = checkTravel(connectionAt(ZAGAJNIK, 0, 9)!, NO_PROGRESS);
    expect(t.ok).toBe(true);
    if (t.ok) expect(t.position).toEqual({ regionId: REGION_ID, locationId: POLANA_ID, spawnPointId: 'z-zagajnika', x: 38, y: 14, facing: 'left' });
  });

  it('ścieżka na Wzgórza jest zamknięta (zwalone drzewo) do odblokowania przejścia; po odblokowaniu prowadzi na Wzgórza', () => {
    const conn = connectionAt(ZAGAJNIK, 13, 0)!;
    expect(conn).toMatchObject({ id: 'zagajnik-do-wzgorz', locked: true, lockVisual: 'fallen-tree' });
    const t = checkTravel(conn, NO_PROGRESS);
    expect(t.ok).toBe(false);
    if (!t.ok) {
      expect(t.reason).toBe('locked');
      expect(t.message.join(' ')).toContain('zwalone drzewo');
    }
    // Sama odznaka bez odblokowania przejścia nie otwiera drogi — liczy się lista unlockedConnections.
    expect(checkTravel(conn, { ...NO_PROGRESS, earnedBadges: ['odznaka-wiatru'] })).toMatchObject({ ok: false, reason: 'locked' });
    const open = checkTravel(conn, { ...NO_PROGRESS, unlockedConnections: ['zagajnik-do-wzgorz'] });
    expect(open.ok).toBe(true);
    if (open.ok) expect(open.position).toEqual({ regionId: REGION_ID, locationId: WZGORZA_ID, spawnPointId: 'z-zagajnika', x: 11, y: 14, facing: 'up' });
    // Powrót ze Wzgórz jest zawsze otwarty.
    const back = checkTravel(connectionAt(getLocation(WZGORZA_ID)!, 11, 15)!, NO_PROGRESS);
    expect(back.ok && back.position).toMatchObject({ locationId: ZAGAJNIK_ID, spawnPointId: 'ze-wzgorz', x: 13, y: 1, facing: 'down' });
  });

  it('Zagajnik ↔ Wietrzna Strażnica: przejście otwarte w obie strony', () => {
    const there = checkTravel(connectionAt(ZAGAJNIK, 25, 16)!, NO_PROGRESS);
    expect(there.ok && there.position).toMatchObject({ locationId: STRAZNICA_ID, spawnPointId: 'z-zagajnika', x: 1, y: 11, facing: 'right' });
    const back = checkTravel(connectionAt(getLocation(STRAZNICA_ID)!, 0, 11)!, NO_PROGRESS);
    expect(back.ok && back.position).toMatchObject({ locationId: ZAGAJNIK_ID, spawnPointId: 'ze-straznicy', x: 24, y: 16, facing: 'left' });
  });

  it('wymagania połączenia i lokacji: odznaki (zdobyte odznaki w zapisie), przedmioty (torba), wydarzenia (flagi)', () => {
    expect(requirementsMet({ badges: ['las'] }, NO_PROGRESS)).toBe(false);
    expect(requirementsMet({ badges: ['las'] }, { flags: {}, bag: {}, earnedBadges: ['las'] })).toBe(true);
    // Sprint 6: odznaki nie są już flagami — dawne flagi badge: przenosi migracja zapisu v3 → v4.
    expect(requirementsMet({ badges: ['las'] }, { flags: { 'badge:las': true }, bag: {} })).toBe(false);
    expect(requirementsMet({ items: ['potion'] }, { flags: {}, bag: { potion: 0 } })).toBe(false);
    expect(requirementsMet({ items: ['potion'] }, { flags: {}, bag: { potion: 2 } })).toBe(true);
    expect(requirementsMet({ events: ['most'] }, { flags: { most: true }, bag: {} })).toBe(true);
    // Połączenie do grywalnej lokacji z niespełnionym wymaganiem → komunikat; po spełnieniu → przejście.
    const w = clone();
    const z = w.locations.find((l) => l.id === POLANA_ID)!.connections[0];
    z.requirements = { events: ['most-naprawiony'] };
    expect(checkTravel(z, NO_PROGRESS, w)).toMatchObject({ ok: false, reason: 'requirements' });
    expect(checkTravel(z, { flags: { 'most-naprawiony': true }, bag: {} }, w).ok).toBe(true);
    z.requirements = { badges: ['odznaka-wiatru'] };
    expect(checkTravel(z, NO_PROGRESS, w)).toMatchObject({ ok: false, reason: 'requirements' });
    expect(checkTravel(z, { flags: {}, bag: {}, earnedBadges: ['odznaka-wiatru'] }, w).ok).toBe(true);
  });

  it('punkt leczenia Zagajnika to Stacja Opieki na Polanie (przegrana przenosi między mapami)', () => {
    expect(healingTarget(ZAGAJNIK_ID)).toMatchObject({ locationId: POLANA_ID, spawnPointId: 'stacja-opieki', x: 5, y: 6 });
    expect(healingTarget(POLANA_ID)).toMatchObject({ locationId: POLANA_ID, spawnPointId: 'stacja-opieki' });
    expect(healingTarget('nie-ma-takiej')).toEqual(startPosition());
  });
});

describe('brak softlocka', () => {
  it('z każdego punktu pojawienia się da się dojść do każdego wyjścia lokacji', () => {
    for (const loc of WORLD.locations.filter((l) => l.status === 'IMPLEMENTED')) {
      for (const sp of loc.spawnPoints) {
        const seen = reachable(loc, sp);
        for (const c of loc.connections) expect(seen.has(`${c.sourceTrigger.x},${c.sourceTrigger.y}`)).toBe(true);
        expect(connectionAt(loc, sp.x, sp.y)).toBeNull(); // pojawienie się nie uruchamia od razu przejścia
      }
    }
  });

  it('bezpieczne wejście przy wczytaniu: zła lokacja, pozycja w ścianie lub na wyjściu → punkt pojawienia się', () => {
    const p = { regionId: REGION_ID, locationId: ZAGAJNIK_ID, spawnPointId: 'z-polany', facing: 'down' as const };
    expect(resolveSafeEntry({ ...p, x: 10, y: 12 })).toMatchObject({ locationId: ZAGAJNIK_ID, x: 10, y: 12 }); // poprawna pozycja zostaje
    expect(resolveSafeEntry({ ...p, x: 0, y: 0 })).toMatchObject({ locationId: ZAGAJNIK_ID, x: 2, y: 9, spawnPointId: 'z-polany' }); // drzewo
    expect(resolveSafeEntry({ ...p, x: 0, y: 9 })).toMatchObject({ locationId: ZAGAJNIK_ID, x: 2, y: 9 }); // wyzwalacz wyjścia
    expect(resolveSafeEntry({ ...p, x: 99, y: 99, spawnPointId: 'nie-ma' })).toMatchObject({ locationId: ZAGAJNIK_ID, spawnPointId: 'start', x: 3, y: 9 });
    expect(resolveSafeEntry({ ...p, locationId: 'nie-ma-takiej', x: 3, y: 3 })).toEqual(startPosition());
    // Lokacja bez mapy (PLANNED) — w danych gry już takiej nie ma, więc sprawdzamy na kopii świata.
    const w = clone();
    Object.assign(w.locations.find((l) => l.id === WZGORZA_ID)!, { status: 'PLANNED', mapReference: null });
    expect(resolveSafeEntry({ ...p, locationId: WZGORZA_ID, x: 11, y: 13 }, w)).toEqual(startPosition(w));
  });
});

describe('walidacja błędnych danych', () => {
  it('błędne połączenie: wyzwalacz na przeszkodzie, nieistniejąca lokacja docelowa, brak punktu docelowego', () => {
    const w1 = clone();
    w1.locations[0].connections[0].sourceTrigger = { kind: 'tile', x: 0, y: 0 }; // drzewo
    expect(codes(w1)).toContain('INVALID_CONNECTION');

    const w2 = clone();
    w2.locations[0].connections[0].destinationLocationId = 'nie-ma-takiej';
    expect(codes(w2)).toContain('MISSING_LOCATION');

    const w3 = clone();
    w3.locations[0].connections[0].destinationSpawnPoint = 'nie-ma-takiego';
    expect(codes(w3)).toContain('MISSING_SPAWN_POINT');

    const w4 = clone();
    w4.locations[0].connections[0].sourceLocationId = ZAGAJNIK_ID; // połączenie zdefiniowane w złej lokacji
    expect(codes(w4)).toContain('INVALID_CONNECTION');
  });

  it('zamknięte przejście: musi je otwierać odznaka; przeszkoda tylko na zamkniętym; lokacja za nim osiągalna tylko dzięki odznace', () => {
    const w1 = clone();
    const c1 = validateWorld(w1, MAPS, ENCOUNTER_TABLES, new Set()).map((i) => i.code);
    expect(c1).toContain('INVALID_CONNECTION'); // nikt nie otwiera „zagajnik-do-wzgorz”
    expect(c1).toContain('UNREACHABLE'); // Wzgórza nieosiągalne bez odblokowania
    const w2 = clone();
    w2.locations.find((l) => l.id === POLANA_ID)!.connections[0].lockVisual = 'fallen-tree';
    expect(codes(w2)).toContain('INVALID_CONNECTION');
  });

  it('brak drogi powrotnej i lokacja nieosiągalna', () => {
    const w = clone();
    w.locations.find((l) => l.id === ZAGAJNIK_ID)!.connections = w.locations.find((l) => l.id === ZAGAJNIK_ID)!.connections.filter((c) => c.destinationLocationId !== POLANA_ID);
    expect(codes(w)).toContain('INVALID_CONNECTION');
    const w2 = clone();
    w2.locations.find((l) => l.id === POLANA_ID)!.connections = [];
    expect(codes(w2)).toContain('UNREACHABLE');
  });

  it('duplikaty identyfikatorów, brakująca mapa, brakująca tabela, punkt pojawienia się na przeszkodzie lub wyjściu', () => {
    const w1 = clone();
    w1.locations.push({ ...structuredClone(w1.locations[2]) });
    expect(codes(w1)).toContain('DUPLICATE_ID');

    const w2 = clone();
    w2.locations[1].mapReference = 'nie-ma-mapy';
    expect(codes(w2)).toContain('MISSING_MAP');

    const w3 = clone();
    w3.locations[1].encounterTableIds = ['nie-ma-tabeli'];
    const c3 = codes(w3);
    expect(c3).toContain('MISSING_ENCOUNTER_TABLE');
    expect(c3).toContain('INVALID_ENCOUNTER_SETUP'); // strefa mapy wskazuje tabelę spoza lokacji

    const w4 = clone();
    w4.locations[1].spawnPoints[1] = { id: 'z-polany', x: 0, y: 0, facing: 'right' };
    expect(codes(w4)).toContain('INVALID_SPAWN_POINT');
    const w5 = clone();
    w5.locations[1].spawnPoints[1] = { id: 'z-polany', x: 0, y: 9, facing: 'right' };
    expect(codes(w5)).toContain('INVALID_SPAWN_POINT');

    const w6 = clone();
    w6.locations[1].encounterTableIds = ['zagajnik', 'meadow'];
    expect(codes(w6)).toContain('INVALID_ENCOUNTER_SETUP'); // tabela w dwóch lokacjach

    const w7 = clone();
    w7.regions[0].locationIds.push('nie-ma-takiej');
    expect(codes(w7)).toContain('MISSING_LOCATION');
  });
});
