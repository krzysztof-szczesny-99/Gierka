// Czyste reguły ruchu po siatce (bez Phasera): kolizje, kontakt ze stworzeniem, tempo kroku, pozycja towarzysza.
// Scena eksploracji tylko je wywołuje — dzięki temu zachowanie jest testowane jednostkowo.

import type { Dir } from '../engine/types';
import { tileDef, type TileKind } from './tiles';

export interface Point {
  x: number;
  y: number;
}

export const DIRS: Record<Dir, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/**
 * Tempo ruchu. Każdy krok to dokładnie jeden kafelek w jednej z 4 osi, więc wychylenie joysticka po przekątnej
 * nie przyspiesza postaci (kierunek jest kwantowany, droga i czas kroku są takie same jak w osi).
 */
export const MOVE_TIMING = {
  /** Chód: 340 ms na kafelek (~2,9 kafelka/s) — o połowę wolniej niż pierwotne 170 ms. */
  walkMs: 340,
  runMs: 95,
  /** Maksymalna prędkość (kafelki/s) — górny limit niezależnie od trybu i wejścia. */
  maxTilesPerSecond: 1000 / 95,
} as const;

export function stepDurationMs(running: boolean, timing: { walkMs: number; runMs: number; maxTilesPerSecond: number } = MOVE_TIMING): number {
  const base = running ? timing.runMs : timing.walkMs;
  return Math.max(base, 1000 / timing.maxTilesPerSecond);
}

export function inBounds(grid: string[][], x: number, y: number): boolean {
  return y >= 0 && y < grid.length && x >= 0 && x < (grid[0]?.length ?? 0);
}

/** Znak kafelka; poza mapą zachowuje się jak drzewo (ściana). */
export function charAt(grid: string[][], x: number, y: number): string {
  return inBounds(grid, x, y) ? grid[y][x] : 'T';
}

export function isWalkable(grid: string[][], x: number, y: number): boolean {
  return inBounds(grid, x, y) && !tileDef(charAt(grid, x, y)).solid;
}

export type StepPlan =
  | { kind: 'move'; x: number; y: number }
  | { kind: 'contact'; x: number; y: number }
  | { kind: 'blocked'; x: number; y: number; tileKind: TileKind | undefined };

/**
 * Co się stanie przy próbie kroku: ruch, kontakt ze stworzeniem (start spotkania) albo kolizja.
 * Stworzenie ma pierwszeństwo przed sprawdzeniem terenu (stoi na kafelku, na który chcemy wejść).
 */
export function planStep(grid: string[][], from: Point, dir: Dir, occupiedByActor: (x: number, y: number) => boolean): StepPlan {
  const x = from.x + DIRS[dir].x;
  const y = from.y + DIRS[dir].y;
  if (occupiedByActor(x, y)) return { kind: 'contact', x, y };
  if (!isWalkable(grid, x, y)) return { kind: 'blocked', x, y, tileKind: tileDef(charAt(grid, x, y)).kind };
  return { kind: 'move', x, y };
}

/** Miejsce dla towarzysza tuż za graczem (po teleporcie lub pojawieniu się): za plecami, potem sąsiednie pola. */
export function followerSpotBehind(grid: string[][], player: Point, facing: Dir, occupied: (x: number, y: number) => boolean): Point {
  const back = DIRS[facing];
  const options: Point[] = [
    { x: player.x - back.x, y: player.y - back.y },
    { x: player.x, y: player.y + 1 },
    { x: player.x - 1, y: player.y },
    { x: player.x + 1, y: player.y },
    { x: player.x, y: player.y - 1 },
  ];
  return options.find((p) => isWalkable(grid, p.x, p.y) && !occupied(p.x, p.y)) ?? { x: player.x, y: player.y };
}

export type FollowerMove = { kind: 'none' } | { kind: 'step'; to: Point } | { kind: 'reposition' };

/** Towarzysz wchodzi na pole, które gracz właśnie opuścił; gdy jest za daleko (np. po teleporcie) — przestawiamy go. */
export function nextFollowerMove(follower: Point | null, playerPrev: Point): FollowerMove {
  if (!follower) return { kind: 'none' };
  if (follower.x === playerPrev.x && follower.y === playerPrev.y) return { kind: 'none' };
  if (Math.abs(follower.x - playerPrev.x) + Math.abs(follower.y - playerPrev.y) > 2) return { kind: 'reposition' };
  return { kind: 'step', to: { x: playerPrev.x, y: playerPrev.y } };
}
