// Migracje zapisów gry między wersjami formatu (czyste funkcje — testowane jednostkowo).
// v1 → v2 (Sprint 3): `player.mapId` zastąpione położeniem w modelu świata (regionId, locationId, spawnPointId);
// pozycja x/y zostaje zachowana jako bezpieczny punkt wejścia (sprawdzany przy wczytaniu przez resolveSafeEntry).
// v2 → v3 (Sprint 4): stworzenia dostają `nature`, `abilityId` (dawniej `ability`), `heldItemId` (dawniej
// `heldItem`) i `evolutionState`. Natura starych stworzeń jest neutralna (stała, wyliczona z uid), więc ich
// zapisane statystyki się nie zmieniają.
// v3 → v4 (Sprint 6): postęp Prób Szlaku — earnedBadges, completedChallenges, unlockedConnections. Dawne flagi
// `badge:<id>` (wymagania z Sprintu 3) stają się zdobytymi odznakami; wydarzenia ukończenia Prób — ukończonymi
// Próbami; odblokowania wynikają z odznak. Flagi zostają nietknięte.

import { HELD_ITEM_IDS } from '../config/items';
import { isNatureId, neutralNatureFor } from '../config/natures';
import { DEFAULT_SPAWN_POINT_ID } from '../config/world';
import { getBadge, normalizeProgression } from '../game/challenges';
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

/** Uzupełnia pola stworzenia wprowadzone w v3 (idempotentne — bezpieczne także dla danych już w v3). */
export function upgradeCreatureV3(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const c: AnyRecord = { ...raw };
  const uid = typeof c.uid === 'string' ? c.uid : '';
  c.nature = isNatureId(c.nature) ? c.nature : neutralNatureFor(uid);
  const ability = typeof c.abilityId === 'string' ? c.abilityId : typeof c.ability === 'string' ? c.ability : 'brak';
  c.abilityId = ability;
  delete c.ability;
  const held = c.heldItemId !== undefined ? c.heldItemId : c.heldItem;
  c.heldItemId = typeof held === 'string' && (HELD_ITEM_IDS as readonly string[]).includes(held) ? held : null;
  delete c.heldItem;
  const evo = isRecord(c.evolutionState) ? c.evolutionState : {};
  c.evolutionState = {
    cancelledAtLevel: typeof evo.cancelledAtLevel === 'number' ? evo.cancelledAtLevel : null,
    evolvedFrom: typeof evo.evolvedFrom === 'string' ? evo.evolvedFrom : null,
  };
  return c;
}

/** v2 → v3: nowe pola stworzeń w drużynie i magazynie. */
function v2ToV3(data: AnyRecord): AnyRecord {
  const list = (v: unknown) => (Array.isArray(v) ? v.map(upgradeCreatureV3) : []);
  return { ...data, party: list(data.party), storage: list(data.storage), version: 3 };
}

/** v3 → v4: listy postępu Prób (puste dla zwykłego zapisu v3). */
function v3ToV4(data: AnyRecord): AnyRecord {
  const flags = isRecord(data.flags) ? data.flags : {};
  const legacyBadges = Object.keys(flags)
    .filter((k) => k.startsWith('badge:') && flags[k] === true)
    .map((k) => k.slice('badge:'.length))
    .filter((id) => !!getBadge(id));
  return { ...data, earnedBadges: legacyBadges, completedChallenges: [], unlockedConnections: [], version: 4 };
}

const STEPS: Record<number, (d: AnyRecord) => AnyRecord> = {
  1: v1ToV2,
  2: v2ToV3,
  3: v3ToV4,
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
  // Stworzenia zawsze z kompletem pól v3 (idempotentne — np. dla ręcznie edytowanego zapisu).
  data.party = Array.isArray(data.party) ? data.party.map(upgradeCreatureV3) : [];
  data.storage = Array.isArray(data.storage) ? data.storage.map(upgradeCreatureV3) : [];
  // Postęp Prób zawsze spójny (idempotentne): ukończona Próba ⇒ odznaka ⇒ odblokowane przejścia.
  Object.assign(data, normalizeProgression(data));
  // Zapis z niepełnym położeniem (np. ręcznie edytowany) — uzupełnienie lokacją startową.
  const player = (isRecord(data.player) ? data.player : {}) as Partial<PlayerState>;
  if (!getLocation(player.locationId)) {
    const loc = startLocation();
    data.player = { ...player, regionId: loc.regionId, locationId: loc.id, spawnPointId: DEFAULT_SPAWN_POINT_ID };
  }
  return { ...data, version: SAVE_VERSION } as unknown as GameData;
}
