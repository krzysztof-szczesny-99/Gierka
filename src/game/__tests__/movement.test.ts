import { describe, expect, it } from 'vitest';
import type { Dir } from '../../engine/types';
import { POLANA_ID } from '../../config/world';
import { TEST_MAP } from '../maps/testMap';
import { getLocation, spawnPointOf } from '../world';
import { DIRS, followerSpotBehind, isWalkable, nextFollowerMove, planStep, type Point } from '../movement';

const grid = TEST_MAP.layout.map((row) => row.split(''));
const POLANA = getLocation(POLANA_ID)!;
/** Punkty pojawienia się Polany (model świata): start gry i Stacja Opieki. */
const SPAWN = spawnPointOf(POLANA, 'start')!;
const HEAL = spawnPointOf(POLANA, 'stacja-opieki')!;
const none = () => false;

/** Pierwszy kafelek spełniający warunek (skanowanie wierszami). */
function find(pred: (x: number, y: number) => boolean): Point {
  for (let y = 0; y < grid.length; y++) for (let x = 0; x < grid[0].length; x++) if (pred(x, y)) return { x, y };
  throw new Error('brak kafelka');
}

describe('ruch po siatce: kolizje', () => {
  it('drzewo, woda i krawędź mapy blokują krok', () => {
    // Pole przy lewej krawędzi (kolumna 0 to drzewa).
    const nearTree = find((x, y) => isWalkable(grid, x, y) && grid[y][x - 1] === 'T');
    expect(planStep(grid, nearTree, 'left', none)).toMatchObject({ kind: 'blocked' });

    const nearWater = find((x, y) => isWalkable(grid, x, y) && grid[y][x + 1] === '~');
    expect(planStep(grid, nearWater, 'right', none)).toMatchObject({ kind: 'blocked', tileKind: 'water' });

    expect(planStep([['.']], { x: 0, y: 0 }, 'up', none)).toMatchObject({ kind: 'blocked' });
  });

  it('drzwi i tabliczki to kolizja z rodzajem kafelka (interakcja przy zderzeniu)', () => {
    const belowDoor = find((x, y) => isWalkable(grid, x, y) && grid[y - 1]?.[x] === 'D');
    expect(planStep(grid, belowDoor, 'up', none)).toMatchObject({ kind: 'blocked', tileKind: 'door' });
  });

  it('wolne pole → krok o dokładnie jeden kafelek w osi', () => {
    const start = SPAWN;
    const dirs: Dir[] = ['up', 'down', 'left', 'right'];
    for (const d of dirs) {
      const plan = planStep(grid, start, d, none);
      if (plan.kind !== 'move') continue;
      expect(Math.abs(plan.x - start.x) + Math.abs(plan.y - start.y)).toBe(1);
      expect(plan.x - start.x).toBe(DIRS[d].x);
      expect(plan.y - start.y).toBe(DIRS[d].y);
    }
  });

  it('stworzenie na docelowym polu → kontakt (start spotkania), a nie ruch', () => {
    const start = SPAWN;
    const target = { x: start.x + 1, y: start.y };
    const plan = planStep(grid, start, 'right', (x, y) => x === target.x && y === target.y);
    expect(plan).toEqual({ kind: 'contact', x: target.x, y: target.y });
  });
});

describe('towarzysz', () => {
  it('wchodzi na pole opuszczone przez gracza i nigdy nie staje na polu gracza', () => {
    let player: Point = { x: SPAWN.x, y: SPAWN.y };
    let follower: Point = followerSpotBehind(grid, player, SPAWN.facing, none);
    expect(isWalkable(grid, follower.x, follower.y)).toBe(true);
    expect(follower).not.toEqual(player);

    const route: Dir[] = ['right', 'right', 'down', 'down', 'left', 'up', 'right', 'right'];
    let moved = 0;
    for (const d of route) {
      // Jak w scenie: towarzysz nie blokuje gracza (przy cofnięciu zamieniają się miejscami).
      const plan = planStep(grid, player, d, none);
      if (plan.kind !== 'move') continue;
      const prev = player;
      player = { x: plan.x, y: plan.y };
      const fm = nextFollowerMove(follower, prev);
      if (fm.kind === 'step') follower = fm.to;
      else if (fm.kind === 'reposition') follower = followerSpotBehind(grid, player, d, none);
      moved++;
      expect(follower).toEqual(prev);
      expect(follower).not.toEqual(player);
    }
    expect(moved).toBeGreaterThan(2);
  });

  it('po teleporcie (duża odległość) towarzysz jest przestawiany za gracza', () => {
    expect(nextFollowerMove({ x: 1, y: 1 }, { x: 10, y: 10 })).toEqual({ kind: 'reposition' });
    expect(nextFollowerMove(null, { x: 10, y: 10 })).toEqual({ kind: 'none' });
    const p = HEAL;
    const spot = followerSpotBehind(grid, p, p.facing, none);
    expect(isWalkable(grid, spot.x, spot.y)).toBe(true);
    expect(Math.abs(spot.x - p.x) + Math.abs(spot.y - p.y)).toBeLessThanOrEqual(1);
  });

  it('nie staje na stworzeniu', () => {
    const p = SPAWN;
    const behind = { x: p.x - DIRS[p.facing].x, y: p.y - DIRS[p.facing].y };
    const spot = followerSpotBehind(grid, p, p.facing, (x, y) => x === behind.x && y === behind.y);
    expect(spot).not.toEqual(behind);
  });
});
