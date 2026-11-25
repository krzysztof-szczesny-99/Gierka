// Trenerzy na mapie (Sprint 5): pole widzenia, podejście do gracza, wydarzenia, rozmowa i walidacja danych.
// Czyste funkcje — scena mapy (OverworldScene) dostarcza informacji o przeszkodach.

import { LEADER_TRAINERS } from '../config/challenges';
import { isHeldItemId, ITEMS } from '../config/items';
import { isNatureId } from '../config/natures';
import { TRAINERS, type TrainerDef } from '../config/trainers';
import { WORLD, type WorldDef } from '../config/world';
import { isAiProfile } from '../engine/battle/ai';
import type { Dir } from '../engine/types';
import { MAPS } from './maps';
import type { MapDef } from './maps/testMap';
import { DIRS, isWalkable } from './movement';
import { connectionAt, getLocation, mapOf } from './world';

export interface Point {
  x: number;
  y: number;
}

/** Wszystkie postacie-trenerzy na mapach: trenerzy (Sprint 5) i liderzy Prób (Sprint 6). */
export const MAP_TRAINERS: readonly TrainerDef[] = [...TRAINERS, ...LEADER_TRAINERS];

/** Trenerzy w lokacji. */
export function trainersIn(locationId: string, list: readonly TrainerDef[] = MAP_TRAINERS): TrainerDef[] {
  return list.filter((t) => t.locationId === locationId);
}

export function getTrainer(id: string, list: readonly TrainerDef[] = MAP_TRAINERS): TrainerDef | undefined {
  return list.find((t) => t.id === id);
}

export function isDefeated(t: TrainerDef, flags: Record<string, boolean>): boolean {
  return !!flags[t.defeatedEventId];
}

/** Rozmowa z trenerem: walka (jeszcze niepokonany), rewanż albo zwykły dialog po walce. */
export type TalkKind = 'battle' | 'rematch' | 'after';

export function talkKind(t: TrainerDef, flags: Record<string, boolean>): TalkKind {
  if (!isDefeated(t, flags)) return 'battle';
  return t.repeatPolicy === 'REMATCH' ? 'rematch' : 'after';
}

/** Wzrok i wydarzenia wyzwalają walkę tylko z niepokonanym trenerem. */
export function canChallenge(t: TrainerDef, flags: Record<string, boolean>): boolean {
  return !isDefeated(t, flags);
}

/**
 * Pola w polu widzenia: linia w kierunku patrzenia, do zasięgu albo do pierwszej przeszkody
 * (`isOpen` — pole przezroczyste dla wzroku: dostępne i bez innej postaci).
 */
export function sightLine(from: Point, dir: Dir, range: number, isOpen: (x: number, y: number) => boolean): Point[] {
  const out: Point[] = [];
  const d = DIRS[dir];
  for (let i = 1; i <= range; i++) {
    const p = { x: from.x + d.x * i, y: from.y + d.y * i };
    if (!isOpen(p.x, p.y)) break;
    out.push(p);
  }
  return out;
}

/** Odległość do gracza, jeśli trener go widzi (null — nie widzi). */
export function seesPlayer(from: Point, dir: Dir, range: number, player: Point, isOpen: (x: number, y: number) => boolean): number | null {
  // Gracz zasłania dalszą część linii, ale sam jest „widoczny”: sprawdzamy pola przed nim.
  const line = sightLine(from, dir, range, (x, y) => (x === player.x && y === player.y) || isOpen(x, y));
  const i = line.findIndex((p) => p.x === player.x && p.y === player.y);
  return i >= 0 ? i + 1 : null;
}

export function adjacent(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
}

/**
 * Najkrótsza bezpieczna ścieżka trenera do pola obok gracza (BFS po polach `isFree`, maks. `maxSteps` kroków).
 * [] — trener już stoi obok; null — brak bezpiecznej ścieżki (trener mówi z miejsca).
 */
export function approachPath(from: Point, player: Point, isFree: (x: number, y: number) => boolean, maxSteps = 8): Point[] | null {
  if (adjacent(from, player)) return [];
  const key = (p: Point) => `${p.x},${p.y}`;
  const prev = new Map<string, Point | null>([[key(from), null]]);
  let frontier: Point[] = [from];
  for (let step = 0; step < maxSteps && frontier.length; step++) {
    const next: Point[] = [];
    for (const p of frontier) {
      for (const d of [DIRS.up, DIRS.down, DIRS.left, DIRS.right]) {
        const n = { x: p.x + d.x, y: p.y + d.y };
        const k = key(n);
        if (prev.has(k) || (n.x === player.x && n.y === player.y) || !isFree(n.x, n.y)) continue;
        prev.set(k, p);
        if (adjacent(n, player)) {
          const path: Point[] = [];
          let cur: Point | null = n;
          while (cur && key(cur) !== key(from)) {
            path.unshift(cur);
            cur = prev.get(key(cur)) ?? null;
          }
          return path;
        }
        next.push(n);
      }
    }
    frontier = next;
  }
  return null;
}

/** Kierunek z punktu a do sąsiedniego punktu b. */
export function facingTo(a: Point, b: Point): Dir {
  if (b.x > a.x) return 'right';
  if (b.x < a.x) return 'left';
  if (b.y > a.y) return 'down';
  return 'up';
}

/** Trener wyzwalany wydarzeniem (wejście na pole) — tylko niepokonany. */
export function eventTriggerAt(list: TrainerDef[], x: number, y: number, flags: Record<string, boolean>): TrainerDef | null {
  return list.find((t) => canChallenge(t, flags) && (t.eventTriggers ?? []).some((e) => e.kind === 'tile' && e.x === x && e.y === y)) ?? null;
}

// ───────────────────────────── walidacja danych ─────────────────────────────

export interface TrainerIssue {
  code:
    | 'DUPLICATE_ID'
    | 'DUPLICATE_EVENT'
    | 'MISSING_LOCATION'
    | 'MISSING_MAP'
    | 'INVALID_POSITION'
    | 'INVALID_VALUE'
    | 'EMPTY_TEAM'
    | 'INVALID_MEMBER'
    | 'INVALID_TRIGGER';
  trainerId: string;
  message: string;
}

/** Spójność danych trenerów (testy jednostkowe + konsola w trybie ?debug). */
export function validateTrainers(
  list: readonly TrainerDef[] = MAP_TRAINERS,
  world: WorldDef = WORLD,
  maps: Readonly<Record<string, MapDef>> = MAPS,
): TrainerIssue[] {
  const issues: TrainerIssue[] = [];
  const add = (code: TrainerIssue['code'], t: TrainerDef, message: string) => issues.push({ code, trainerId: t.id, message });
  const ids = new Set<string>();
  const events = new Set<string>();
  const spots = new Set<string>();
  for (const t of list) {
    if (ids.has(t.id)) add('DUPLICATE_ID', t, `Powtórzony identyfikator trenera: ${t.id}`);
    ids.add(t.id);
    if (!t.defeatedEventId || events.has(t.defeatedEventId)) add('DUPLICATE_EVENT', t, `Pusty lub powtórzony defeatedEventId: ${t.defeatedEventId}`);
    events.add(t.defeatedEventId);
    if (!t.name.trim()) add('INVALID_VALUE', t, 'Pusta nazwa trenera');
    if (!isAiProfile(t.aiProfile)) add('INVALID_VALUE', t, `Nieznany profil AI: ${String(t.aiProfile)}`);
    if (!(t.direction in DIRS)) add('INVALID_VALUE', t, `Nieznany kierunek: ${String(t.direction)}`);
    if (!Number.isInteger(t.sightRange) || t.sightRange < 0 || t.sightRange > 8) add('INVALID_VALUE', t, `Zasięg wzroku poza 0–8: ${t.sightRange}`);
    if (!t.dialogueBefore.length || !t.dialogueAfter.length) add('INVALID_VALUE', t, 'Brak dialogu przed albo po walce');
    if (t.repeatPolicy !== 'ONCE' && t.repeatPolicy !== 'REMATCH') add('INVALID_VALUE', t, `Nieznana repeatPolicy: ${String(t.repeatPolicy)}`);
    if (!(t.reward.money >= 0)) add('INVALID_VALUE', t, 'Nagroda pieniężna nie może być ujemna');
    for (const [item, n] of Object.entries(t.reward.items ?? {})) {
      if (!(item in ITEMS) || !(Number(n) > 0)) add('INVALID_VALUE', t, `Nieprawidłowa nagroda: ${item} ×${String(n)}`);
    }
    if (!t.team.length || t.team.length > 6) add('EMPTY_TEAM', t, 'Drużyna trenera musi mieć 1–6 stworzeń');
    t.team.forEach((m, i) => {
      const bad = (why: string) => add('INVALID_MEMBER', t, `Stworzenie #${i + 1} (${m.pokemonId}): ${why}`);
      if (!/^[a-z0-9-]+$/.test(m.pokemonId)) bad('nieprawidłowy pokemonId');
      if (!Number.isInteger(m.level) || m.level < 1 || m.level > 100) bad(`poziom poza 1–100: ${m.level}`);
      if (m.moves && (m.moves.length === 0 || m.moves.length > 4 || m.moves.some((n) => !/^[a-z0-9-]+$/.test(n)))) bad('ruchy: 1–4 nazwy z PokéAPI');
      if (m.nature !== undefined && !isNatureId(m.nature)) bad(`nieznana natura: ${String(m.nature)}`);
      if (m.heldItemId !== undefined && m.heldItemId !== null && !isHeldItemId(m.heldItemId)) bad(`to nie jest przedmiot trzymany: ${String(m.heldItemId)}`);
    });

    const loc = getLocation(t.locationId, world);
    if (!loc) {
      add('MISSING_LOCATION', t, `Nieznana lokacja: ${t.locationId}`);
      continue;
    }
    const map = mapOf(loc, maps);
    if (!map) {
      add('MISSING_MAP', t, `Lokacja ${t.locationId} nie ma mapy`);
      continue;
    }
    const grid = map.layout.map((r) => r.split(''));
    const { x, y } = t.position;
    const key = `${t.locationId}:${x},${y}`;
    if (!isWalkable(grid, x, y)) add('INVALID_POSITION', t, `Trener stoi na przeszkodzie (${x},${y})`);
    if (connectionAt(loc, x, y)) add('INVALID_POSITION', t, `Trener stoi na wyjściu z mapy (${x},${y})`);
    if (loc.spawnPoints.some((p) => p.x === x && p.y === y)) add('INVALID_POSITION', t, `Trener stoi na punkcie pojawienia się (${x},${y})`);
    if (map.staticEncounters.some((s) => s.x === x && s.y === y) || spots.has(key)) add('INVALID_POSITION', t, `Pole (${x},${y}) jest zajęte`);
    spots.add(key);
    for (const e of t.eventTriggers ?? []) {
      if (e.kind !== 'tile' || !isWalkable(grid, e.x, e.y) || connectionAt(loc, e.x, e.y)) add('INVALID_TRIGGER', t, `Pole wydarzenia (${e.x},${e.y}) musi być dostępne i nie może być wyjściem`);
    }
  }
  return issues;
}
