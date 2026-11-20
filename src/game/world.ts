// Logika modelu świata (bez Phasera): wyszukiwanie lokacji, punkty pojawienia się, wyzwalacze połączeń,
// wymagania, decyzja o przejściu, bezpieczny punkt wejścia (ochrona przed softlockiem) i walidacja danych.

import { ENCOUNTER_TABLES, TERRAIN_METHOD, type EncounterTable } from '../config/encounters';
import { ITEMS } from '../config/items';
import {
  DEFAULT_SPAWN_POINT_ID,
  LOCATION_STATUSES,
  LOCATION_TYPES,
  WORLD,
  type LocationConnection,
  type LocationDef,
  type RegionDef,
  type Requirements,
  type SpawnPoint,
  type WorldDef,
} from '../config/world';
import type { Dir } from '../engine/types';
import { MAPS } from './maps';
import type { MapDef } from './maps/testMap';
import { isWalkable } from './movement';

/** Położenie gracza w świecie (zapisywane w grze). */
export interface WorldPosition {
  regionId: string;
  locationId: string;
  spawnPointId: string;
  x: number;
  y: number;
  facing: Dir;
}

/** Postęp gracza potrzebny do sprawdzania wymagań. */
export interface ProgressState {
  flags: Readonly<Record<string, boolean>>;
  bag: Readonly<Partial<Record<string, number>>>;
}

export function getRegion(id: string, world: WorldDef = WORLD): RegionDef | null {
  return world.regions.find((r) => r.id === id) ?? null;
}

export function getLocation(id: string | undefined | null, world: WorldDef = WORLD): LocationDef | null {
  if (!id) return null;
  return world.locations.find((l) => l.id === id) ?? null;
}

/** Lokacja wyświetlająca daną mapę (np. do migracji starych zapisów z `mapId`). */
export function locationForMap(mapId: string, world: WorldDef = WORLD): LocationDef | null {
  return world.locations.find((l) => l.mapReference === mapId) ?? null;
}

export function startLocation(world: WorldDef = WORLD): LocationDef {
  const region = getRegion(world.startRegionId, world);
  const loc = getLocation(region?.startLocationId, world);
  if (!loc) throw new Error('Brak lokacji startowej w modelu świata.');
  return loc;
}

export function spawnPointOf(location: LocationDef, spawnPointId: string): SpawnPoint | null {
  return location.spawnPoints.find((s) => s.id === spawnPointId) ?? null;
}

export function mapOf(location: LocationDef, maps: Readonly<Record<string, MapDef>> = MAPS): MapDef | null {
  return location.mapReference ? (maps[location.mapReference] ?? null) : null;
}

export function positionAt(location: LocationDef, spawn: SpawnPoint): WorldPosition {
  return { regionId: location.regionId, locationId: location.id, spawnPointId: spawn.id, x: spawn.x, y: spawn.y, facing: spawn.facing };
}

/** Pozycja startowa nowej gry. */
export function startPosition(world: WorldDef = WORLD): WorldPosition {
  const loc = startLocation(world);
  const spawn = spawnPointOf(loc, DEFAULT_SPAWN_POINT_ID);
  if (!spawn) throw new Error(`Lokacja startowa „${loc.id}” nie ma punktu „${DEFAULT_SPAWN_POINT_ID}”.`);
  return positionAt(loc, spawn);
}

function triggerContains(c: LocationConnection, x: number, y: number): boolean {
  const t = c.sourceTrigger;
  return x >= t.x && x < t.x + (t.w ?? 1) && y >= t.y && y < t.y + (t.h ?? 1);
}

/** Połączenie, którego wyzwalacz leży na polu (x, y) danej lokacji. */
export function connectionAt(location: LocationDef, x: number, y: number): LocationConnection | null {
  return location.connections.find((c) => triggerContains(c, x, y)) ?? null;
}

export function requirementsMet(req: Requirements | undefined, state: ProgressState): boolean {
  if (!req) return true;
  if (req.badges?.some((b) => !state.flags[`badge:${b}`])) return false;
  if (req.items?.some((i) => !((state.bag[i] ?? 0) > 0))) return false;
  if (req.events?.some((e) => !state.flags[e])) return false;
  return true;
}

export type TravelCheck =
  | { ok: true; position: WorldPosition; destination: LocationDef }
  | { ok: false; reason: 'missing-destination' | 'not-implemented' | 'requirements' | 'missing-spawn' | 'region-locked'; message: string[] };

/** Czy połączenie można użyć: istnieje grywalna lokacja docelowa z punktem pojawienia się, a wymagania są spełnione. */
export function checkTravel(conn: LocationConnection, state: ProgressState, world: WorldDef = WORLD): TravelCheck {
  const dest = getLocation(conn.destinationLocationId, world);
  if (!dest) return { ok: false, reason: 'missing-destination', message: conn.blockedMessage };
  if (dest.status !== 'IMPLEMENTED' || !dest.mapReference) return { ok: false, reason: 'not-implemented', message: conn.blockedMessage };
  const source = getLocation(conn.sourceLocationId, world);
  if (source && source.regionId !== dest.regionId) {
    const region = getRegion(dest.regionId, world);
    if (!region || region.status !== 'IMPLEMENTED' || !requirementsMet(region.unlockRequirements, state)) {
      return { ok: false, reason: 'region-locked', message: conn.blockedMessage };
    }
  }
  const destReq: Requirements = { badges: dest.requiredBadges, items: dest.requiredItems, events: dest.requiredEvents };
  if (!requirementsMet(conn.requirements, state) || !requirementsMet(destReq, state)) {
    return { ok: false, reason: 'requirements', message: conn.blockedMessage };
  }
  const spawn = spawnPointOf(dest, conn.destinationSpawnPoint);
  if (!spawn) return { ok: false, reason: 'missing-spawn', message: conn.blockedMessage };
  return { ok: true, position: positionAt(dest, spawn), destination: dest };
}

/** Punkt leczenia lokacji (po przegranej) — z awaryjnym powrotem do startu gry. */
export function healingTarget(locationId: string, world: WorldDef = WORLD): WorldPosition {
  const loc = getLocation(locationId, world);
  const hp = loc?.healingPoint;
  const target = hp ? getLocation(hp.locationId, world) : null;
  const spawn = target && hp ? spawnPointOf(target, hp.spawnPointId) : null;
  if (target && spawn && target.status === 'IMPLEMENTED') return positionAt(target, spawn);
  return startPosition(world);
}

/**
 * Bezpieczny punkt wejścia przy wczytaniu gry: zapisana lokacja musi istnieć i być grywalna, a pozycja —
 * mieścić się na mapie, być dostępna i nie leżeć na wyzwalaczu przejścia. Inaczej: punkt pojawienia się
 * z zapisu, potem domyślny punkt lokacji, a na końcu start gry. Dzięki temu nie da się utknąć.
 */
export function resolveSafeEntry(
  player: Partial<Pick<WorldPosition, 'regionId' | 'locationId' | 'spawnPointId' | 'x' | 'y' | 'facing'>>,
  world: WorldDef = WORLD,
  maps: Readonly<Record<string, MapDef>> = MAPS,
): WorldPosition {
  const loc = getLocation(player.locationId, world);
  const map = loc && loc.status === 'IMPLEMENTED' ? mapOf(loc, maps) : null;
  if (!loc || !map) return startPosition(world);
  const grid = map.layout.map((r) => r.split(''));
  const usable = (x: number, y: number) => isWalkable(grid, x, y) && !connectionAt(loc, x, y);
  const spawnId = spawnPointOf(loc, player.spawnPointId ?? '') ? player.spawnPointId! : DEFAULT_SPAWN_POINT_ID;
  if (typeof player.x === 'number' && typeof player.y === 'number' && usable(player.x, player.y)) {
    return { regionId: loc.regionId, locationId: loc.id, spawnPointId: spawnId, x: player.x, y: player.y, facing: player.facing ?? 'down' };
  }
  for (const id of [player.spawnPointId, DEFAULT_SPAWN_POINT_ID]) {
    const sp = id ? spawnPointOf(loc, id) : null;
    if (sp && usable(sp.x, sp.y)) return positionAt(loc, sp);
  }
  return startPosition(world);
}

// ───────────────────────────── walidacja ─────────────────────────────

export type WorldIssueCode =
  | 'DUPLICATE_ID'
  | 'MISSING_LOCATION'
  | 'MISSING_REGION'
  | 'MISSING_MAP'
  | 'MISSING_SPAWN_POINT'
  | 'INVALID_SPAWN_POINT'
  | 'INVALID_CONNECTION'
  | 'MISSING_ENCOUNTER_TABLE'
  | 'INVALID_ENCOUNTER_SETUP'
  | 'INVALID_VALUE'
  | 'UNREACHABLE';

export interface WorldIssue {
  code: WorldIssueCode;
  ref: string;
  message: string;
}

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) (seen.has(id) ? dup : seen).add(id);
  return [...dup];
}

function mapGrid(map: MapDef): string[][] {
  return map.layout.map((r) => r.split(''));
}

/**
 * Sprawdza spójność świata: duplikaty identyfikatorów, brakujące lokacje/regiony/mapy/punkty pojawienia się/tabele,
 * błędne połączenia (wyzwalacz poza mapą lub na przeszkodzie, punkt docelowy na wyzwalaczu, brak drogi powrotnej)
 * i dostępność wszystkich grywalnych lokacji z lokacji startowej.
 */
export function validateWorld(
  world: WorldDef = WORLD,
  maps: Readonly<Record<string, MapDef>> = MAPS,
  tables: Readonly<Record<string, EncounterTable>> = ENCOUNTER_TABLES,
): WorldIssue[] {
  const issues: WorldIssue[] = [];
  const add = (code: WorldIssueCode, ref: string, message: string) => issues.push({ code, ref, message });

  for (const id of duplicates(world.regions.map((r) => r.id))) add('DUPLICATE_ID', id, `Zdublowany region „${id}”.`);
  for (const id of duplicates(world.locations.map((l) => l.id))) add('DUPLICATE_ID', id, `Zdublowana lokacja „${id}”.`);
  const allConnections = world.locations.flatMap((l) => l.connections);
  for (const id of duplicates(allConnections.map((c) => c.id))) add('DUPLICATE_ID', id, `Zdublowane połączenie „${id}”.`);
  const zoneIds = world.locations.flatMap((l) => {
    const m = mapOf(l, maps);
    return m ? m.zones.map((z) => z.id) : [];
  });
  for (const id of duplicates(zoneIds)) add('DUPLICATE_ID', id, `Zdublowana strefa spotkań „${id}”.`);

  if (!getRegion(world.startRegionId, world)) add('MISSING_REGION', world.startRegionId, 'Brak regionu startowego.');

  for (const r of world.regions) {
    if (!LOCATION_STATUSES.includes(r.status)) add('INVALID_VALUE', r.id, `Nieznany status regionu „${r.status}”.`);
    if (!r.locationIds.includes(r.startLocationId)) add('MISSING_LOCATION', r.id, `Lokacja startowa „${r.startLocationId}” nie należy do regionu.`);
    for (const lid of r.locationIds) {
      const l = getLocation(lid, world);
      if (!l) add('MISSING_LOCATION', `${r.id}→${lid}`, `Region wskazuje nieistniejącą lokację „${lid}”.`);
      else if (l.regionId !== r.id) add('INVALID_VALUE', lid, `Lokacja „${lid}” należy do innego regionu („${l.regionId}”).`);
    }
    const start = getLocation(r.startLocationId, world);
    if (r.status === 'IMPLEMENTED' && start && start.status !== 'IMPLEMENTED') {
      add('INVALID_VALUE', r.id, 'Lokacja startowa grywalnego regionu musi być grywalna.');
    }
  }

  // Tabela należy do jednej lokacji (różne spotkania w różnych miejscach).
  const tableOwners = new Map<string, string>();

  for (const l of world.locations) {
    if (!getRegion(l.regionId, world)) add('MISSING_REGION', l.id, `Lokacja wskazuje nieistniejący region „${l.regionId}”.`);
    if (!getRegion(l.regionId, world)?.locationIds.includes(l.id)) add('INVALID_VALUE', l.id, 'Lokacja nie jest wymieniona w swoim regionie.');
    if (!LOCATION_STATUSES.includes(l.status)) add('INVALID_VALUE', l.id, `Nieznany status „${l.status}”.`);
    if (!LOCATION_TYPES.includes(l.type)) add('INVALID_VALUE', l.id, `Nieznany typ „${l.type}”.`);
    for (const id of duplicates(l.spawnPoints.map((s) => s.id))) add('DUPLICATE_ID', `${l.id}:${id}`, `Zdublowany punkt pojawienia się „${id}”.`);
    for (const item of l.requiredItems) if (!(item in ITEMS)) add('INVALID_VALUE', l.id, `Nieznany wymagany przedmiot „${item}”.`);

    for (const tid of l.encounterTableIds) {
      if (!tables[tid]) add('MISSING_ENCOUNTER_TABLE', `${l.id}:${tid}`, `Brak tabeli spotkań „${tid}”.`);
      const owner = tableOwners.get(tid);
      if (owner && owner !== l.id) add('INVALID_ENCOUNTER_SETUP', tid, `Tabela „${tid}” jest przypisana do „${owner}” i „${l.id}”.`);
      tableOwners.set(tid, l.id);
    }

    if (l.healingPoint) {
      const hl = getLocation(l.healingPoint.locationId, world);
      if (!hl) add('MISSING_LOCATION', `${l.id}:healingPoint`, `Punkt leczenia w nieistniejącej lokacji „${l.healingPoint.locationId}”.`);
      else if (!spawnPointOf(hl, l.healingPoint.spawnPointId)) add('MISSING_SPAWN_POINT', `${l.id}:healingPoint`, `Brak punktu leczenia „${l.healingPoint.spawnPointId}” w „${hl.id}”.`);
    }

    if (l.status !== 'IMPLEMENTED') continue;

    // Grywalna lokacja: mapa, punkty pojawienia się, strefy i tabele.
    const map = mapOf(l, maps);
    if (!map) {
      add('MISSING_MAP', l.id, `Brak mapy „${l.mapReference}”.`);
      continue;
    }
    if (!l.healingPoint) add('MISSING_SPAWN_POINT', `${l.id}:healingPoint`, 'Grywalna lokacja musi mieć punkt leczenia.');
    const grid = mapGrid(map);
    const width = grid[0]?.length ?? 0;
    if (grid.some((row) => row.length !== width)) add('INVALID_VALUE', map.id, 'Mapa nie jest prostokątna.');
    if (!spawnPointOf(l, DEFAULT_SPAWN_POINT_ID)) add('MISSING_SPAWN_POINT', `${l.id}:${DEFAULT_SPAWN_POINT_ID}`, 'Brak domyślnego punktu pojawienia się.');
    for (const sp of l.spawnPoints) {
      if (!isWalkable(grid, sp.x, sp.y)) add('INVALID_SPAWN_POINT', `${l.id}:${sp.id}`, `Punkt (${sp.x},${sp.y}) jest poza mapą lub na przeszkodzie.`);
      if (connectionAt(l, sp.x, sp.y)) add('INVALID_SPAWN_POINT', `${l.id}:${sp.id}`, 'Punkt pojawienia się leży na wyzwalaczu przejścia.');
    }
    for (const z of map.zones) {
      if (z.locationId !== l.id) add('INVALID_ENCOUNTER_SETUP', z.id, `Strefa należy do „${z.locationId}”, a mapa do „${l.id}”.`);
      if (!tables[z.encounterTableId]) add('MISSING_ENCOUNTER_TABLE', z.id, `Brak tabeli spotkań „${z.encounterTableId}”.`);
      else if (!l.encounterTableIds.includes(z.encounterTableId)) add('INVALID_ENCOUNTER_SETUP', z.id, `Tabela „${z.encounterTableId}” nie jest przypisana do lokacji.`);
      const method = TERRAIN_METHOD[z.terrainType];
      if (method && !l.availableEncounterMethods.includes(method)) add('INVALID_ENCOUNTER_SETUP', z.id, `Metoda „${method}” nie jest dostępna w lokacji.`);
    }
    for (const s of map.staticEncounters) {
      if (!tables[s.encounterTableId]) add('MISSING_ENCOUNTER_TABLE', s.id, `Brak tabeli spotkań „${s.encounterTableId}”.`);
      else if (!l.encounterTableIds.includes(s.encounterTableId)) add('INVALID_ENCOUNTER_SETUP', s.id, `Tabela „${s.encounterTableId}” nie jest przypisana do lokacji.`);
    }

    for (const c of l.connections) {
      const ref = `${l.id}:${c.id}`;
      if (c.sourceLocationId !== l.id) add('INVALID_CONNECTION', ref, `Źródło połączenia („${c.sourceLocationId}”) nie jest lokacją, w której je zdefiniowano.`);
      const t = c.sourceTrigger;
      for (let y = t.y; y < t.y + (t.h ?? 1); y++)
        for (let x = t.x; x < t.x + (t.w ?? 1); x++)
          if (!isWalkable(grid, x, y)) add('INVALID_CONNECTION', ref, `Wyzwalacz (${x},${y}) jest poza mapą lub na przeszkodzie.`);
      if (!c.blockedMessage.length) add('INVALID_CONNECTION', ref, 'Brak komunikatu o zablokowanym przejściu.');
      const dest = getLocation(c.destinationLocationId, world);
      if (!dest) {
        add('MISSING_LOCATION', ref, `Połączenie prowadzi do nieistniejącej lokacji „${c.destinationLocationId}”.`);
        continue;
      }
      if (dest.id === l.id) add('INVALID_CONNECTION', ref, 'Połączenie prowadzi do tej samej lokacji.');
      const sp = spawnPointOf(dest, c.destinationSpawnPoint);
      if (!sp) {
        add('MISSING_SPAWN_POINT', ref, `Brak punktu „${c.destinationSpawnPoint}” w „${dest.id}”.`);
        continue;
      }
      if (dest.status !== 'IMPLEMENTED') continue; // przejście zablokowane z komunikatem — mapa jeszcze nie istnieje
      const destMap = mapOf(dest, maps);
      if (!destMap) continue; // zgłoszone przy lokacji docelowej
      const back = dest.connections.find((b) => b.destinationLocationId === l.id);
      if (!back) add('INVALID_CONNECTION', ref, `Brak drogi powrotnej z „${dest.id}” do „${l.id}”.`);
    }
  }

  // Każda grywalna lokacja osiągalna z lokacji startowej (połączenia bez wymagań).
  const start = getLocation(getRegion(world.startRegionId, world)?.startLocationId, world);
  if (start) {
    const reached = new Set<string>([start.id]);
    const queue = [start.id];
    while (queue.length) {
      const cur = getLocation(queue.shift(), world);
      for (const c of cur?.connections ?? []) {
        const d = getLocation(c.destinationLocationId, world);
        if (!d || d.status !== 'IMPLEMENTED' || reached.has(d.id) || !requirementsMet(c.requirements, { flags: {}, bag: {} })) continue;
        reached.add(d.id);
        queue.push(d.id);
      }
    }
    for (const l of world.locations) {
      if (l.status === 'IMPLEMENTED' && !reached.has(l.id)) add('UNREACHABLE', l.id, 'Lokacja nieosiągalna z lokacji startowej.');
    }
  }
  return issues;
}
