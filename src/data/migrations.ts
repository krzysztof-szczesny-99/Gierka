// Migracje zapisów gry między wersjami formatu (czyste funkcje — testowane jednostkowo).
// v1 → v2 (Sprint 3): `player.mapId` zastąpione położeniem w modelu świata (regionId, locationId, spawnPointId);
// pozycja x/y zostaje zachowana jako bezpieczny punkt wejścia (sprawdzany przy wczytaniu przez resolveSafeEntry).

import { DEFAULT_SPAWN_POINT_ID } from '../config/world';
import { getLocation, locationForMap, startLocation } from '../game/world';
import { SAVE_VERSION, type GameData, type PlayerState } from '../state/gameStore';

type AnyRecord = Record<string, unknown>;

function isRecord(v: unknown): v is AnyRecord {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** v1 → v2: mapa → lokacja i region; brakujące lub nieznane dane — lokacja startowa. */
function v1ToV2(data: AnyRecord): AnyRecord {
  const player = isRecord(data.player) ? { ...data.player } : {};
  const mapId = typeof player.mapId === 'string' ? player.mapId : null;
  const loc = (mapId ? locationForMap(mapId) : null) ?? startLocation();
  player.regionId = loc.regionId;
  player.locationId = loc.id;
  player.spawnPointId = DEFAULT_SPAWN_POINT_ID;
  delete player.mapId;
  return { ...data, player, version: 2 };
}

const STEPS: Record<number, (d: AnyRecord) => AnyRecord> = {
  1: v1ToV2,
};

/** Doprowadza dowolny obsługiwany zapis do bieżącej wersji (SAVE_VERSION). */
export function migrateSave(raw: unknown): GameData {
  if (!isRecord(raw)) throw new Error('Uszkodzony zapis.');
  let data: AnyRecord = { ...raw };
  let version = typeof data.version === 'number' && data.version > 0 ? data.version : 1;
  if (version > SAVE_VERSION) throw new Error('Zapis pochodzi z nowszej wersji gry.');
  while (version < SAVE_VERSION) {
    const step = STEPS[version];
    if (!step) throw new Error(`Brak migracji zapisu z wersji ${version}.`);
    data = step(data);
    version = data.version as number;
  }
  // Zapis v2 z niepełnym położeniem (np. ręcznie edytowany) — uzupełnienie lokacją startową.
  const player = (isRecord(data.player) ? data.player : {}) as Partial<PlayerState>;
  if (!getLocation(player.locationId)) {
    const loc = startLocation();
    data.player = { ...player, regionId: loc.regionId, locationId: loc.id, spawnPointId: DEFAULT_SPAWN_POINT_ID };
  }
  return { ...data, version: SAVE_VERSION } as unknown as GameData;
}
