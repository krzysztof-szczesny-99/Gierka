// Ukryte lokacje (Sprint 7): ukryte wejście w lokacji nadrzędnej, wymagania wejścia (odznaki, przedmioty,
// wydarzenia, ukończone Próby, odkryte ukryte przejścia — także kilka naraz), odkrycie (wydarzenie i nagroda raz)
// oraz walidacja danych. Czyste funkcje — stan zmienia gameStore.discoverHiddenLocation, a przejście — scena mapy.

import { BADGES, CHALLENGES } from '../config/challenges';
import { HIDDEN_LOCATIONS, type HiddenLocationDef } from '../config/hiddenLocations';
import { ITEMS, type ItemId } from '../config/items';
import { SPECIAL_ENCOUNTERS } from '../config/specialEncounters';
import { WORLD, type Requirements, type WorldDef } from '../config/world';
import { eventLabel } from './challenges';
import { MAPS } from './maps';
import type { MapDef } from './maps/testMap';
import { DIRS, isWalkable } from './movement';
import { knownEvents } from './specialEncounters';
import { connectionAt, getLocation, isDiscoveredLocation, mapOf, positionAt, requirementsMet, spawnPointOf, type ProgressState, type WorldPosition } from './world';

export function getHiddenLocation(id: string | null | undefined, list: readonly HiddenLocationDef[] = HIDDEN_LOCATIONS): HiddenLocationDef | undefined {
  return id ? list.find((h) => h.id === id) : undefined;
}

/** Ukryte wejście danego rodzaju na polu (x, y) lokacji nadrzędnej (tylko wdrożone ukryte lokacje). */
export function hiddenEntranceAt(
  locationId: string,
  x: number,
  y: number,
  kind: 'interact' | 'tile',
  list: readonly HiddenLocationDef[] = HIDDEN_LOCATIONS,
): HiddenLocationDef | null {
  return (
    list.find((h) => h.status === 'IMPLEMENTED' && h.parentLocationId === locationId && h.entranceTrigger.kind === kind && h.entranceTrigger.x === x && h.entranceTrigger.y === y) ?? null
  );
}

export function isDiscovered(h: HiddenLocationDef, flags: Readonly<Record<string, boolean>>): boolean {
  return !!flags[h.discoveryEventId];
}

/** Odkryte ukryte lokacje z danej lokacji nadrzędnej, których wejście ma być widoczne na mapie. */
export function visibleEntrances(parentLocationId: string, flags: Readonly<Record<string, boolean>>, list: readonly HiddenLocationDef[] = HIDDEN_LOCATIONS): HiddenLocationDef[] {
  return list.filter((h) => h.status === 'IMPLEMENTED' && h.parentLocationId === parentLocationId && h.visibleAfterDiscovery && isDiscovered(h, flags));
}

/** Czytelna lista niespełnionych wymagań (komunikat przy zablokowanym wejściu, testy). */
export function missingEntryRequirements(req: Requirements, p: ProgressState): string[] {
  const out: string[] = [];
  for (const b of req.badges ?? []) if (!(p.earnedBadges ?? []).includes(b)) out.push(`odznaka: ${BADGES.find((x) => x.id === b)?.name ?? b}`);
  for (const i of req.items ?? []) if (!((p.bag[i] ?? 0) > 0)) out.push(`przedmiot: ${ITEMS[i as ItemId]?.name ?? i}`);
  for (const e of req.events ?? []) if (!p.flags[e]) out.push(eventDescription(e));
  for (const c of req.challenges ?? []) if (!(p.completedChallenges ?? []).includes(c)) out.push(`ukończ: ${CHALLENGES.find((x) => x.id === c)?.name ?? c}`);
  for (const d of req.discoveries ?? []) if (!isDiscoveredLocation(d, p.flags)) out.push(`odkryj: ${getLocation(d)?.name ?? d}`);
  return out;
}

/** Opis wydarzenia: trener, Próba, spotkanie specjalne albo odkrycie. */
export function eventDescription(eventId: string): string {
  const special = SPECIAL_ENCOUNTERS.find((s) => s.completionEventId === eventId);
  if (special) return `${special.name} (złapany lub pokonany)`;
  const hidden = HIDDEN_LOCATIONS.find((h) => h.discoveryEventId === eventId);
  if (hidden) return `odkryj: ${getLocation(hidden.id)?.name ?? hidden.id}`;
  return eventLabel(eventId);
}

export type HiddenEntryCheck =
  | { ok: true; position: WorldPosition; firstDiscovery: boolean }
  | { ok: false; reason: 'not-implemented' | 'requirements' | 'missing-spawn'; missing: string[]; message: string[] };

/** Czy gracz może wejść do ukrytej lokacji (i czy będzie to odkrycie). */
export function hiddenEntryCheck(h: HiddenLocationDef, p: ProgressState, world: WorldDef = WORLD): HiddenEntryCheck {
  const loc = getLocation(h.id, world);
  if (h.status !== 'IMPLEMENTED' || !loc || loc.status !== 'IMPLEMENTED') return { ok: false, reason: 'not-implemented', missing: [], message: h.lockedMessage };
  if (!requirementsMet(h.entryRequirements, p)) {
    const missing = missingEntryRequirements(h.entryRequirements, p);
    return { ok: false, reason: 'requirements', missing, message: [...h.lockedMessage, `Wymagania: ${missing.join('; ')}.`] };
  }
  const spawn = spawnPointOf(loc, h.entranceTrigger.destinationSpawnPoint);
  if (!spawn) return { ok: false, reason: 'missing-spawn', missing: [], message: h.lockedMessage };
  return { ok: true, position: positionAt(loc, spawn), firstDiscovery: !isDiscovered(h, p.flags) };
}

/** Nagroda za odkrycie (znane przedmioty o dodatniej liczbie). */
export function discoveryRewardItems(h: HiddenLocationDef): [ItemId, number][] {
  return (Object.entries(h.rewards.items ?? {}) as [ItemId, number][]).filter(([id, n]) => id in ITEMS && n > 0);
}

// ───────────────────────────── walidacja danych ─────────────────────────────

export interface HiddenIssue {
  code: 'DUPLICATE_ID' | 'DUPLICATE_EVENT' | 'MISSING_LOCATION' | 'NOT_HIDDEN' | 'INVALID_ENTRANCE' | 'INVALID_REQUIREMENT' | 'INVALID_VALUE' | 'MISSING_EXIT';
  ref: string;
  message: string;
}

/** Spójność ukrytych lokacji z modelem świata, mapami, spotkaniami specjalnymi i wymaganiami. */
export function validateHiddenLocations(
  list: readonly HiddenLocationDef[] = HIDDEN_LOCATIONS,
  world: WorldDef = WORLD,
  maps: Readonly<Record<string, MapDef>> = MAPS,
): HiddenIssue[] {
  const issues: HiddenIssue[] = [];
  const add = (code: HiddenIssue['code'], ref: string, message: string) => issues.push({ code, ref, message });
  const ids = new Set<string>();
  const events = new Set<string>();
  const known = knownEvents();
  for (const h of list) {
    if (ids.has(h.id)) add('DUPLICATE_ID', h.id, `Powtórzona ukryta lokacja: ${h.id}`);
    ids.add(h.id);
    if (!h.discoveryEventId || events.has(h.discoveryEventId)) add('DUPLICATE_EVENT', h.id, `Pusty lub powtórzony discoveryEventId: ${h.discoveryEventId}`);
    events.add(h.discoveryEventId);
    if (!h.lockedMessage.length || !h.discoveryMessage.length) add('INVALID_VALUE', h.id, 'Brak komunikatu o zablokowanym wejściu lub odkryciu');
    if (!(h.rewards.money >= 0)) add('INVALID_VALUE', h.id, 'Nagroda pieniężna nie może być ujemna');
    for (const [item, n] of Object.entries(h.rewards.items ?? {})) if (!(item in ITEMS) || !(Number(n) > 0)) add('INVALID_VALUE', h.id, `Nieprawidłowa nagroda: ${item} ×${String(n)}`);

    const r = h.entryRequirements;
    for (const b of r.badges ?? []) if (!BADGES.some((x) => x.id === b)) add('INVALID_REQUIREMENT', h.id, `Nieznana odznaka: ${b}`);
    for (const i of r.items ?? []) if (!(i in ITEMS)) add('INVALID_REQUIREMENT', h.id, `Nieznany przedmiot: ${i}`);
    for (const e of r.events ?? []) if (!known.has(e)) add('INVALID_REQUIREMENT', h.id, `Nieznane wydarzenie: ${e}`);
    for (const c of r.challenges ?? []) if (!CHALLENGES.some((x) => x.id === c)) add('INVALID_REQUIREMENT', h.id, `Nieznana Próba: ${c}`);
    for (const d of r.discoveries ?? []) {
      if (!list.some((x) => x.id === d)) add('INVALID_REQUIREMENT', h.id, `Nieznane ukryte przejście: ${d}`);
      if (d === h.id) add('INVALID_REQUIREMENT', h.id, 'Lokacja nie może wymagać własnego odkrycia');
    }

    for (const sid of h.specialEncounterIds) {
      const s = SPECIAL_ENCOUNTERS.find((x) => x.id === sid);
      if (!s) add('INVALID_VALUE', h.id, `Nieznane spotkanie specjalne: ${sid}`);
      else if (s.locationId !== h.id) add('INVALID_VALUE', h.id, `Spotkanie ${sid} stoi w innej lokacji (${s.locationId})`);
    }

    const loc = getLocation(h.id, world);
    if (!loc) {
      add('MISSING_LOCATION', h.id, 'Ukryta lokacja nie istnieje w modelu świata');
      continue;
    }
    if (!loc.hidden) add('NOT_HIDDEN', h.id, 'Lokacja w modelu świata musi mieć hidden: true');
    if (loc.regionId !== h.regionId) add('INVALID_VALUE', h.id, `Inny region niż w modelu świata (${loc.regionId})`);
    if (loc.mapReference !== h.mapReference) add('INVALID_VALUE', h.id, `Inna mapa niż w modelu świata (${loc.mapReference})`);
    if (h.status === 'IMPLEMENTED' && loc.status !== 'IMPLEMENTED') add('INVALID_VALUE', h.id, 'Wdrożona ukryta lokacja musi być grywalna');
    if (!spawnPointOf(loc, h.entranceTrigger.destinationSpawnPoint)) add('INVALID_ENTRANCE', h.id, `Brak punktu „${h.entranceTrigger.destinationSpawnPoint}” w ukrytej lokacji`);
    if (h.status === 'IMPLEMENTED' && !loc.connections.some((c) => c.destinationLocationId === h.parentLocationId)) add('MISSING_EXIT', h.id, 'Brak wyjścia z ukrytej lokacji do lokacji nadrzędnej');

    const parent = getLocation(h.parentLocationId, world);
    const pmap = parent ? mapOf(parent, maps) : null;
    if (!parent || !pmap) {
      add('MISSING_LOCATION', h.id, `Nieznana lub niegrywalna lokacja nadrzędna: ${h.parentLocationId}`);
      continue;
    }
    if (parent.id === h.id) add('INVALID_ENTRANCE', h.id, 'Lokacja nie może być swoją lokacją nadrzędną');
    const grid = pmap.layout.map((row) => row.split(''));
    const { x, y, kind } = h.entranceTrigger;
    const inside = y >= 0 && y < grid.length && x >= 0 && x < (grid[0]?.length ?? 0);
    if (!inside) add('INVALID_ENTRANCE', h.id, `Wejście (${x},${y}) poza mapą lokacji nadrzędnej`);
    else if (kind === 'tile' && (!isWalkable(grid, x, y) || connectionAt(parent, x, y))) add('INVALID_ENTRANCE', h.id, `Pole wejścia (${x},${y}) musi być dostępne i nie może być wyjściem`);
    else if (kind === 'interact') {
      const reachable = Object.values(DIRS).some((d) => isWalkable(grid, x + d.x, y + d.y) && !connectionAt(parent, x + d.x, y + d.y));
      if (!reachable) add('INVALID_ENTRANCE', h.id, `Do badanego pola (${x},${y}) nie da się podejść`);
    }
    if (pmap.signs[`${x},${y}`] || pmap.doors[`${x},${y}`]) add('INVALID_ENTRANCE', h.id, `Pole wejścia (${x},${y}) jest tabliczką lub drzwiami`);
  }
  return issues;
}
